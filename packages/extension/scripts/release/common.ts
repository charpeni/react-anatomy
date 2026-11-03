import type { Release, LocatedRelease, ExtensionManifest, ReleaseReceipt } from './types.ts';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, readdir, mkdir, lstat, type FileHandle } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, unzipSync } from 'fflate';
import type { PathLike } from 'node:fs';

export const extension = fileURLToPath(new URL('../../', import.meta.url));
export const repository = resolve(extension, '../..');

export const sha256 = (
  bytes: string | NodeJS.ArrayBufferView<ArrayBufferLike> | Buffer<ArrayBuffer>,
) => createHash('sha256').update(bytes).digest('hex');

export const readJson = async <T = unknown>(file: PathLike | FileHandle): Promise<T> =>
  JSON.parse(await readFile(file, 'utf8'));

export const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

export function argumentsFor(commands: string[]) {
  const [command = commands[0], ...args] = process.argv.slice(2);

  if (!commands.includes(command)) {
    throw new Error(`Choose: ${commands.join(', ')}.`);
  }

  const options: { directory?: string; metadata?: string } = {};

  for (const arg of args) {
    const match = /^--(directory|metadata)=(.+)$/.exec(arg);

    if (!match || options[match[1] as 'directory' | 'metadata']) {
      throw new Error(`Unknown or repeated argument: ${arg}`);
    }

    options[match[1] as 'directory' | 'metadata'] = resolve(match[2]);
  }

  return { command, ...options };
}

export async function run(command: string, args: string[], cwd = extension) {
  await new Promise<void>((done, fail) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env });

    child.on('error', fail);
    child.on('exit', (code) =>
      code === 0 ? done() : fail(new Error(`${basename(command)} exited with ${code}.`)),
    );
  });
}

export const node = (script: string, args: string[] = []) =>
  run(process.execPath, [script, ...args]);

export const pnpm = (args: string[]) => {
  // pnpm 12 uses a native executable; Corepack can also provide a JS entry point.
  const executable = process.env.npm_execpath || 'pnpm';

  return /\.[cm]?js$/.test(executable)
    ? run(process.execPath, [executable, ...args], repository)
    : run(executable, args, repository);
};

export async function collect(directory: string, prefix = '') {
  const result: Record<string, Uint8Array> = {};

  for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (
      item.name.startsWith('.') ||
      /^(secrets?|credentials?|node_modules|artifacts)$/i.test(item.name)
    ) {
      throw new Error(`Unexpected file in release input: ${join(prefix, item.name)}`);
    }

    const name = prefix ? `${prefix}/${item.name}` : item.name;
    const path = join(directory, item.name);

    if (item.isDirectory()) {
      Object.assign(result, await collect(path, name));
    } else if (item.isFile()) {
      result[name] = new Uint8Array(await readFile(path));
    } else {
      throw new Error(`Release input must not contain symlinks: ${name}`);
    }
  }

  return result;
}

export function archive(files: Record<string, Uint8Array>) {
  return zipSync(
    Object.fromEntries(
      Object.entries(files)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, bytes]) => [name, [bytes, { mtime: new Date('2000-01-01T00:00:00Z') }]]),
    ),
    { level: 9 },
  );
}

export async function extract(
  bytes: Uint8Array<ArrayBufferLike> | NonSharedBuffer,
  directory: string,
) {
  for (const [name, data] of Object.entries(unzipSync(bytes))) {
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
      throw new Error('Unsafe archive entry.');
    }

    if (name.endsWith('/')) {
      continue;
    }

    const file = join(directory, name);

    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data, { flag: 'wx' });
  }
}

export async function releaseAt(directory?: string): Promise<LocatedRelease> {
  const manifest = await readJson<ExtensionManifest>(join(extension, 'extension/manifest.json'));

  directory ||= join(repository, 'artifacts/releases', manifest.version);

  const release = await readJson<Release>(join(directory, 'release.json'));

  if (release.schema !== 1 || release.verified !== true) {
    throw new Error('Release is not verified.');
  }

  for (const item of Object.values(release.artifacts)) {
    if (basename(item.file) !== item.file) {
      throw new Error('Invalid release artifact path.');
    }

    const file = join(directory, item.file);

    if (!(await lstat(file)).isFile() || sha256(await readFile(file)) !== item.sha256) {
      throw new Error(`Release artifact changed: ${item.file}`);
    }
  }

  for (const browser of ['chrome', 'firefox'] as const) {
    const packed = unzipSync(await readFile(join(directory, release.artifacts[browser].file)));
    const packagedManifest = JSON.parse(new TextDecoder().decode(packed['manifest.json']));

    if (packagedManifest.version !== release.version) {
      throw new Error(`Wrong ${browser} version in release.`);
    }

    if (
      browser === 'firefox' &&
      packagedManifest.browser_specific_settings.gecko.id !== release.firefoxId
    ) {
      throw new Error('Firefox identity changed.');
    }
  }

  return { directory, ...release };
}

export async function startAttempt(
  release: Pick<LocatedRelease, 'directory' | 'version'>,
  store: string,
  action: string,
  details: Record<string, unknown> = {},
) {
  const file = join(release.directory, `${store}-${action}.json`);
  const receipt = {
    version: release.version,
    action,
    startedAt: new Date().toISOString(),
    outcome: 'unknown',
    ...details,
  };

  try {
    await writeFile(file, json(receipt), { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(
        `${store} ${action} was already attempted. Check status; do not resubmit blindly.`,
      );
    }

    throw error;
  }

  return async (result: ReleaseReceipt) => writeFile(file, json({ ...receipt, ...result }));
}

export async function requestJson<T = Record<string, unknown>>(
  url: string | URL | Request,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(120_000),
    redirect: 'error',
  });

  if (!response.ok) {
    throw new Error(
      `Store request failed (HTTP ${response.status}). Check the dashboard before retrying.`,
    );
  }

  return response.json();
}

export async function main(action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

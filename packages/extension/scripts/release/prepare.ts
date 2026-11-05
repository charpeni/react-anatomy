import type { Artifact, ExtensionManifest } from './types.ts';
import { sourceFiles } from './source.ts';
import { mkdir, writeFile, rm, rename, access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  archive,
  collect,
  extension,
  repository,
  json,
  main,
  node,
  pnpm,
  readJson,
  sha256,
} from './common.ts';

await main(async () => {
  if (process.argv.length > 2) {
    throw new Error('release:prepare takes no arguments.');
  }

  const manifest = await readJson<ExtensionManifest>(join(extension, 'extension/manifest.json'));
  const pkg = await readJson<{ version: string }>(join(extension, 'package.json'));

  if (manifest.version !== pkg.version || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(pkg.version)) {
    throw new Error('Package and manifest need the same numeric release version.');
  }

  const directory = join(repository, 'artifacts/releases', manifest.version);

  try {
    await access(directory);

    throw new Error(
      `Release directory already exists: ${directory}. Preserve it; use a new version for changed code.`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const source = await sourceFiles(manifest.version);
  const sourceHash = sha256(archive(source));

  await pnpm(['run', 'check']);
  await node('scripts/release/check.ts');

  // A store ZIP must never inherit stale files from a previous local build.
  for (const name of ['extension', 'firefox']) {
    await rm(join(extension, 'dist', name), { recursive: true, force: true });
  }

  // Use the same Chrome suite as CI so new regressions also gate releases.
  await pnpm(['test']);
  await node('scripts/build-extension.ts', ['--browser=firefox']);

  await node(join(extension, 'node_modules/web-ext/bin/web-ext.js'), [
    'lint',
    '--source-dir=dist/firefox',
    '--no-config-discovery',
  ]);
  await node('scripts/check-firefox.ts');

  if (sha256(archive(await sourceFiles(manifest.version))) !== sourceHash) {
    throw new Error('Release inputs changed while checks ran. Prepare again from stable sources.');
  }

  const chrome = await collect(join(extension, 'dist/extension'));
  const firefox = await collect(join(extension, 'dist/firefox'));
  const temporary = `${directory}.preparing-${process.pid}`;

  await mkdir(temporary, { recursive: true });

  try {
    const artifacts: Record<string, Artifact> = {};

    for (const [name, files] of Object.entries({ chrome, firefox, source })) {
      const file = `react-anatomy-${name}-${manifest.version}.zip`;
      const bytes = archive(files);

      await writeFile(join(temporary, file), bytes);
      artifacts[name] = { file, sha256: sha256(bytes), bytes: bytes.length };
    }

    const gecko = JSON.parse(new TextDecoder().decode(firefox['manifest.json']))
      .browser_specific_settings.gecko;

    await writeFile(
      join(temporary, 'release.json'),
      json({
        schema: 1,
        version: manifest.version,
        preparedAt: new Date().toISOString(),
        verified: true,
        sourceCommit: process.env.GITHUB_SHA,
        firefoxId: gecko.id,
        node: process.version,
        artifacts,
        checks: [
          'lint',
          'format',
          'astro',
          'release-automation',
          'chrome-regressions',
          'mozilla-lint',
          'firefox-regressions',
        ],
      }),
    );
    await writeFile(
      join(temporary, 'SHA256SUMS'),
      Object.values(artifacts)
        .map((a) => `${a.sha256}  ${a.file}\n`)
        .join(''),
    );
    await rename(temporary, directory);
    console.log(`Prepared verified release: ${directory}\nNothing was uploaded or published.`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

import { execFileSync } from 'node:child_process';
import { appendFile, copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LocatedRelease, Release } from './types.ts';
import { extension, main, readJson, releaseAt, repository, run, sha256 } from './common.ts';

interface ReleaseEvent {
  action: string;
  repository: { full_name: string };
  release: { tag_name: string; draft: boolean; prerelease: boolean };
}

export function validateRelease(
  event: ReleaseEvent,
  manifestVersion: string,
  packageVersion: string,
) {
  const release = event.release;
  if (
    event.repository.full_name !== 'charpeni/react-anatomy' ||
    event.action !== 'published' ||
    release.draft ||
    release.prerelease
  ) {
    throw new Error(
      'Only published stable releases of charpeni/react-anatomy can submit to Chrome.',
    );
  }
  if (
    !/^v\d+\.\d+\.\d+(?:\.\d+)?$/.test(release.tag_name) ||
    release.tag_name !== `v${manifestVersion}` ||
    packageVersion !== manifestVersion
  ) {
    throw new Error(
      'The release tag must be v<version>, matching the extension manifest and package version.',
    );
  }
  return manifestVersion;
}

async function context() {
  if (process.env.GITHUB_EVENT_NAME !== 'release' || !process.env.GITHUB_EVENT_PATH) {
    throw new Error('This command runs in the GitHub release workflow.');
  }
  const event = await readJson<ReleaseEvent>(process.env.GITHUB_EVENT_PATH);
  const manifest = await readJson<{ version: string }>(join(extension, 'extension/manifest.json'));
  const pkg = await readJson<{ version: string }>(join(extension, 'package.json'));
  const version = validateRelease(event, manifest.version, pkg.version);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repository,
    encoding: 'utf8',
  }).trim();
  const tagCommit = execFileSync(
    'git',
    ['rev-parse', `refs/tags/${event.release.tag_name}^{commit}`],
    { cwd: repository, encoding: 'utf8' },
  ).trim();
  if (commit !== process.env.GITHUB_SHA || commit !== tagCommit) {
    throw new Error('The checkout or release tag changed from the release event commit.');
  }
  execFileSync('git', ['merge-base', '--is-ancestor', commit, 'origin/main'], { cwd: repository });
  return { version, commit, tag: event.release.tag_name, repo: event.repository.full_name };
}

async function prepared() {
  const event = await context();
  const release = await releaseAt();
  if (release.version !== event.version || release.sourceCommit !== event.commit) {
    throw new Error('Prepared artifacts must match the release version and commit.');
  }
  return { ...event, release };
}

export function sameRelease(left: Release, right: Release) {
  return (
    left.schema === right.schema &&
    left.verified === true &&
    right.verified === true &&
    left.version === right.version &&
    left.sourceCommit === right.sourceCommit &&
    left.firefoxId === right.firefoxId &&
    (['chrome', 'firefox', 'source'] as const).every(
      (name) =>
        left.artifacts[name]?.file === right.artifacts[name]?.file &&
        left.artifacts[name]?.sha256 === right.artifacts[name]?.sha256 &&
        left.artifacts[name]?.bytes === right.artifacts[name]?.bytes,
    )
  );
}

function assetNames(tag: string, repo: string) {
  return JSON.parse(
    execFileSync('gh', ['release', 'view', tag, '--repo', repo, '--json', 'assets'], {
      cwd: repository,
      encoding: 'utf8',
    }),
  ).assets.map((asset: { name: string }) => asset.name) as string[];
}

interface ReleaseAssetStore {
  list(): string[];
  download(file: string, directory: string): Promise<void>;
  upload(file: string): Promise<void>;
}

function assetStore(tag: string, repo: string): ReleaseAssetStore {
  return {
    list: () => assetNames(tag, repo),
    download: (file, directory) =>
      run(
        'gh',
        ['release', 'download', tag, '--repo', repo, '--pattern', file, '--dir', directory],
        repository,
      ),
    upload: (file) => run('gh', ['release', 'upload', tag, file, '--repo', repo], repository),
  };
}

export async function attachReleaseAssets(release: LocatedRelease, store: ReleaseAssetStore) {
  const existing = store.list();
  const files = [
    ...Object.values(release.artifacts).map((artifact) => artifact.file),
    'SHA256SUMS',
    'release.json',
  ];
  const temporary = await mkdtemp(join(tmpdir(), 'anatomy-release-assets-'));
  try {
    // Validate every existing asset before attaching any new ones.
    for (const file of files.filter((name) => existing.includes(name))) {
      await store.download(file, temporary);
      const saved = join(temporary, file);
      const matches =
        file === 'release.json'
          ? sameRelease(await readJson<Release>(saved), release)
          : sha256(await readFile(saved)) === sha256(await readFile(join(release.directory, file)));
      if (!matches) {
        throw new Error(
          `Release asset differs: ${file}. Published release artifacts cannot be replaced.`,
        );
      }
    }

    // Recover the attempt on a fresh runner. An uncertain upload must not be
    // repeated just because a GitHub Actions job was retried.
    const receipt = existing.includes('chrome-submit.json')
      ? 'chrome-submit.json'
      : existing.includes('chrome-submit-attempt.json')
        ? 'chrome-submit-attempt.json'
        : null;
    if (receipt) {
      await store.download(receipt, temporary);
      const saved = await readJson<{ version: string; sha256: string }>(join(temporary, receipt));
      if (saved.version !== release.version || saved.sha256 !== release.artifacts.chrome.sha256) {
        throw new Error('The previous Chrome attempt belongs to different release bytes.');
      }
      await copyFile(join(temporary, receipt), join(release.directory, 'chrome-submit.json'));
    }
    for (const file of files.filter((name) => !existing.includes(name))) {
      await store.upload(join(release.directory, file));
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function reserveChromeAttempt(release: LocatedRelease) {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    return;
  }
  const { tag, repo } = await context();
  const marker = join(release.directory, 'chrome-submit-attempt.json');
  await copyFile(join(release.directory, 'chrome-submit.json'), marker);
  // Never clobber the initial marker. It is durable before any store mutation.
  await run('gh', ['release', 'upload', tag, marker, '--repo', repo], repository);
}

async function receipt() {
  const { tag, repo, release } = await prepared();
  for (const file of ['chrome-submit.json', 'chrome-status.json']) {
    let contents: string;
    try {
      contents = await readFile(join(release.directory, file), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue;
      }
      throw error;
    }
    await run(
      'gh',
      ['release', 'upload', tag, join(release.directory, file), '--repo', repo, '--clobber'],
      repository,
    );
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `### ${file}\n\n\`\`\`json\n${contents}\n\`\`\`\n\n`,
      );
    }
  }
}

async function cli() {
  const command = process.argv[2];
  if (command === 'check') {
    const { version } = await context();
    for (const variable of ['CHROME_WORKLOAD_IDENTITY_PROVIDER', 'CHROME_SERVICE_ACCOUNT']) {
      if (!process.env[variable]) {
        throw new Error(`Configure the GitHub Actions variable ${variable} before releasing.`);
      }
    }
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `version=${version}\ndirectory=artifacts/releases/${version}\n`,
      );
    }
  } else if (command === 'assets') {
    const { tag, repo, release } = await prepared();
    await attachReleaseAssets(release, assetStore(tag, repo));
  } else if (command === 'receipt') {
    await receipt();
  } else {
    throw new Error('Choose: check, assets, receipt.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(cli);
}

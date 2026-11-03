import type { FirefoxListing } from './types.ts';
import { createHmac, randomUUID, type KeyLike } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  argumentsFor,
  extract,
  extension,
  json,
  main,
  node,
  readJson,
  releaseAt,
  repository,
  requestJson,
  startAttempt,
} from './common.ts';

export function firefoxSignArguments({
  directory,
  metadata,
  source,
}: {
  directory: string;
  metadata: string;
  source: string;
}) {
  return [
    'sign',
    '--channel=listed',
    `--source-dir=${join(directory, 'firefox-submission')}`,
    `--artifacts-dir=${join(directory, 'firefox-signed')}`,
    `--amo-metadata=${metadata}`,
    `--upload-source-code=${source}`,
    '--approval-timeout=0',
    '--no-input',
    '--no-config-discovery',
  ];
}

export function amoToken(key: string, secret: KeyLike, now = Math.floor(Date.now() / 1000)) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

  const payload = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: key, iat: now, exp: now + 60, jti: randomUUID() })}`;

  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

async function cli() {
  const options = argumentsFor(['plan', 'submit', 'status']);
  const release = await releaseAt(options.directory);
  const metadata = options.metadata || join(repository, 'release/firefox-metadata.json');
  const args = firefoxSignArguments({
    directory: release.directory,
    metadata,
    source: join(release.directory, release.artifacts.source.file),
  });

  if (options.command === 'plan') {
    console.log(
      json({
        version: release.version,
        addonId: release.firefoxId,
        artifact: release.artifacts.firefox,
        source: release.artifacts.source,
        metadata,
        command: ['web-ext', ...args],
        credentials: ['WEB_EXT_API_KEY', 'WEB_EXT_API_SECRET'],
        effect:
          'Plan only. Submit creates or updates a public listed add-on, which may publish when approved. approval-timeout=0 skips waiting, not publication.',
      }),
    );

    return;
  }

  const key = process.env.WEB_EXT_API_KEY;
  const secret = process.env.WEB_EXT_API_SECRET;

  if (!key || !secret) {
    throw new Error('Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET from AMO API credentials.');
  }

  if (options.command === 'status') {
    const url = `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(release.firefoxId)}/versions/v${encodeURIComponent(release.version)}/`;
    const result = await requestJson(url, {
      headers: { Authorization: `JWT ${amoToken(key, secret)}` },
    });
    const status = {
      id: result.id,
      version: result.version,
      channel: result.channel,
      reviewed: result.reviewed,
      disabled: result.is_disabled,
      file: result.file,
      sourceAttached: Boolean(result.source),
    };

    await writeFile(
      join(release.directory, 'firefox-status.json'),
      json({ checkedAt: new Date().toISOString(), status }),
    );
    console.log(json(status));

    return;
  }

  const listing = await readJson<FirefoxListing>(metadata);

  if (!listing.summary?.['en-US'] || !listing.categories?.length || !listing.version?.license) {
    throw new Error(
      'Firefox metadata needs summary.en-US, categories, and version.license. Review the listing before submission.',
    );
  }

  const record = await startAttempt(release, 'firefox', 'submit', {
    addonId: release.firefoxId,
    sha256: release.artifacts.firefox.sha256,
  });
  const submission = join(release.directory, 'firefox-submission');

  await mkdir(submission, { recursive: true });
  await extract(
    await readFile(join(release.directory, release.artifacts.firefox.file)),
    submission,
  );
  // web-ext stores .amo-upload-uuid here, never in the immutable packaged ZIP.
  // Credentials travel via environment, not argv or saved command output.
  await node(join(extension, 'node_modules/web-ext/bin/web-ext.js'), args);
  await record({ outcome: 'submitted-check-amo-status' });
  console.log(
    'Submitted a listed Firefox release. Approval may make it public. Run release:firefox -- status; command success does not mean approval.',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(cli);
}

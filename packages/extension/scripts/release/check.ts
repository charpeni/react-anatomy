import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createHmac } from 'node:crypto';
import { archive, collect, extract, json, releaseAt, sha256, startAttempt } from './common.ts';
import type { Artifact, ChromeResponse, Release, ReleaseReceipt } from './types.ts';
import { chromeEndpoints, chromeSubmissionAction, submitChrome } from './chrome.ts';
import { attachReleaseAssets, sameRelease, validateRelease } from './github.ts';
import { amoToken, firefoxSignArguments } from './firefox.ts';

const endpoints = chromeEndpoints('publisher', 'a'.repeat(32));
const bytes = new Uint8Array([1, 2, 3]);
const version = '0.4.7';

test('Chrome uploads the exact package and requests automatic publication after approval', async () => {
  const calls: [string, RequestInit][] = [];
  const records: ReleaseReceipt[] = [];

  await submitChrome({
    endpoints,
    headers: { Authorization: 'Bearer test' },
    bytes,
    version,
    request: async (url, options) => {
      calls.push([url, options]);

      return url === endpoints.upload
        ? { uploadState: 'SUCCEEDED', crxVersion: version }
        : { state: 'PENDING_REVIEW' };
    },
    record: async (value) => records.push(value),
  });
  assert.equal(calls[0][0], endpoints.upload);
  assert.strictEqual(calls[0][1].body, bytes);
  assert.equal(calls[1][0], endpoints.publish);
  assert.deepEqual(JSON.parse(String(calls[1][1].body)), {
    publishType: 'DEFAULT_PUBLISH',
    deployInfos: [{ deployPercentage: 100 }],
    blockOnWarnings: true,
  });
  assert.equal(records.at(-1)!.outcome, 'submitted-for-automatic-publication');
});

test('Chrome preflight handles repeated runs, numeric versions, and existing submissions', () => {
  const revision = (state: string, crxVersion: string, deployPercentage = 100) => ({
    state,
    distributionChannels: [{ crxVersion, deployPercentage }],
  });
  assert.equal(chromeSubmissionAction({}, '0.4.10'), 'upload');
  assert.equal(
    chromeSubmissionAction(
      { publishedItemRevisionStatus: revision('PUBLISHED', '0.4.9') },
      '0.4.10',
    ),
    'upload',
  );
  assert.equal(
    chromeSubmissionAction(
      { publishedItemRevisionStatus: revision('PUBLISHED', '0.4.10') },
      '0.4.10',
    ),
    'already-published',
  );
  assert.equal(
    chromeSubmissionAction(
      { submittedItemRevisionStatus: revision('PENDING_REVIEW', '0.4.10') },
      '0.4.10',
    ),
    'already-in-review',
  );
  assert.equal(
    chromeSubmissionAction(
      { submittedItemRevisionStatus: revision('REJECTED', '0.4.9') },
      '0.4.10',
    ),
    'upload',
  );
  for (const status of [
    { publishedItemRevisionStatus: revision('PUBLISHED', '0.4.11') },
    { publishedItemRevisionStatus: revision('PUBLISHED', '0.4.10', 10) },
    { publishedItemRevisionStatus: revision('PUBLISHED_TO_TESTERS', '0.4.10') },
    { submittedItemRevisionStatus: revision('PENDING_REVIEW', '0.4.9') },
    { submittedItemRevisionStatus: revision('STAGED', '0.4.10') },
    { submittedItemRevisionStatus: revision('REJECTED', '0.4.10') },
    { submittedItemRevisionStatus: { state: 'PENDING_REVIEW' } },
    { lastAsyncUploadState: 'IN_PROGRESS' },
    { takenDown: true },
  ] satisfies ChromeResponse[]) {
    assert.throws(() => chromeSubmissionAction(status, '0.4.10'));
  }
});

test('Chrome does not report success for a held, rejected, or unknown publish response', async () => {
  for (const state of ['STAGED', 'REJECTED', undefined]) {
    const records: ReleaseReceipt[] = [];
    await assert.rejects(
      submitChrome({
        endpoints,
        headers: {},
        bytes,
        version,
        record: async (record) => records.push(record),
        request: async (url) =>
          url === endpoints.upload ? { uploadState: 'SUCCEEDED', crxVersion: version } : { state },
      }),
      /Check status/,
    );
    assert.equal(records.at(-1)?.outcome, 'unexpected-submission-state');
  }
});

test('Only stable releases with matching package, manifest, and tag versions are accepted', () => {
  const event = {
    action: 'published',
    repository: { full_name: 'charpeni/react-anatomy' },
    release: { tag_name: 'v0.4.10', draft: false, prerelease: false },
  };
  assert.equal(validateRelease(event, '0.4.10', '0.4.10'), '0.4.10');
  assert.throws(() => validateRelease(event, '0.4.9', '0.4.10'));
  assert.throws(() => validateRelease(event, '0.4.10', '0.4.9'));
  assert.throws(() => validateRelease({ ...event, action: 'edited' }, '0.4.10', '0.4.10'));
  assert.throws(() =>
    validateRelease({ ...event, repository: { full_name: 'someone/fork' } }, '0.4.10', '0.4.10'),
  );
  for (const override of [
    { draft: true },
    { prerelease: true },
    { tag_name: 'v0.4.10-beta.1' },
    { tag_name: 'main' },
    { tag_name: 'v0.4.10\nunsafe' },
  ]) {
    assert.throws(() =>
      validateRelease({ ...event, release: { ...event.release, ...override } }, '0.4.10', '0.4.10'),
    );
  }
});

test('A release rerun can reuse identical artifacts but cannot replace its code or commit', () => {
  const release: Release = {
    schema: 1,
    version,
    verified: true,
    sourceCommit: 'a'.repeat(40),
    firefoxId: 'test@example.org',
    artifacts: Object.fromEntries(
      ['chrome', 'firefox', 'source'].map((name) => [
        name,
        {
          file: `${name}.zip`,
          bytes: 3,
          sha256: sha256(bytes),
        },
      ]),
    ) as Release['artifacts'],
  };
  assert(sameRelease(release, structuredClone(release)));
  assert(!sameRelease(release, { ...release, sourceCommit: 'b'.repeat(40) }));
  assert(!sameRelease(release, { ...release, verified: false }));
  const changed = structuredClone(release);
  changed.artifacts.chrome.sha256 = sha256('different package');
  assert(!sameRelease(release, changed));
});

test('Chrome waits for async acceptance; failure, timeout and wrong version cannot request review', async () => {
  for (const scenario of [
    'pending-success',
    'failed',
    'timeout',
    'wrong-version',
    'network-error',
  ]) {
    const calls: string[] = [];
    const work = submitChrome({
      endpoints,
      headers: {},
      bytes,
      version,
      wait: async () => {},
      record: async () => {},
      request: async (url) => {
        calls.push(url);

        if (scenario === 'network-error') {
          throw new Error('Connection lost');
        }

        if (url === endpoints.upload) {
          return {
            uploadState:
              scenario === 'failed'
                ? 'FAILED'
                : scenario === 'wrong-version'
                  ? 'SUCCEEDED'
                  : 'IN_PROGRESS',
            crxVersion: scenario === 'wrong-version' ? '9.9.9' : undefined,
          };
        }

        if (url === endpoints.status) {
          return { lastAsyncUploadState: scenario === 'timeout' ? 'IN_PROGRESS' : 'SUCCEEDED' };
        }

        return { state: 'PENDING_REVIEW' };
      },
    });

    if (scenario === 'pending-success') {
      await work;
      assert.deepEqual(calls, [endpoints.upload, endpoints.status, endpoints.publish]);
    } else {
      await assert.rejects(work);
      assert(!calls.includes(endpoints.publish));
      assert.equal(calls.filter((url) => url === endpoints.upload).length, 1);
    }
  }
});

test('Firefox submits listed with source and metadata; credentials stay out of argv', () => {
  const args = firefoxSignArguments({
    directory: '/release',
    metadata: '/metadata.json',
    source: '/source.zip',
  });

  assert(args.includes('--channel=listed'));
  assert(args.includes('--approval-timeout=0'));
  assert(args.includes('--upload-source-code=/source.zip'));
  assert(args.includes('--amo-metadata=/metadata.json'));
  assert(args.includes('--no-config-discovery'));
  assert(!args.some((arg) => /api-(key|secret)=/.test(arg)));

  const token = amoToken('issuer', 'secret', 1000);
  const [header, payload, signature] = token.split('.');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

  assert.equal(data.iss, 'issuer');
  assert.equal(data.exp - data.iat, 60);
  assert(data.jti);
  assert.equal(
    signature,
    createHmac('sha256', 'secret').update(`${header}.${payload}`).digest('base64url'),
  );
});

test('Archives reproduce deterministically; unsafe inputs and modified packages are rejected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anatomy-release-'));

  try {
    const manifest = { version, browser_specific_settings: { gecko: { id: 'test@example.org' } } };
    const files = { 'manifest.json': new TextEncoder().encode(json(manifest)), 'panel.js': bytes };
    const packed = archive(files);

    assert.deepEqual(packed, archive(files));
    await extract(packed, join(directory, 'extracted'));
    assert.deepEqual(await collect(join(directory, 'extracted')), files);

    const artifacts: Record<string, Artifact> = {};

    for (const name of ['chrome', 'firefox', 'source']) {
      const file = `${name}.zip`;

      await writeFile(join(directory, file), packed);
      artifacts[name] = { file, sha256: sha256(packed), bytes: packed.length };
    }

    await writeFile(
      join(directory, 'release.json'),
      json({
        schema: 1,
        version,
        verified: true,
        firefoxId: manifest.browser_specific_settings.gecko.id,
        artifacts,
      }),
    );

    const release = await releaseAt(directory);
    const remote = new Map<string, Buffer>();
    const uploads: string[] = [];
    const store = {
      list: () => [...remote.keys()],
      download: async (file: string, destination: string) => {
        assert(remote.has(file));
        await writeFile(join(destination, file), remote.get(file)!);
      },
      upload: async (file: string) => {
        assert(!remote.has(basename(file)), 'An existing asset must never be replaced');
        uploads.push(basename(file));
        remote.set(basename(file), await readFile(file));
      },
    };
    await writeFile(join(directory, 'SHA256SUMS'), 'test checksums');
    await attachReleaseAssets(release, store);
    assert.equal(uploads.length, 5);
    uploads.length = 0;
    await attachReleaseAssets(release, store);
    assert.equal(uploads.length, 0, 'Repeating a release must reuse identical assets');

    const chrome = remote.get('chrome.zip')!;
    remote.set('chrome.zip', Buffer.from('wrong package'));
    remote.delete('source.zip');
    await assert.rejects(attachReleaseAssets(release, store), /asset differs/);
    assert.equal(uploads.length, 0, 'Detect mismatches before adding any missing assets');
    remote.set('chrome.zip', chrome);
    remote.set('source.zip', Buffer.from(packed));

    const attempt = { version, sha256: release.artifacts.chrome.sha256, outcome: 'unknown' };
    remote.set('chrome-submit-attempt.json', Buffer.from(json({ ...attempt, sha256: 'wrong' })));
    await assert.rejects(attachReleaseAssets(release, store), /different release bytes/);
    remote.set('chrome-submit-attempt.json', Buffer.from(json(attempt)));
    await attachReleaseAssets(release, store);
    await assert.rejects(startAttempt(release, 'chrome', 'submit'), /already attempted/);
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, 'chrome-submit.json'), 'utf8')),
      attempt,
    );
    await rm(join(directory, 'chrome-submit.json'));

    const finish = await startAttempt(release, 'chrome', 'submit');

    assert.equal(
      JSON.parse(await readFile(join(directory, 'chrome-submit.json'), 'utf8')).outcome,
      'unknown',
    );
    await assert.rejects(startAttempt(release, 'chrome', 'submit'), /already attempted/);
    await finish({ outcome: 'submitted' });
    await writeFile(join(directory, 'chrome.zip'), bytes);
    await assert.rejects(releaseAt(directory), /changed/);
    await assert.rejects(extract(archive({ '../escape': bytes }), directory), /Unsafe/);
    await mkdir(join(directory, 'secret-input'));
    await writeFile(join(directory, 'secret-input/.env'), 'not-a-real-secret');
    await assert.rejects(collect(join(directory, 'secret-input')), /Unexpected/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

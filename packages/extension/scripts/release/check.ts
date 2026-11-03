import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { archive, collect, extract, json, releaseAt, sha256, startAttempt } from './common.ts';
import type { Artifact, ReleaseReceipt } from './types.ts';
import { chromeEndpoints, submitChrome } from './chrome.ts';
import { amoToken, firefoxSignArguments } from './firefox.ts';

const endpoints = chromeEndpoints('publisher', 'a'.repeat(32));
const bytes = new Uint8Array([1, 2, 3]);
const version = '0.4.7';

test('Chrome uploads the exact package before staging review, never immediate publication', async () => {
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
    publishType: 'STAGED_PUBLISH',
    blockOnWarnings: true,
  });
  assert.equal(records.at(-1)!.outcome, 'submitted-for-review-held-after-approval');
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

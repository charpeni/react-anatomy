import type { ChromeResponse, ReleaseReceipt } from './types.ts';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleAuth } from 'google-auth-library';
import { reserveChromeAttempt } from './github.ts';
import {
  argumentsFor,
  json,
  main,
  readJson,
  releaseAt,
  repository,
  requestJson,
  startAttempt,
} from './common.ts';

export function chromeEndpoints(publisher: string, item: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(publisher || '') || !/^[a-z]{32}$/.test(item || '')) {
    throw new Error(
      'Set CHROME_PUBLISHER_ID and CHROME_EXTENSION_ID from the Web Store dashboard.',
    );
  }

  const resource = `v2/publishers/${publisher}/items/${item}`;

  return {
    upload: `https://chromewebstore.googleapis.com/upload/${resource}:upload`,
    publish: `https://chromewebstore.googleapis.com/${resource}:publish`,
    status: `https://chromewebstore.googleapis.com/${resource}:fetchStatus`,
  };
}

// Compare numeric version segments (0.4.10 is newer than 0.4.9).
function compareVersions(left: string, right: string) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 4; index++) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) {
      return difference;
    }
  }
  return 0;
}

export function chromeSubmissionAction(status: ChromeResponse, version: string) {
  if (status.takenDown) {
    throw new Error('Chrome has taken down the item. Resolve the store issue before releasing.');
  }

  const published = status.publishedItemRevisionStatus;
  const channels = published?.distributionChannels || [];
  if (channels.some((channel) => compareVersions(channel.crxVersion, version) > 0)) {
    throw new Error('Chrome already has a newer version. Refusing to upload an older release.');
  }
  if (channels.some((channel) => compareVersions(channel.crxVersion, version) === 0)) {
    if (
      published?.state === 'PUBLISHED' &&
      channels.every((channel) => channel.deployPercentage === 100)
    ) {
      return 'already-published';
    }
    throw new Error(
      'This version already exists with a partial or non-public rollout. Check Chrome status.',
    );
  }

  const submitted = status.submittedItemRevisionStatus;
  if (submitted) {
    const sameVersion = submitted.distributionChannels?.some(
      (channel) => compareVersions(channel.crxVersion, version) === 0,
    );
    if (sameVersion && submitted.state === 'PENDING_REVIEW') {
      return 'already-in-review';
    }
    if (sameVersion || !['CANCELLED', 'REJECTED'].includes(submitted.state)) {
      throw new Error(
        `Chrome has a ${submitted.state} submission. Check it before uploading another release.`,
      );
    }
  }
  if (status.lastAsyncUploadState === 'IN_PROGRESS') {
    throw new Error('Another Chrome upload is still processing. Retry after it finishes.');
  }
  return 'upload';
}

export async function submitChrome({
  endpoints,
  headers,
  bytes,
  version,
  request = requestJson<ChromeResponse>,
  wait = (ms: number | undefined) => new Promise((r) => setTimeout(r, ms)),
  record,
}: {
  endpoints: ReturnType<typeof chromeEndpoints>;
  headers: Record<string, string>;
  bytes: Uint8Array<ArrayBuffer>;
  version: string;
  request?: (url: string, options: RequestInit) => Promise<ChromeResponse>;
  wait?: (ms: number) => Promise<unknown>;
  record: (receipt: ReleaseReceipt) => Promise<unknown>;
}) {
  const upload = await request(endpoints.upload, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/zip' },
    body: bytes,
  });

  await record({ outcome: 'upload-received', upload });

  if (upload.crxVersion && upload.crxVersion !== version) {
    throw new Error('Chrome reported a different uploaded version. Check the dashboard.');
  }

  let state = upload.uploadState;

  for (let poll = 0; state === 'IN_PROGRESS' && poll < 24; poll++) {
    await wait(5000);

    const status = await request(endpoints.status, { headers });

    state = status.lastAsyncUploadState;
  }

  if (state !== 'SUCCEEDED') {
    throw new Error(
      `Chrome upload is ${state || 'unknown'}; review was not requested. Check status before any retry.`,
    );
  }

  // This command submits only the upload made above. CWS status cannot identify
  // an unrelated draft; publisher jobs and dashboard uploads must be serialized.
  await record({ outcome: 'upload-succeeded-review-outcome-unknown', upload });

  const submission = await request(endpoints.publish, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publishType: 'DEFAULT_PUBLISH',
      deployInfos: [{ deployPercentage: 100 }],
      blockOnWarnings: true,
    }),
  });

  if (!['PENDING_REVIEW', 'PUBLISHED'].includes(submission.state || '')) {
    await record({ outcome: 'unexpected-submission-state', upload, submission });
    throw new Error(
      `Chrome returned ${submission.state || 'an unknown state'}. Check status before retrying.`,
    );
  }

  await record({ outcome: 'submitted-for-automatic-publication', upload, submission });

  return submission;
}

async function cli() {
  const options = argumentsFor(['plan', 'submit', 'status']);

  if (options.metadata) {
    throw new Error('Chrome listing metadata is managed in the publisher dashboard.');
  }

  const release = await releaseAt(options.directory);
  const config = await readJson<{ publisherId: string; itemId: string }>(
    join(repository, 'release/chrome.json'),
  );
  const publisherId = process.env.CHROME_PUBLISHER_ID ?? config.publisherId;
  const itemId = process.env.CHROME_EXTENSION_ID ?? config.itemId;
  const endpoints = chromeEndpoints(publisherId, itemId);

  if (options.command === 'plan') {
    console.log(
      json({
        version: release.version,
        publisherId,
        itemId,
        artifact: release.artifacts.chrome,
        steps: [
          'Check for an existing submission or a newer published version',
          'Upload prepared ZIP',
          'Wait for upload processing',
          'Submit review with DEFAULT_PUBLISH and 100% rollout',
          'Check status',
          'Chrome publishes automatically after approval',
        ],
        credentials: [
          'CHROME_ACCESS_TOKEN or Google Application Default Credentials with chromewebstore scope',
        ],
        effect: 'Plan only. No authentication or store requests.',
      }),
    );

    return;
  }

  let token = process.env.CHROME_ACCESS_TOKEN;

  try {
    if (!token) {
      const client = await new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/chromewebstore'],
      }).getClient();

      token = (await client.getAccessToken()).token || undefined;
    }
  } catch {
    throw new Error(
      'Google authentication failed. Configure Application Default Credentials for the service account linked to your publisher.',
    );
  }

  if (!token) {
    throw new Error('Google did not issue an access token.');
  }

  const headers = { Authorization: `Bearer ${token}` };

  if (options.command === 'status') {
    const status = await requestJson(endpoints.status, { headers });

    await writeFile(
      join(release.directory, 'chrome-status.json'),
      json({ checkedAt: new Date().toISOString(), status }),
    );
    console.log(json(status));

    return;
  }

  const status = await requestJson<ChromeResponse>(endpoints.status, { headers });
  const action = chromeSubmissionAction(status, release.version);
  if (action !== 'upload') {
    await writeFile(
      join(release.directory, 'chrome-status.json'),
      json({ version: release.version, outcome: action, status }),
    );
    console.log(`Chrome ${release.version}: ${action}. No upload was needed.`);
    return;
  }

  const record = await startAttempt(release, 'chrome', 'submit', {
    itemId,
    publisherId,
    sha256: release.artifacts.chrome.sha256,
    publishType: 'DEFAULT_PUBLISH',
  });

  await reserveChromeAttempt(release);

  await submitChrome({
    endpoints,
    headers,
    bytes: await readFile(join(release.directory, release.artifacts.chrome.file)),
    version: release.version,
    record,
  });
  console.log(
    'Submitted to Chrome for review. Chrome will publish this version to all users automatically after approval.',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(cli);
}

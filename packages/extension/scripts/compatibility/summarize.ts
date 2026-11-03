import type { ValidationReport, ValidationCase } from './types.ts';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

// This is the recorded release-validation matrix. Updating it requires running
// the named browser builds first; filtered or failed reports are rejected.
const local = [
  'chrome-Chrome-140.0.7339.207',
  'chrome-Chrome-156.0.8078.80',
  'firefox-140.0',
  'firefox-159.0',
];
const publicApps = ['chrome-Chrome-156.0.8078.80-public', 'firefox-159.0-public'];
const extensionVersion = JSON.parse(await readFile('extension/manifest.json', 'utf8')).version;
const expected = [
  ...JSON.parse(await readFile('artifacts/compatibility/cases.json', 'utf8')).map(
    (item: ValidationCase) => item.id,
  ),
  'next-development',
  'next-production',
].sort();
const browsers = [];

for (const folder of [...local, ...publicApps]) {
  const report: ValidationReport = JSON.parse(
    await readFile(`artifacts/compatibility/results/${folder}/results.json`, 'utf8'),
  );

  assert(report.passed && report.finishedAt, `Incomplete or failed report: ${folder}`);
  assert.equal(report.extensionVersion, extensionVersion, `Stale extension version: ${folder}`);
  assert(
    report.cases.every((item) => item.status === 'passed'),
    `Failed case: ${folder}`,
  );

  const isPublic = publicApps.includes(folder);

  assert.deepEqual(
    report.cases.map((item) => item.id).sort(),
    isPublic ? ['react-dev', 'shadcn-dashboard'] : expected,
    `Incomplete cases: ${folder}`,
  );
  browsers.push({
    browser: report.browser,
    version: report.browserVersion,
    extensionVersion: report.extensionVersion,
    panelSha256: report.panelSha256,
    suite: isPublic ? 'public applications' : 'pinned local workloads',
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    cases: report.cases.map((item) => ({
      id: item.id,
      application: item.application || 'React Router 7.18.5 validation workspace',
      mode: item.mode || 'deployed production',
      reactVersion: item.runtime!.react,
      nextVersion: item.runtime!.next,
      reactDevtoolsHookPresent: item.runtime!.reactDevtoolsHookPresent,
      components: item.capture!.components,
      planes: item.capture!.planes,
      initialPartial: item.capture!.partial,
      expandedCapture: item.expandedCapture || null,
      selectedComponent: item.selectedComponent || null,
      checks: item.checks,
      sourceErrorCount: item.sourceErrors?.length ?? null,
      status: item.status,
    })),
  });
}

assert.equal(
  new Set(browsers.map((item) => item.panelSha256)).size,
  1,
  'The browser reports tested different panel bundles',
);

const summary = {
  recordedAt: new Date().toISOString(),
  platform: 'Linux x64',
  extensionVersion,
  localChecks: browsers
    .filter((item) => item.suite === 'pinned local workloads')
    .reduce((total, item) => total + item.cases.length, 0),
  publicChecks: browsers
    .filter((item) => item.suite === 'public applications')
    .reduce((total, item) => total + item.cases.length, 0),
  notes: [
    'Chrome builds are Chrome for Testing.',
    'Firefox source page errors are not collected; behavior assertions run in both browsers.',
    'Public React versions are unknown; deployed Next.js versions are reported by the pages.',
    'Next.js 16.4.4 reports its bundled React canary version.',
    'This validates client React DOM inspection, not a server component tree or pixel-perfect reconstruction.',
  ],
  browsers,
};

await mkdir('../../docs/validation', { recursive: true });
await writeFile('../../docs/validation/2026-11-02.json', JSON.stringify(summary, null, 2) + '\n');
console.log(
  `Recorded ${summary.localChecks} local checks and ${summary.publicChecks} public-app checks in docs/validation/2026-11-02.json.`,
);

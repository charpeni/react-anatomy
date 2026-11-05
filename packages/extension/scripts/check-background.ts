import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from './browser-options.ts';
import { startFixtureServer } from './fixture-server.ts';
import { pageAgent } from '../src/inspector/page-agent.ts';
import { makeSnapshotRenderer } from '../src/inspector/snapshot.ts';
import type { CaptureBudget, Snapshot } from '../src/inspector/types.ts';

const fixture = await startFixtureServer();
const browser = await chromium.launch({ headless: true, ...browserOptions() });
const capture: (request: { action: 'capture' } & CaptureBudget) => Snapshot = pageAgent;
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(fixture.url + '/deep');
  await page.locator('[data-region="list"]').waitFor();
  await page.evaluate(() => {
    document.documentElement.style.backgroundColor = 'rgb(250, 240, 230)';
    document.body.style.backgroundColor = 'rgb(12, 34, 56)';
  });
  const overview = await page.evaluate(capture, { action: 'capture' as const });
  assert.equal(
    overview.backgroundColor,
    'rgb(12, 34, 56)',
    'Capture must preserve the background outside the React root',
  );
  const list = await page.evaluate(
    () =>
      [...window.__STRATA_INSPECTOR_V1__!.elements].find(([, hosts]) =>
        hosts.some((el) => el.getAttribute('data-region') === 'list'),
      )?.[0],
  );
  assert(list);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('main')!.style.backgroundColor = 'rgba(255, 0, 0, 0.5)';
    document.querySelector<HTMLElement>('[data-region="list"]')!.style.backgroundColor =
      'rgba(0, 0, 255, 0.25)';
  });
  const focused = await page.evaluate(capture, { action: 'capture' as const, scopeId: list });
  assert.equal(
    focused.backgroundColor,
    'rgb(134, 17, 28)',
    'Focus must compose ancestor backgrounds without painting its own background twice',
  );
  const rendered = await page.evaluate(`(() => {
    const snapshot = ${JSON.stringify(focused)};
    const render = (${makeSnapshotRenderer.toString()})(snapshot);
    const parent = document.createElement('div');
    parent.innerHTML = render(snapshot.nodes[0], [], true);
    const child = document.createElement('div');
    child.innerHTML = render(snapshot.nodes[0], [], false);
    return {root:parent.firstElementChild.style.backgroundColor,child:child.firstElementChild.style.backgroundColor};
  })()`);
  assert.deepEqual(
    rendered,
    { root: 'rgb(134, 17, 28)', child: '' },
    'Only base planes should paint the captured context',
  );

  for (const scheme of ['light', 'dark'] as const) {
    await page.evaluate((scheme) => {
      document.documentElement.style.backgroundColor = 'transparent';
      document.documentElement.style.colorScheme = scheme;
      document.body.style.backgroundColor = 'transparent';
      document.querySelector<HTMLElement>('main')!.style.backgroundColor = 'transparent';
      document.querySelector<HTMLElement>('[data-region="list"]')!.style.backgroundColor =
        'transparent';
    }, scheme);
    const expected = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'Canvas';
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    const snapshot = await page.evaluate(capture, { action: 'capture' as const });
    assert.equal(
      snapshot.backgroundColor,
      expected,
      `Transparent ${scheme} pages must preserve the browser's canvas color`,
    );
  }
  console.log(
    'Passed: page background, focused ancestry, alpha composition, transparent child planes, and light/dark browser canvas.',
  );
} finally {
  await browser.close();
  await fixture.close();
}

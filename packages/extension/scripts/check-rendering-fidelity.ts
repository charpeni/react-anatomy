import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { browserOptions } from './browser-options.ts';
import { startFixtureServer } from './fixture-server.ts';
import { launchExtension, openDevtoolsPanel } from './chrome-harness.ts';
import { pageAgent } from '../src/inspector/page-agent.ts';
import { makeSnapshotRenderer } from '../src/inspector/snapshot.ts';
import { makeLayerHierarchy } from '../src/inspector/layers.ts';
import { makeScene } from '../src/inspector/scene.ts';
import type { CaptureBudget, Snapshot } from '../src/inspector/types.ts';

const fixture = await startFixtureServer();
const browser = await chromium.launch({ headless: true, ...browserOptions() });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(fixture.url + '/fidelity');
  await page.locator('fixture-time').first().waitFor();
  const constructors = await page.locator('html').getAttribute('data-constructors');
  const capture: (request: { action: 'capture' } & CaptureBudget) => Snapshot = pageAgent;
  const snapshot = await page.evaluate(capture, { action: 'capture' as const });
  assert(!snapshot.visualLimited);
  assert.equal(
    await page.locator('html').getAttribute('data-constructors'),
    constructors,
    "Capture must not construct the application's custom elements",
  );
  assert(
    snapshot.html?.includes('2 days ago'),
    "Capture must retain rendered shadow text instead of a custom element's light-DOM fallback",
  );
  assert(!snapshot.html?.includes('Nov 3, 2026'));
  assert(snapshot.html?.includes('Visible branch'));
  assert(
    !snapshot.html?.includes('Unassigned hidden text'),
    'Slots must capture assigned content once, without invisible light-DOM children',
  );
  assert(snapshot.html?.includes('placeholder="Go to file"'));

  const sourceRows = await page.locator('tr').evaluateAll((rows) =>
    rows.map((row) => ({
      height: row.getBoundingClientRect().height,
      cells: [...row.children].map((cell) => ({
        x: cell.getBoundingClientRect().left - row.getBoundingClientRect().left,
        width: cell.getBoundingClientRect().width,
        border: getComputedStyle(cell).borderBottom,
      })),
    })),
  );
  const rows = snapshot.nodes.filter((node) => node.name === 'Row');
  assert.equal(rows.length, 2);
  const view = await browser.newPage();
  for (const [index, row] of rows.entries()) {
    const actual = await view.evaluate<(typeof sourceRows)[number] & { text: string }>(`(() => {
      const snapshot = ${JSON.stringify(snapshot)};
      const render = (${makeSnapshotRenderer.toString()})(snapshot);
      document.body.innerHTML = render(${JSON.stringify(row)}, []);
      const row = document.querySelector('tr[data-anatomy-host]');
      if(!row)return null;
      return {height:row.getBoundingClientRect().height,cells:[...row.children].map(cell=>({
        x:cell.getBoundingClientRect().left-row.getBoundingClientRect().left,
        width:cell.getBoundingClientRect().width,border:getComputedStyle(cell).borderBottom
      })),text:row.innerText};
    })()`);
    assert(actual, 'A row must survive serialization into the plane');
    assert(actual.text.includes('2 days ago'));
    assert.equal(actual.cells.length, sourceRows[index].cells.length);
    for (let cell = 0; cell < actual.cells.length; cell++) {
      assert(Math.abs(actual.cells[cell].x - sourceRows[index].cells[cell].x) < 1);
      assert(Math.abs(actual.cells[cell].width - sourceRows[index].cells[cell].width) < 1);
      assert.equal(actual.cells[cell].border, sourceRows[index].cells[cell].border);
    }
    assert(Math.abs(actual.height - sourceRows[index].height) < 1);
  }
  const dateCell = snapshot.nodes.find((node) => node.name === 'DateCell')!;
  const cellTag = await view.evaluate(`(() => {
    document.body.innerHTML = (${makeSnapshotRenderer.toString()})(${JSON.stringify(snapshot)})(${JSON.stringify(dateCell)}, []);
    return document.querySelector('[data-anatomy-host="${dateCell.hosts[0]}"]')?.tagName;
  })()`);
  assert.equal(cellTag, 'TD', 'Individual table cells need valid table context too');
  for (const [node, tag] of [
    [rows[0], 'TR'],
    [dateCell, 'TD'],
  ] as const) {
    const focused = await page.evaluate(capture, { action: 'capture' as const, scopeId: node.id });
    const detail = await view.evaluate<{ tag?: string; text?: string }>(`(() => {
      const snapshot = ${JSON.stringify(focused)};
      document.body.innerHTML = (${makeSnapshotRenderer.toString()})(snapshot)(snapshot.nodes[0], []);
      const host = document.querySelector('[data-anatomy-host="${node.hosts[0]}"]');
      return {tag:host?.tagName,text:host?.innerText};
    })()`);
    assert.equal(detail.tag, tag, 'A fresh scoped capture must retain its table host');
    assert(detail.text?.includes('2 days ago'), 'Focused table hosts must retain their content');
  }
  await view.close();
  console.log(
    'Passed: custom elements stay inert, shadow/slot text, input placeholders, table row/cell structure, column positions and borders.',
  );

  const scene = makeScene(makeLayerHierarchy(snapshot.nodes));
  assert(scene.layers.some((node) => node.name === 'Row'));
  const harness = await launchExtension();
  try {
    const source = harness.context.pages()[0];
    await source.goto(fixture.url + '/fidelity');
    await source.locator('fixture-time').first().waitFor();
    const { session, panelSession } = await openDevtoolsPanel(harness);
    await harness.send(
      'Emulation.setDeviceMetricsOverride',
      { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
      session,
    );
    const run = <T = unknown>(expression: string) => harness.evaluate<T>(expression, panelSession);
    await harness.until(
      () =>
        run(
          `!!document.querySelector('.tree-scroll')&&!document.querySelector('[aria-label="Capture"]').disabled`,
        ),
      'Capture did not finish',
    );
    const check = () =>
      run<boolean>(`(() => {
      const visible=el=>getComputedStyle(el).visibility==='visible'&&el.getBoundingClientRect().width>0;
      const rows=[...document.querySelectorAll('.plane-content tr[data-anatomy-host]')].filter(visible);
      const dates=[...document.querySelectorAll('.plane-content span')].filter(el=>el.textContent==='2 days ago'&&visible(el));
      return rows.length===2&&dates.length>=2&&!!document.querySelector('.plane-content input[placeholder="Go to file"]')&&rows.every(row=>getComputedStyle(row.cells[0]).borderBottomWidth==='1px');
    })()`);
    assert(await check(), 'Assembled planes must retain rows, dates, borders and placeholders');
    await run(`document.querySelector('[aria-label="Explode view"]').click()`);
    await harness.until(
      () => run(`!!document.querySelector('[aria-label="Assemble"]')`),
      'Explode did not commit',
    );
    assert(await check(), 'Exploded planes must retain the same visible details');
    await mkdir('artifacts/rendering-fidelity', { recursive: true });
    const shot = await harness.send('Page.captureScreenshot', { format: 'png' }, session);
    await writeFile('artifacts/rendering-fidelity/exploded.png', Buffer.from(shot.data, 'base64'));
    console.log('Passed: native DevTools assembled and exploded detail fidelity.');
  } finally {
    await harness.close();
  }
} finally {
  await browser.close();
  await fixture.close();
}

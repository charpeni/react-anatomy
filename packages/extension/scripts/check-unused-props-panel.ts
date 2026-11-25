import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchExtension, openDevtoolsPanel } from './chrome-harness.ts';
import { startUnusedPropsServer } from './unused-props/serve.ts';

// The "Unused props" section in the real extension: a positive, a near miss,
// and each way the section declines to answer. The analysis is loaded the way
// a developer loads it, through the panel's file input.

await mkdir('artifacts', { recursive: true });

const fixture = await startUnusedPropsServer();
const h = await launchExtension();

try {
  const page = h.context.pages()[0];
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(fixture.url + '/');
  await page.getByRole('button', { name: 'Export CSV' }).waitFor();

  const { session, panelSession } = await openDevtoolsPanel(h);
  const run = <T = unknown>(expression: string) => h.evaluate<T>(expression, panelSession);

  // Wide enough that the details pane sits beside the tree in the screenshot.
  await h.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false },
    session,
  );

  const section = `document.querySelector('.unused-props')`;
  const body = () => run<string>(`${section}?.textContent ?? ''`);

  const captured = (name: string) =>
    h.until(
      () =>
        run(
          `Array.from(document.querySelectorAll('.node-name')).some(n=>n.textContent===${JSON.stringify(name)})`,
        ),
      `${name} was not captured`,
    );

  const select = async (name: string, nth = 0) => {
    await run(
      `Array.from(document.querySelectorAll('.tree-select')).filter(el=>el.querySelector('.node-name').textContent===${JSON.stringify(name)})[${nth}].click()`,
    );
    await h.until(
      () =>
        run(
          `document.querySelector('.inspector-heading h2')?.textContent===${JSON.stringify(name)}`,
        ),
      `${name} was not selected`,
    );
  };

  /** Waits for the audit of the selected component and returns each prop's tier. */
  const tiers = async (expected: string) => {
    await h.until(
      () => run(`!!${section}?.querySelector('[data-prop=${JSON.stringify(expected)}]')`),
      `The audit did not list ${expected}`,
    );

    return run<Record<string, string>>(
      `Object.fromEntries(Array.from(${section}.querySelectorAll('[data-prop]')).map(el=>[el.dataset.prop,el.dataset.tier]))`,
    );
  };

  const unavailable = async (why: string) => {
    await h.until(
      () =>
        run(
          `${section}?.querySelector('.unused-unavailable')?.dataset.why===${JSON.stringify(why)}`,
        ),
      `Expected the section to report ${why}`,
    );

    return body();
  };

  const loadAnalysis = async () => {
    const text = await readFile('dist/unused-props-report.json', 'utf8');

    await run(
      `(()=>{const input=document.querySelector('.unused-props input[type=file]');const data=new DataTransfer();data.items.add(new File([${JSON.stringify(text)}],'unused-props-report.json',{type:'application/json'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
  };

  await captured('PlanCard');
  await select('PlanCard');

  // Nothing is claimed, and the page is not read, before an analysis is loaded.
  await h.until(async () => (await body()).includes('Load a source analysis'), 'Missing the hint');
  assert.equal(await run(`${section}.querySelectorAll('[data-prop]').length`), 0);

  await run(`${section}.querySelector('summary').click()`);
  assert.equal(
    await run(`${section}.querySelector('button').textContent`),
    'Load source analysis…',
  );
  await loadAnalysis();

  // The first card is the Team plan, which is on trial.
  const team = await tiers('legacyTheme');

  assert.deepEqual(team, {
    legacyTheme: 'candidate',
    trialDays: 'this-render',
    trackingId: 'indirect',
    plan: 'used',
    selected: 'used',
    onSelect: 'used',
    compareTo: 'used',
  });
  assert.match(
    await body(),
    /1 of the 7 props on this <PlanCard> element has no reader in PlanCard/,
  );
  assert.match(await body(), /1 without a reader/);

  // The candidate is open, with the caller's line and the receiving component.
  const evidence = await run<string>(
    `${section}.querySelector('[data-prop="legacyTheme"] .unused-row-body').textContent`,
  );

  assert.match(evidence, /parameter list does not name legacyTheme/);
  assert.match(evidence, /BillingApp\.tsx:38/);
  assert.match(evidence, /legacyTheme="dark"/);
  assert.match(evidence, /PlanCard\.tsx:15/);

  // The near miss explains itself when opened.
  await run(`${section}.querySelector('[data-prop="trackingId"] .unused-row-head').click()`);

  const nearMiss = await run<string>(
    `${section}.querySelector('[data-prop="trackingId"]').textContent`,
  );

  assert.match(nearMiss, /Read only in an event handler/);
  assert.match(nearMiss, /would report this prop as unused/);
  assert.match(nearMiss, /PlanCard\.tsx:18/);
  assert.match(await body(), /Before removing a prop, check other callers, tests, types/);

  const shot = await h.send('Page.captureScreenshot', { format: 'png' }, session);

  await writeFile('artifacts/unused-props-panel.png', Buffer.from(shot.data, 'base64'));

  // The Business plan is not on trial: trialDays is not on this instance.
  await select('PlanCard', 1);
  await h.until(
    async () => !Object.hasOwn(await tiers('legacyTheme'), 'trialDays'),
    'trialDays should be absent on the second card',
  );

  // Abstentions that keep the rows.
  await select('SeatMeter');
  assert.equal((await tiers('version')).version, 'unknown');
  await select('LegacyTotal');
  assert.deepEqual(await tiers('currency'), { amount: 'unknown', currency: 'unknown' });
  await select('Toolbar');
  assert.equal((await tiers('onPrint')).onPrint, 'dead-end');
  await select('EmptyState');
  assert.equal((await tiers('children')).children, 'candidate');

  // More props than the page reports: the list is marked partial, the written
  // props past the cut are still judged from source, and nothing is invented.
  await select('UsageHistory');

  const wide = await tiers('legacyScale');

  assert.equal(wide.legacyScale, 'candidate');
  assert.equal(wide.label, 'used');
  assert.equal(wide.day199, 'this-render');
  assert.equal(wide.day200, undefined, 'A prop the page did not report must not be listed');
  assert.equal(Object.keys(wide).length, 202);
  assert.equal(await run(`${section}.querySelector('.unused-summary').dataset.partial`), 'true');
  assert.match(await body(), /partial list/);
  assert.match(await body(), /1 of the 202 props listed for this <UsageHistory> element/);
  assert.match(await body(), /The list is incomplete/);
  assert.match(
    await body(),
    /holds more props than Anatomy reads from the page \(200 names were read\)/,
  );
  assert.doesNotMatch(
    await run<string>(`${section}.querySelector('[data-prop="legacyScale"]').textContent`),
    /was not on the instance/,
  );

  // An ordinary component is not marked partial.
  await select('EmptyState');
  await tiers('children');
  assert.equal(await run(`${section}.querySelector('.unused-summary').dataset.partial`), undefined);

  // Not supported: the implementation cannot be analyzed.
  await select('Tooltip');
  assert.match(await unavailable('unsupported'), /implemented outside the analyzed files/);
  await select('Tracked');
  assert.match(await unavailable('unsupported'), /withTracking/);

  // Not observed: this instance has no call-site record.
  await select('PlanLink');
  assert.match(await unavailable('not-observed'), /createElement or cloneElement/);

  // The same app built without metadata: every instance is unobserved.
  await page.goto(fixture.url + '/plain');
  await page.getByRole('button', { name: 'Export CSV' }).waitFor();
  await h.until(
    () => run(`!document.querySelector('[aria-label="Capture"]').disabled`),
    'The panel did not settle after navigation',
  );
  await run(`document.querySelector('[aria-label="Capture"]').click()`);
  await captured('PlanCard');
  await select('PlanCard');
  assert.match(await unavailable('not-observed'), /built without React Anatomy source metadata/);
  assert.equal(await run(`${section}.querySelectorAll('[data-prop]').length`), 0);

  assert.deepEqual(errors, [], 'The fixture page reported errors');
  console.log('Unused props panel: candidate, near miss and abstentions verified in the extension');
} finally {
  await h.close();
  await fixture.close();
}

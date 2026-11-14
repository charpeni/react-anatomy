import assert from 'node:assert/strict';
import { pageAgent } from '../src/inspector/page-agent.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchExtension, openDevtoolsPanel } from './chrome-harness.ts';
import { startFixtureServer } from './fixture-server.ts';

await mkdir('artifacts', { recursive: true });

const fixture = await startFixtureServer();
const h = await launchExtension();

try {
  const page = h.context.pages()[0];
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(fixture.url + '/');
  await page.getByRole('button', { name: 'Update app (0)' }).waitFor();

  const { session, panelSession } = await openDevtoolsPanel(h);

  const run = <T = unknown>(expression: string) => h.evaluate<T>(expression, panelSession);

  const text = () => run<string>(`document.querySelector('.props-inspector').textContent`);

  const select = (name: string) =>
    run(
      `Array.from(document.querySelectorAll('.tree-select')).find(el=>el.querySelector('.node-name').textContent===${JSON.stringify(name)}).click()`,
    );

  const click = (label: string) =>
    run(`document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`);

  const expand = async (path: string) => {
    await h.until(
      () =>
        run(`document.querySelector('[data-prop-path=${JSON.stringify(path)}] summary')!==null`),
      `Missing ${path}`,
    );
    await run(`document.querySelector('[data-prop-path=${JSON.stringify(path)}] summary').click()`);
  };

  const filter = async (value: string) => {
    await run(
      `(()=>{const el=document.querySelector('[aria-label="Filter prop names"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await h.until(
      () => run(`document.querySelector('.props-inspector [aria-busy="true"]')===null`),
      'Filter did not settle',
    );
  };

  await h.until(
    () =>
      run(
        `Array.from(document.querySelectorAll('.node-name')).some(n=>n.textContent==='PropsFixture')`,
      ),
    'Props fixture missing',
  );
  await select('PropsFixture');
  await h.until(async () => (await text()).includes('9007199254740993n'), 'Props did not load');

  const root = await text();

  for (const value of [
    'undefined',
    'NaN',
    'Infinity',
    '-0',
    'ƒ fixtureCallback()',
    'Symbol(fixture)',
    'Array(125)',
    'Map(2)',
    'Set(2)',
    '2026-01-02',
    'version: 1',
    'children: <span />',
  ]) {
    assert(root.includes(value), `Missing typed prop ${value}`);
  }

  for (const path of [
    'props.settings',
    'props.settings.account',
    'props.settings.account.team',
    'props.settings.account.team.preferences',
    'props.settings.account.team.preferences.palette',
  ]) {
    await expand(path);
  }

  await h.until(async () => (await text()).includes('#315cf5'), 'Deep props were truncated');
  await expand('props.items');
  await h.until(
    () => run(`document.querySelector('[data-prop-path="props.items[49]"]')!==null`),
    'First array page missing',
  );
  assert.equal(await run(`document.querySelector('[data-prop-path="props.items[50]"]')`), null);
  await run(`document.querySelector('[data-prop-path="props.items"] .props-more').click()`);
  await h.until(
    () => run(`document.querySelector('[data-prop-path="props.items[99]"]')!==null`),
    'Second array page missing',
  );
  await run(`document.querySelector('[data-prop-path="props.items"] .props-more').click()`);
  await expand('props.items[124]');
  await h.until(
    async () => (await text()).includes('Item 124'),
    'Last item could not be inspected',
  );
  await expand('props.circular');
  await h.until(
    async () => (await text()).includes('Circular reference'),
    'Cycle was not identified',
  );
  await expand('props.guarded');
  await h.until(
    async () => (await text()).includes('[Getter — not evaluated]'),
    'Getter was not identified',
  );
  await expand('props.hostile');
  await h.until(
    async () => (await text()).includes('This value cannot be inspected'),
    'Throwing object was not contained',
  );
  await expand('props.children');
  await expand('props.children.props');
  await h.until(
    async () => (await text()).includes('Child prop content'),
    'React children are missing',
  );
  assert(!(await text()).includes('_owner'), 'React private graph leaked into children');
  await expand('props.lookup');
  await expand('props.lookup[0]');
  await expand('props.lookup[0].value');
  await h.until(async () => (await text()).includes('score: 7'), 'Map values missing');
  await expand('props.tags');
  await h.until(async () => (await text()).includes('engineering'), 'Set values missing');
  await expand('props.longText');
  await h.until(
    () =>
      run(
        `document.querySelector('[data-prop-path="props.longText"] .prop-string')?.textContent.length===10000`,
      ),
    'Long string first page missing',
  );
  await run(`document.querySelector('[data-prop-path="props.longText"] .props-more').click()`);
  await h.until(
    () =>
      run(
        `document.querySelector('[data-prop-path="props.longText"] .prop-string')?.textContent.endsWith('THE END')`,
      ),
    'Long string was silently truncated',
  );
  await filter('version');
  await h.until(
    () => run(`document.querySelectorAll('.props-inspector [data-prop-path]').length===1`),
    'Prop name filter did not work',
  );

  const beforeCapture = await run(`document.querySelector('.footer-count').textContent`);
  const beforeDOM = await page.locator('body').innerHTML();

  await page.evaluate(() => window.updateInspectedProps!());
  await page.waitForTimeout(150);
  assert.equal(
    await page.locator('body').innerHTML(),
    beforeDOM,
    'Fixture unexpectedly changed the DOM',
  );
  await click('Refresh props');
  await h.until(
    async () => (await text()).includes('version: 2'),
    'Refresh did not read the current committed props',
  );
  assert.equal(
    await run(`document.querySelector('.footer-count').textContent`),
    beforeCapture,
    'Props refresh recaptured the page',
  );
  await filter('');
  await h.until(async () => (await text()).includes('settings'), 'Clearing the filter failed');
  await click('Collapse prop values');
  await page.evaluate(() => window.unmountInspectedProps!());
  await page.waitForTimeout(100);
  await click('Refresh props');
  await h.until(
    async () => (await text()).includes('no longer mounted'),
    'Unmounted component was read as current',
  );
  // Hold one real page response until after selection changes to another component.
  await run(
    `(()=>{const original=chrome.devtools.inspectedWindow.eval;chrome.devtools.inspectedWindow.eval=(expression,callback)=>{if(expression.includes('"action":"props"')){chrome.devtools.inspectedWindow.eval=original;return original(expression,(result,error)=>{globalThis.flushDelayedProps=()=>{callback(result,error);delete globalThis.flushDelayedProps;};});}return original(expression,callback);};})()`,
  );
  await select('ProjectCard');
  await h.until(
    () => run(`typeof globalThis.flushDelayedProps==='function'`),
    'Did not hold the props response',
  );
  await select('ProgressBar');
  await h.until(
    async () => (await text()).includes('progress: 72'),
    'Second selection did not load',
  );
  await run(`globalThis.flushDelayedProps()`);
  await page.waitForTimeout(150);
  assert.equal(
    await run(`document.querySelector('.inspector-heading h2').textContent`),
    'ProgressBar',
  );
  assert((await text()).includes('progress: 72'), 'Late response replaced the selected props');
  assert.equal(
    await page.evaluate(() => window.__REACT_ANATOMY_INSPECTOR_V1__!.propSessions.size),
    1,
    'Obsolete prop sessions were retained',
  );
  await select('ProjectCard');
  await h.until(
    async () => (await text()).includes('project: Object'),
    'Selecting another component did not recover',
  );
  await expand('props.project');
  await expand('props.project.people');
  await h.until(async () => (await text()).includes('people: Array'), 'Project array is missing');
  await h.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    session,
  );
  await click('Focus subtree');
  await h.until(
    () =>
      run(
        `!!document.querySelector('.focus-navigation')&&!document.querySelector('[aria-label="Capture"]').disabled`,
      ),
    'Focused capture did not finish',
  );
  await page.waitForTimeout(350);

  const shot = await h.send('Page.captureScreenshot', { format: 'png' }, session);

  await writeFile('artifacts/props-inspector.png', Buffer.from(shot.data, 'base64'));
  assert.equal(await page.evaluate(() => window.propGetterCalls || 0), 0, 'A getter ran');
  assert.equal(await page.evaluate(() => window.propCallbackCalls || 0), 0, 'A callback ran');
  assert.deepEqual(errors, []);

  // The transport must return only JSON-safe data, even for non-JSON props.
  const agent = pageAgent.toString();
  const roundTrip = await page.evaluate<{ branch: { ok: boolean }; released: { ok: boolean } }>(
    `(()=>{${agent};return (()=>{const capture=pageAgent({action:'capture'});const node=capture.nodes.find(n=>n.name==='ProjectCard');const result=pageAgent({action:'props',id:node.id});const branch=pageAgent({action:'props-read',token:result.token,handle:result.root.handle});pageAgent({action:'props-release',token:result.token});return {branch:JSON.parse(JSON.stringify(branch)),released:pageAgent({action:'props-read',token:result.token,handle:result.root.handle})};})();})()`,
  );

  assert(roundTrip.branch.ok);
  assert.equal(roundTrip.released.ok, false);
  console.log(
    'Passed: deep props, paging, types, cycles, getters, React children, Map/Set, long strings, filtering, current Fiber refresh without DOM changes, unmount, selection races, session cleanup, and JSON-safe transport.',
  );
} finally {
  await h.close();
  await fixture.close();
}

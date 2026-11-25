import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { launchFirefox } from './firefox-harness.ts';
import { startFixtureServer } from './fixture-server.ts';

await mkdir('artifacts/firefox', { recursive: true });

const fixture = await startFixtureServer();
let h!: Awaited<ReturnType<typeof launchFirefox>>;

type Evaluate = <T = unknown>(expression: string) => Promise<T>;

const rows = (evaluate: Evaluate, list: string) =>
  evaluate<[string, string][]>(
    `[...document.querySelectorAll('[aria-labelledby="context-${list}-heading"] .context-row')].map(el=>[el.querySelector('.context-row-name').firstChild.textContent,el.querySelector('.context-row-evidence')?.textContent||''])`,
  );

const select = (evaluate: Evaluate, name: string) =>
  h.until(
    () =>
      evaluate(
        `(()=>{const el=[...document.querySelectorAll('.tree-select')].find(el=>el.querySelector('.node-name').textContent===${JSON.stringify(name)});if(!el)return false;el.click();return true;})()`,
      ),
    `Missing component: ${name}`,
  );

const click = (evaluate: Evaluate, label: string) =>
  h.until(
    () =>
      evaluate(
        `(()=>{const el=[...document.querySelectorAll('.context-readers button')].find(el=>(el.getAttribute('aria-label')||el.textContent.trim())===${JSON.stringify(label)});if(!el||el.disabled)return false;el.click();return true;})()`,
      ),
    `Context control never became available: ${label}`,
  );

const names = (list: [string, string][]) => list.map(([name]) => name);

try {
  h = await launchFirefox();
  console.log(`Testing context readers in native Firefox ${h.version}`);
  await h.navigate(fixture.url + '/context');
  await h.until(
    () => h.page(`Boolean(document.querySelector('#toggle-theme'))`),
    'Fixture did not mount',
  );
  await h.openPanel();

  const run: Evaluate = (expression) => h.panel(expression);

  const evidence = () =>
    run<string>(`document.querySelector('.context-evidence')?.textContent||''`);

  await select(run, 'ThemedHeading');
  assert.equal(await run(`document.querySelector('.context-readers').open`), false);
  assert.equal(
    await h.page(`window.__REACT_ANATOMY_INSPECTOR_V1__.contextSession===undefined`),
    true,
    'Contexts were scanned before the section was opened',
  );
  await run(`document.querySelector('.context-readers > summary').click()`);
  await h.until(
    async () => (await rows(run, 'readers')).length === 3,
    'ThemeContext readers did not load',
  );
  assert.deepEqual(names(await rows(run, 'readers')), [
    'ThemedHeading',
    'ThemedBadge',
    'ThemedToast',
  ]);
  assert.deepEqual(names(await rows(run, 'bystanders')), ['StaticCaption']);
  assert((await evidence()).startsWith('Evidence: dependencies.'));

  const toast = await run<string>(
    `(()=>{const el=document.querySelectorAll('[aria-labelledby="context-readers-heading"] .context-row')[2];el.click();return el.dataset.contextInstance;})()`,
  );

  await h.until(
    () => run(`document.querySelector('.inspector-heading h2').textContent==='ThemedToast'`),
    'Reader was not selected',
  );
  assert.equal(
    await run(`document.querySelector('.tree-row.selected .tree-select').dataset.tree`),
    toast,
  );

  // Firefox, too, reports commits only after the opt-in reload.
  assert.equal(await h.page(`typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__`), 'undefined');

  const before = await run(`document.querySelector('.footer-count').textContent`);

  await click(run, 'Reload page to measure renders');
  await h.until(
    () =>
      run(
        `document.querySelector('.footer-count')?.textContent!==${JSON.stringify(before)}&&document.querySelector('[aria-label="Capture"]')?.disabled===false`,
      ),
    'The panel did not reconnect after the reload',
  );
  await h.until(
    () => h.page(`window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers.size===1`),
    'React did not find the commit hook',
  );
  assert.equal(
    await h.page(`Object.hasOwn(window,'__REACT_DEVTOOLS_GLOBAL_HOOK__')`),
    false,
    'The commit hook must stay out of the way of React DevTools',
  );
  await select(run, 'ThemedHeading');
  await h.until(async () => (await rows(run, 'readers')).length === 3, 'Readers did not reload');

  const start = await h.page<Record<string, number>>(`({...window.contextFixtureRenders})`);

  await click(run, 'Record renders');
  await h.until(
    async () => (await evidence()).startsWith('Evidence: measured renders.'),
    'Recording did not start',
  );
  await h.clickPage('#toggle-theme');
  await h.clickPage('#toggle-theme');
  await h.clickPage('#rerender-app');
  await h.until(
    async () => (await evidence()).includes('Recording 3 commits, 2 with a new provider value'),
    'Commits were not counted while recording',
  );

  const end = await h.page<Record<string, number>>(`({...window.contextFixtureRenders})`);

  assert.deepEqual(
    ['ThemedHeading', 'ThemedBadge', 'ThemedToast', 'StaticCaption'].map(
      (name) => end[name] - start[name],
    ),
    [3, 2, 3, 1],
  );
  assert.deepEqual(await rows(run, 'readers'), [
    ['ThemedHeading', '3 renders · 2 with a new value'],
    ['ThemedBadge', '2 renders · 2 with a new value'],
    ['ThemedToast', '3 renders · 2 with a new value'],
  ]);
  assert.deepEqual(await rows(run, 'bystanders'), [['StaticCaption', '1 render']]);
  await h.screenshot(`artifacts/firefox/${h.version}-context-readers.png`);
  await click(run, 'Stop recording');
  await h.until(
    async () => (await evidence()).includes('Recorded 3 commits'),
    'Recording did not stop',
  );

  // The toolbar window cannot reload the page with a hook, and says so.
  await h.navigate(fixture.url + '/context');
  await h.until(
    () => h.page(`Boolean(document.querySelector('#toggle-theme'))`),
    'Fixture did not reload',
  );
  await h.until(
    () => run(`document.querySelector('.session')?.textContent.endsWith('/context')`),
    'Panel did not reconnect',
  );

  const popup = await h.openToolbarInspector();

  await select(popup, 'ThemedBadge');
  await popup(`document.querySelector('.context-readers > summary').click()`);
  await h.until(
    async () => (await rows(popup, 'readers')).length === 3,
    'Toolbar context readers failed',
  );

  const section = await popup<string>(`document.querySelector('.context-readers').textContent`);

  assert(section.includes('Open React Anatomy from its DevTools panel'));
  assert(!section.includes('Reload page to measure renders'));
  assert(!section.includes('Record renders'));
  console.log(
    'Passed: Firefox context readers, navigation to the exact instance, opt-in reload, measured renders against the fixture’s own counts, and the toolbar window.',
  );
} catch (error) {
  if (h) {
    try {
      await h.screenshot('artifacts/firefox/context-failure.png');
    } catch {}
  }

  throw error;
} finally {
  await h?.close();
  await fixture.close();
}

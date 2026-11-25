import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pageAgent } from '../src/inspector/page-agent.ts';
import { installCommitHook } from '../src/inspector/context-hook.ts';
import { launchExtension, openDevtoolsPanel } from './chrome-harness.ts';
import { startFixtureServer } from './fixture-server.ts';

await mkdir('artifacts', { recursive: true });

const fixture = await startFixtureServer();
const h = await launchExtension();

type Row = { id: string; name: string; tags: string[]; evidence: string; current: boolean };

try {
  const page = h.context.pages()[0];
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(fixture.url + '/context');
  await page.locator('#toggle-theme').waitFor();

  const { session, panelSession } = await openDevtoolsPanel(h);

  const run = <T = unknown>(expression: string) => h.evaluate<T>(expression, panelSession);

  const select = (name: string) =>
    run(
      `Array.from(document.querySelectorAll('.tree-select')).find(el=>el.querySelector('.node-name').textContent===${JSON.stringify(name)}).click()`,
    );

  const click = async (label: string) => {
    await h.until(
      () =>
        run(
          `(()=>{const el=[...document.querySelectorAll('.context-readers button')].find(el=>(el.getAttribute('aria-label')||el.textContent.trim())===${JSON.stringify(label)});if(!el||el.disabled)return false;el.click();return true;})()`,
        ),
      `Context control never became available: ${label}`,
    );
  };

  const rows = (list: string) =>
    run<Row[]>(
      `[...document.querySelectorAll('${list} .context-row')].map(el=>({id:el.dataset.contextInstance,name:el.querySelector('.context-row-name').firstChild.textContent,tags:[...el.querySelectorAll('.context-tag')].map(tag=>tag.textContent),evidence:el.querySelector('.context-row-evidence')?.textContent||'',current:el.getAttribute('aria-current')==='true'}))`,
    );

  const readers = () => rows('[aria-labelledby="context-readers-heading"]');
  const bystanders = () => rows('[aria-labelledby="context-bystanders-heading"]');
  const names = (list: Row[]) => list.map((row) => row.name);

  const options = () =>
    run<{ group: string; text: string; selected: boolean }[]>(
      `[...document.querySelectorAll('[aria-label="Context provider"] option')].map(el=>({group:el.parentElement.label,text:el.textContent,selected:el.selected}))`,
    );

  const selected = async () => (await options()).find((option) => option.selected)?.text;

  const choose = async (text: string) => {
    assert(
      await run(
        `(()=>{const el=document.querySelector('[aria-label="Context provider"]');const option=[...el.options].find(option=>option.textContent===${JSON.stringify(text)});if(!option)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,option.value);el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
      ),
      `Missing provider option: ${text}`,
    );
    await h.until(async () => (await selected()) === text, `Provider was not selected: ${text}`);
  };

  const evidence = () =>
    run<{ kind: string; text: string } | null>(
      `(()=>{const el=document.querySelector('.context-evidence');return el&&{kind:el.dataset.evidence,text:el.textContent};})()`,
    );

  const section = () => run<string>(`document.querySelector('.context-readers').textContent`);
  const heading = () => run<string>(`document.querySelector('.inspector-heading h2').textContent`);

  const treeSelection = () =>
    run<string>(`document.querySelector('.tree-row.selected .tree-select')?.dataset.tree`);

  const waitForTree = (name: string) =>
    h.until(
      () =>
        run(
          `Array.from(document.querySelectorAll('.node-name')).some(n=>n.textContent===${JSON.stringify(name)})`,
        ),
      `${name} is missing from the tree`,
    );

  const calls = () => page.evaluate(() => ({ ...window.contextFixtureRenders! }));

  // Dependencies: the provider is preselected for a component that reads it.
  await waitForTree('ThemedHeading');
  await select('ThemedHeading');

  // Nothing is read from the page until the section is opened.
  await h.until(
    () => run(`document.querySelector('.props-inspector .section-body')!==null`),
    'Inspector did not load',
  );
  assert.equal(await run(`document.querySelector('.context-readers').open`), false);
  await page.waitForTimeout(300);
  assert.equal(
    await page.evaluate(() => window.__REACT_ANATOMY_INSPECTOR_V1__!.contextSession),
    undefined,
    'Contexts were scanned before the section was opened',
  );
  await run(`document.querySelector('.context-readers > summary').click()`);
  await h.until(
    async () => (await options())[0]?.group === 'Read by ThemedHeading',
    'The provider this component reads was not offered first',
  );
  await h.until(async () => (await readers()).length === 3, 'ThemeContext readers did not load');

  const theme = 'ThemeContext · in ThemeBoundary · root 1 · 3 readers';

  assert.equal(await selected(), theme);
  assert.deepEqual(
    (await options()).map((option) => `${option.group} | ${option.text}`),
    [
      `Read by ThemedHeading | ${theme}`,
      'Other providers | AccentContext #1 · in EdgeCases · root 1 · 5 readers',
      'Other providers | AccentContext #2 · default value · root 1 · 1 reader',
      'Other providers | ↳ AccentContext #1 · in EdgeCases · root 1 · 1 reader',
      'Other providers | ThemeContext · default value · root 1 · 1 reader',
      'Other providers | ThemeContext · default value · root 2 · 1 reader',
    ],
    'Providers, aliases, lookalikes, nesting or roots were grouped incorrectly',
  );

  let list = await readers();

  assert.deepEqual(names(list), ['ThemedHeading', 'ThemedBadge', 'ThemedToast']);
  assert.deepEqual(
    list.map((row) => row.tags),
    [[], ['memo'], ['portal']],
  );
  assert.deepEqual(
    list.map((row) => row.current),
    [true, false, false],
  );
  assert.deepEqual(names(await bystanders()), ['StaticCaption']);
  assert.equal((await evidence())?.kind, 'dependencies');
  assert(
    list.every((row) => !row.evidence),
    'A dependency was presented as an update',
  );
  assert((await section()).includes('Value{name: "light"') === false);
  assert((await section()).includes('ValueObject'), 'Provider value preview is missing');

  // A reader row selects that exact instance in the tree and the 3D view.
  const toast = list[2];

  await run(`document.querySelector('[data-context-instance="${toast.id}"]').click()`);
  await h.until(async () => (await heading()) === 'ThemedToast', 'Reader was not selected');
  assert.equal(await treeSelection(), toast.id, 'A different instance was selected');
  assert(
    await run(`document.querySelector('.component-kind').textContent.includes('portal')`),
    'The portal reader lost its ownership',
  );
  assert.equal(await selected(), theme, 'Following a reader changed the provider');
  assert.deepEqual(
    (await readers()).map((row) => row.current),
    [false, false, true],
  );
  assert(
    await run(
      `(()=>{const id=${JSON.stringify(toast.id)};return !!document.querySelector('[data-plane="'+id+'"] .component-plane.active, .component-plane.active[data-plane="'+id+'"]');})()`,
    ),
    'The 3D view did not select the reader',
  );

  // Sampled values: two samples show who read a new value, never how often.
  await page.locator('#toggle-theme').click();
  await page.locator('#toggle-theme').click();
  await page.locator('#toggle-theme').click();
  await click('Refresh context readers');
  await h.until(async () => (await evidence())?.kind === 'sampled', 'Samples were not compared');
  assert((await evidence())!.text.includes('the provider holds a different value'));
  list = await readers();
  assert.deepEqual(
    list.map((row) => row.evidence),
    ['read a new value', 'read a new value', 'read a new value'],
  );
  assert(
    (await bystanders()).every((row) => !row.evidence),
    'Samples made a claim about a component that is not a reader',
  );
  assert(!/\d+ renders?/.test(await section()), 'Samples were presented as render counts');
  await click('Set baseline');
  await click('Refresh context readers');
  await h.until(
    async () => (await readers()).every((row) => row.evidence === 'same value'),
    'An unchanged value was reported as new',
  );
  assert((await evidence())!.text.includes('the provider holds the same value'));

  // Measured renders need React's commit reports. This page has no hook, so
  // nothing is counted until the user opts in to a reload.
  assert(!(await section()).includes('Record renders'));
  assert.equal(
    await page.evaluate(() => typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__),
    'undefined',
  );

  const refused = await page.evaluate<{ ok: boolean }>(
    `(${pageAgent.toString()})({action:'context-record',command:'start'})`,
  );

  assert.equal(refused.ok, false, 'Recording started without commit reports');

  const before = await run(`document.querySelector('.footer-count').textContent`);

  await click('Reload page to measure renders');
  await h.until(
    () =>
      run(
        `document.querySelector('.footer-count')?.textContent!==${JSON.stringify(before)}&&document.querySelector('[aria-label="Capture"]')?.disabled===false`,
      ),
    'The panel did not reconnect after the reload',
  );
  await page.locator('#toggle-theme').waitFor();
  assert.deepEqual(
    await page.evaluate(() => [
      typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__,
      Object.hasOwn(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__'),
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__!.renderers.size,
    ]),
    ['object', false, 1],
    'The commit hook must stay out of the way of React DevTools',
  );

  const idle = await page.evaluate(() =>
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__!.onCommitFiberRoot!.toString(),
  );

  await waitForTree('ThemedHeading');
  await select('ThemedHeading');
  assert.equal(
    await run(`document.querySelector('.context-readers').open`),
    true,
    'The section closed while the user was following readers',
  );
  await h.until(async () => (await readers()).length === 3, 'Readers did not reload');
  assert.equal((await evidence())?.kind, 'dependencies', 'A sample survived the reload');

  const start = await calls();

  await click('Record renders');
  await h.until(async () => (await evidence())?.kind === 'measured', 'Recording did not start');
  await page.locator('#toggle-theme').click();
  await page.locator('#toggle-theme').click();
  await page.locator('#rerender-app').click();
  await h.until(
    async () => (await evidence())!.text.includes('Recording 3 commits, 2 with a new provider'),
    'Commits were not counted while recording',
  );

  assert.equal(
    await run(
      `!!document.querySelector('.context-evidence').closest('[role="status"], [role="alert"], [aria-live="polite"], [aria-live="assertive"]')`,
    ),
    false,
    'Polling the commit count should not repeatedly announce the evidence paragraph',
  );
  const end = await calls();
  const ran = (name: string) => end[name] - start[name];

  // The fixture counts its own calls: the measurements must agree with them.
  assert.deepEqual(
    ['ThemedHeading', 'ThemedBadge', 'ThemedToast', 'StaticCaption'].map(ran),
    [3, 2, 3, 1],
  );
  assert.deepEqual(
    (await readers()).map((row) => [row.name, row.evidence]),
    [
      ['ThemedHeading', '3 renders · 2 with a new value'],
      ['ThemedBadge', '2 renders · 2 with a new value'],
      ['ThemedToast', '3 renders · 2 with a new value'],
    ],
  );
  assert.deepEqual(
    (await bystanders()).map((row) => [row.name, row.evidence]),
    [['StaticCaption', '1 render']],
    'A component that is not a reader was given a context render',
  );

  await h.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    session,
  );

  const shot = await h.send('Page.captureScreenshot', { format: 'png' }, session);

  await writeFile('artifacts/context-readers.png', Buffer.from(shot.data, 'base64'));
  await click('Stop recording');
  await h.until(
    async () => (await evidence())!.text.includes('Recorded 3 commits'),
    'Recording did not stop',
  );
  assert.equal(
    await page.evaluate(() => window.__REACT_DEVTOOLS_GLOBAL_HOOK__!.onCommitFiberRoot!.toString()),
    idle,
    'The commit hook was not restored',
  );
  await page.locator('#toggle-theme').click();
  await click('Refresh context readers');
  await page.waitForTimeout(300);
  assert.equal((await readers())[0].evidence, '3 renders · 2 with a new value');
  await click('Clear counts');
  await h.until(async () => (await evidence())?.kind !== 'measured', 'Counts were not cleared');

  // Closing the panel must not leave a recorder in the page.
  await click('Record renders');
  await h.until(async () => (await evidence())?.kind === 'measured', 'Recording did not restart');
  assert.notEqual(
    await page.evaluate(() => window.__REACT_DEVTOOLS_GLOBAL_HOOK__!.onCommitFiberRoot!.toString()),
    idle,
  );
  await page.evaluate(`(${pageAgent.toString()})({action:'dispose'})`);
  assert.equal(
    await page.evaluate(() => window.__REACT_DEVTOOLS_GLOBAL_HOOK__!.onCommitFiberRoot!.toString()),
    idle,
    'Disposing the agent left the commit hook wrapped',
  );
  await click('Refresh context readers');
  await h.until(
    async () => (await section()).includes('This capture has expired'),
    'A disposed capture was read as current',
  );
  await run(`document.querySelector('[aria-label="Capture"]').click()`);
  await h.until(async () => (await readers()).length === 3, 'Readers did not return');
  assert.equal((await evidence())?.kind, 'dependencies', 'Disposal kept counts');

  // Aliases, a class, a Consumer and a compared memo read the outer provider.
  // The lookalike context and the nested provider's reader do not.
  await choose('AccentContext #1 · in EdgeCases · root 1 · 5 readers');
  await h.until(async () => (await readers()).length === 5, 'Accent readers did not load');
  list = await readers();
  assert.deepEqual(names(list), [
    'OuterAccent',
    'AliasAccent',
    'ClassAccent',
    'ConsumerAccent',
    'ComparedAccent',
  ]);
  assert.deepEqual(
    list.map((row) => row.tags),
    [[], [], [], ['Consumer'], ['memo']],
  );
  assert.deepEqual(names(await bystanders()), ['LookalikeReader', 'PlainItem']);
  assert(
    (await section()).includes(
      '1 reader below read a nested AccentContext #1 provider in EdgeCases instead.',
    ),
  );
  await click('Show its readers');
  await h.until(
    async () => names(await readers()).join() === 'InnerAccent',
    'The nested provider did not list its own reader',
  );
  assert.equal(await selected(), '↳ AccentContext #1 · in EdgeCases · root 1 · 1 reader');
  assert((await section()).includes('Shadows an outer AccentContext #1 provider.'));
  await click('Show the outer provider');
  await h.until(async () => (await readers()).length === 5, 'Outer provider was not restored');

  // Readers with no provider read the default value. The same context is read
  // that way in both roots, and each root lists only its own reader.
  await choose('ThemeContext · default value · root 2 · 1 reader');
  await h.until(
    async () => names(await readers()).join() === 'DetachedReader',
    'The second root was attributed to a provider in the first',
  );
  await choose('ThemeContext · default value · root 1 · 1 reader');
  await h.until(
    async () => names(await readers()).join() === 'UnthemedFooter',
    'Default-value readers of two roots were merged',
  );
  assert((await section()).includes('they read the default value'));
  assert.deepEqual(await bystanders(), []);
  await choose('AccentContext #2 · default value · root 1 · 1 reader');
  await h.until(
    async () => names(await readers()).join() === 'LookalikeReader',
    'A context was matched by name',
  );

  // Closing the section stops a recording: nothing counts out of sight.
  await choose(theme);
  await click('Record renders');
  await h.until(async () => (await evidence())?.kind === 'measured', 'Recording did not start');
  await run(`document.querySelector('.context-readers > summary').click()`);
  await h.until(
    () =>
      page.evaluate(() => window.__REACT_ANATOMY_INSPECTOR_V1__!.contextRecorder?.active === false),
    'A closed section kept recording',
  );
  await run(`document.querySelector('.context-readers > summary').click()`);
  await click('Clear counts');
  await h.until(async () => (await evidence())?.kind !== 'measured', 'Counts were not cleared');

  // Long dependency lists. A context read 150 times is still one context. A
  // list too long to finish proves nothing about what it did not reach, so
  // that component is not called a non-reader and counts become lower bounds.
  const stressed = await run(`document.querySelector('.footer-count').textContent`);

  await page.goto(fixture.url + '/context?stress');
  await page.locator('#change-stress').waitFor();
  await h.until(
    () =>
      run(
        `document.querySelector('.footer-count')?.textContent!==${JSON.stringify(stressed)}&&document.querySelector('[aria-label="Capture"]')?.disabled===false`,
      ),
    'The panel did not reconnect to the stress page',
  );
  await waitForTree('ExcessReader');
  await select('ExcessReader');

  const stress = 'AccentContext #1 · in StressCases · root 1 · ≥ 1 reader';

  await h.until(
    async () => (await options()).some((option) => option.text === stress),
    'An unfinished dependency list was presented as a complete count',
  );
  assert(
    (await options()).some(
      (option) => option.text === 'AccentContext #1 · in EdgeCases · root 1 · 5 readers',
    ),
    'A provider that the long list cannot affect lost its exact count',
  );
  await choose(stress);
  await h.until(
    async () => names(await readers()).join() === 'RepeatReader',
    'Repeated reads of one context hid a later context',
  );
  assert.deepEqual(
    names(await bystanders()),
    ['PlainItem'],
    'A component with an unfinished dependency list was called a non-reader',
  );
  assert((await section()).includes('Readers of AccentContext #1 (at least 1)'));
  assert(
    (await section()).includes(
      '1 component below reads more contexts than can be checked. It is left out of both lists.',
    ),
  );
  await click('Reload page to measure renders');
  await h.until(
    () =>
      page
        .evaluate(() => window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers.size === 1)
        // The page is reloading: its previous context may be gone mid-call.
        .catch(() => false),
    'React did not find the commit hook on the stress page',
  );
  await page.locator('#change-stress').waitFor();
  await waitForTree('ExcessReader');
  await h.until(
    async () => (await options()).some((option) => option.text === stress),
    'Providers did not reload',
  );
  await choose(stress);
  await click('Record renders');
  await h.until(async () => (await evidence())?.kind === 'measured', 'Recording did not start');
  await page.locator('#change-stress').click();
  await h.until(
    async () => (await readers())[0]?.evidence === '≥ 1 render · ≥ 1 with a new value',
    'A commit with an unfinished dependency list produced definite counts',
  );
  assert((await evidence())!.text.includes('counts are lower bounds'));
  assert.deepEqual(
    (await bystanders()).map((row) => [row.name, row.evidence]),
    [['PlainItem', '≥ 1 render']],
  );
  await click('Stop recording');

  const agent = pageAgent.toString();
  const direct = await page.evaluate<{
    json: boolean;
    readers: number;
    unknown: { ok: boolean };
    root: { ok: boolean };
  }>(
    `(()=>{${agent};pageAgent({action:'capture'});const overview=pageAgent({action:'contexts'});const theme=overview.providers.find(p=>p.name==='ThemeContext'&&p.kind==='provider');const result=pageAgent({action:'context-readers',key:theme.key});return {json:JSON.stringify(JSON.parse(JSON.stringify(result)))===JSON.stringify(result),readers:result.readers.length,unknown:pageAgent({action:'context-readers',key:'c999999'}),root:pageAgent({action:'context-readers',key:overview.providers.find(p=>p.kind==='default').key.replace(/@\\d+$/,'@9')})};})()`,
  );

  assert(direct.json, 'Context readers must cross the bridge as JSON');
  assert.equal(direct.readers, 3);
  assert.equal(direct.unknown.ok, false);
  assert.equal(direct.root.ok, false, 'A missing root was read as another');
  assert.deepEqual(errors, []);

  // The hook the reload installs leaves room for React DevTools, which
  // looks for an own property of window before installing its own.
  await page.goto(fixture.url + '/plain');
  assert.deepEqual(
    await page.evaluate(
      `(()=>{(${installCommitHook.toString()})();const ours=window.__REACT_DEVTOOLS_GLOBAL_HOOK__;const own=Object.hasOwn(window,'__REACT_DEVTOOLS_GLOBAL_HOOK__');const theirs={};Object.defineProperty(window,'__REACT_DEVTOOLS_GLOBAL_HOOK__',{get:()=>theirs});(${installCommitHook.toString()})();return [typeof ours.inject,own,window.__REACT_DEVTOOLS_GLOBAL_HOOK__===theirs];})()`,
    ),
    ['function', false, true],
  );
  console.log(
    'Passed: opt-in scan, provider selection, three readers and one non-reader, memo, portal, alias, class, Consumer, same-name contexts, nested providers, separate roots and their defaults, navigation to the exact instance, sampled values, opt-in reload, measured renders against the fixture’s own counts, hook restoration, disposal, repeated reads, unfinished dependency lists as lower bounds, and JSON-safe transport.',
  );
} finally {
  await h.close();
  await fixture.close();
}

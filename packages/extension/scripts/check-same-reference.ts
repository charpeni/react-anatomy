import type { ReferenceSearch } from '../src/inspector/reference-types.ts';
import type { Result } from '../src/inspector/types.ts';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pageAgent } from '../src/inspector/page-agent.ts';
import {
  groupReferenceMatches,
  referenceNotes,
  referencePropLabel,
  referenceSummary,
} from '../src/inspector/reference-search.ts';
import { focusDevtoolsPanel, launchExtension, openDevtoolsPanel } from './chrome-harness.ts';
import { startFixtureServer } from './fixture-server.ts';

type Section = {
  busy: boolean;
  error: string | null;
  summary: string | null;
  source: string;
  hint: string;
  notes: string[];
  rows: {
    title: string;
    instances: { id: string; text: string; relation: string; current: boolean }[];
  }[];
};

// Grouping and coverage wording are pure, so check them without a browser.
const match = (id: string, name: string, relation: string, props = ['onSave']) => ({
  id,
  name,
  key: null,
  props,
  moreProps: 0,
  path: [],
  pathTruncated: false,
  relation: relation as 'other',
  outside: false,
});
const grouped = groupReferenceMatches([
  match('c1', 'Box', 'ancestor'),
  match('c2', 'Wrapper', 'gap', []),
  match('c3', 'Box', 'ancestor'),
  match('c4', 'Row', 'source'),
  match('c5', 'Cell', 'descendant'),
  match('c6', 'Row', 'other'),
  match('c7', 'Row', 'other', ['onPick']),
]);

assert.deepEqual(
  grouped.map((group) => [group.name, group.instances.map((item) => item.id).join()]),
  [
    ['Box', 'c1'],
    ['Wrapper', 'c2'],
    ['Box', 'c3'],
    ['Row', 'c4,c6'],
    ['Cell', 'c5'],
    ['Row', 'c7'],
  ],
  'Repeated instances must group without reordering the ancestor path',
);
assert.equal(
  referencePropLabel(['onSave', 'data-id', 'Symbol(x)'], 2),
  '.onSave, [data-id], [Symbol(x)] +2',
);
assert.deepEqual(
  referenceNotes({
    coverage: {
      components: 5000,
      accessors: 1,
      unreadable: 2,
      keyLimited: 0,
      limit: 'components',
      ancestors: false,
      roots: 1,
    },
  } as ReferenceSearch).map((note) => note.split(/[:.]/)[0]),
  [
    'Partial',
    'Partial',
    '1 accessor prop skipped to avoid calling a getter',
    'Props of 2 components could not be read',
  ],
);

// The summary states what was compared. Only a complete search may say that
// nothing else holds the reference.
const completeCoverage = {
  components: 24,
  accessors: 0,
  unreadable: 0,
  keyLimited: 0,
  limit: null,
  ancestors: true,
  roots: 1,
};
const summary = (coverage: object, matches = [match('c1', 'Row', 'source')]) =>
  referenceSummary({
    epoch: 'e1',
    observedAt: 0,
    source: { id: 'c1', name: 'Row', key: null, prop: 'onSave', type: 'function', preview: 'ƒ' },
    scope: null,
    matches,
    coverage: { ...completeCoverage, ...coverage } as ReferenceSearch['coverage'],
  });

assert.equal(
  summary({}),
  'No other component holds this reference as a top-level prop, among the 24 compared in the React root discovered on this page.',
);
assert.equal(
  summary({}, [
    match('c1', 'Row', 'source'),
    match('c2', 'Wrapper', 'gap', []),
    match('c3', 'Row', 'other'),
  ]),
  '2 component instances received this same reference.',
);

for (const incomplete of [
  { limit: 'components' },
  { limit: 'matches' },
  { limit: 'fibers' },
  { limit: 'time' },
  { ancestors: false },
  { accessors: 1 },
  { unreadable: 1 },
  { keyLimited: 1 },
]) {
  assert.equal(
    summary(incomplete),
    'No other match was found. The search was incomplete, so others may exist.',
    `An incomplete search claimed a complete answer: ${JSON.stringify(incomplete)}`,
  );
  assert.equal(
    summary(incomplete, [match('c1', 'Row', 'source'), match('c3', 'Row', 'other')]),
    '2 component instances received this same reference. The search was incomplete, so others may exist.',
  );
  assert.equal(
    referenceNotes({ coverage: { ...completeCoverage, ...incomplete } } as ReferenceSearch).length,
    1,
  );
}

await mkdir('artifacts', { recursive: true });

const fixture = await startFixtureServer();
const h = await launchExtension();

try {
  const page = h.context.pages()[0];
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(fixture.url + '/demo');
  await page.locator('.project-card').first().waitFor();

  const { session, panelSession } = await openDevtoolsPanel(h);

  const run = <T = unknown>(expression: string) => h.evaluate<T>(expression, panelSession);
  // Undocking can resize DevTools across the breakpoint that hides the inspector.
  await h.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    session,
  );
  await h.until(() => run('innerWidth > 900'), 'DevTools did not reach the desktop layout');

  const settled = () =>
    h.until(
      () =>
        run(
          `!!document.querySelector('.tree-select')&&!document.querySelector('[aria-label="Capture"]').disabled`,
        ),
      'Capture did not finish',
    );

  const select = async (name: string, key?: string) => {
    await h.until(
      () =>
        run(
          `(()=>{const row=Array.from(document.querySelectorAll('.tree-select')).find(el=>el.querySelector('.node-name').textContent===${JSON.stringify(name)}&&(${JSON.stringify(key ?? null)}===null||el.querySelector('.tree-key')?.textContent===${JSON.stringify(`key="${key}"`)}));if(!row)return false;row.click();return true;})()`,
        ),
      `Missing component ${name} ${key ?? ''}`,
    );
  };

  const click = (label: string) =>
    h.until(
      () =>
        run(
          `(()=>{const el=Array.from(document.querySelectorAll('button')).find(el=>(el.getAttribute('aria-label')||el.textContent.trim())===${JSON.stringify(label)});if(!el||el.disabled)return false;el.click();return true;})()`,
        ),
      `Missing control: ${label}`,
    );

  const section = () =>
    run<Section | null>(
      `(()=>{const s=document.querySelector('.same-reference');if(!s)return null;const item=b=>({id:b.dataset.referenceId,text:b.textContent,relation:b.dataset.referenceRelation,current:b.getAttribute('aria-current')==='true'});return {busy:!!s.querySelector('[aria-busy="true"]'),error:s.querySelector('.props-error')?.textContent||null,summary:s.querySelector('.reference-summary')?.textContent||null,source:s.querySelector('.reference-source').textContent,hint:s.querySelector('.props-hint')?.textContent||'',notes:Array.from(s.querySelectorAll('.reference-note'),n=>n.textContent),rows:Array.from(s.querySelectorAll('.reference-list > li'),li=>li.classList.contains('reference-group')?{title:li.querySelector('.reference-group-title').textContent,instances:Array.from(li.querySelectorAll('.reference-instance'),item)}:{title:'',instances:[item(li.querySelector('.reference-instance'))]})};})()`,
    );

  const results = (message: string, ready: (state: Section) => unknown = () => true) =>
    h.until(async () => {
      const state = await section();

      return state && !state.busy && (state.error || state.summary) && ready(state) ? state : null;
    }, message);

  const find = async (prop: string) => {
    await click(`Find same reference as ${prop}`);

    return results(`Search for ${prop} did not finish`, (state) => state.source.includes(prop));
  };

  const pick = (state: Section, text: string) => {
    const found = state.rows
      .flatMap((row) => row.instances)
      .find((item) => item.text.includes(text));

    assert(found, `Missing match: ${text}`);

    return found;
  };

  const choose = (id: string) =>
    run(`document.querySelector('[data-reference-id="${id}"]').click()`);

  const heading = () => run<string>(`document.querySelector('.inspector-heading h2').textContent`);

  const selectedRow = () =>
    run<string>(`document.querySelector('.tree-row.selected .tree-select').textContent`);

  // 1. The demo's completion callback: two intermediaries and three cards.
  await settled();
  await select('ProjectCard', 'customer-portal');
  await h.until(
    () => run(`!!document.querySelector('[aria-label="Find same reference as onCompleteTask"]')`),
    'The prop action is missing',
  );
  assert.deepEqual(
    await run(
      `Array.from(document.querySelectorAll('.reference-action'),el=>el.getAttribute('aria-label'))`,
    ),
    ['Find same reference as project', 'Find same reference as onCompleteTask'],
  );

  await click('Include in image');
  const hiddenCallback = '[aria-label="Hide onCompleteTask in props card"]';
  await h.until(
    () => run(`!!document.querySelector('${hiddenCallback}')`),
    'Missing export control',
  );
  assert.equal(
    await run(`(() => {
      const hide = document.querySelector('${hiddenCallback}');
      const search = document.querySelector('[aria-label="Find same reference as onCompleteTask"]');
      return search.parentElement === hide.parentElement &&
        search.getBoundingClientRect().right <= hide.getBoundingClientRect().left;
    })()`),
    true,
    'Each action needs its own clickable area on the prop row',
  );
  await click('Hide onCompleteTask in props card');
  const captureCount = await run(`document.querySelector('.footer-count').textContent`);
  const pageBefore = await page.locator('body').innerHTML();
  // Use a pointer click so a hidden or covered action cannot start the search.
  await focusDevtoolsPanel(h, session, panelSession);
  const point = await run<{ x: number; y: number }>(`(() => {
    const action = document.querySelector('[aria-label="Find same reference as onCompleteTask"]');
    action.scrollIntoView({ block: 'center' });
    const rect = action.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  for (const type of ['mousePressed', 'mouseReleased'] as const) {
    await h.send(
      'Input.dispatchMouseEvent',
      { type, ...point, button: 'left', clickCount: 1 },
      panelSession,
    );
  }
  const callback = await results('The callback search did not finish', (state) =>
    state.source.includes('onCompleteTask'),
  );
  assert.equal(
    await run(`document.querySelector('${hiddenCallback}').getAttribute('aria-pressed')`),
    'true',
  );

  assert.equal(callback.error, null);
  assert.equal(callback.summary, '5 component instances received this same reference.');
  assert.match(callback.source, /ProjectCard.*customer-portal.*onCompleteTask.*ƒ completeTask\(\)/);
  assert.deepEqual(
    callback.rows.map((row) => row.title || row.instances[0].text.replace(/c\d+$/, '')),
    [
      'MainContent.onCompleteTaskancestor',
      'ProjectList.onCompleteTaskancestor',
      'ProjectCard.onCompleteTask× 3',
    ],
  );
  assert.deepEqual(
    callback.rows[2].instances.map((item) => [
      item.text.replace(/c\d+$/, ''),
      item.relation,
      item.current,
    ]),
    [
      ['key="design-system"', 'other', false],
      ['key="customer-portal"searched from', 'source', true],
      ['key="mobile-app"', 'other', false],
    ],
  );
  assert.match(
    callback.hint,
    /Observed .* components in the React root discovered on this page\. A match is the same object/,
  );
  await h.until(
    () => run(`document.activeElement.closest('.same-reference') !== null`),
    'Starting a search did not focus its results',
  );
  await click('Include in image');
  assert.equal(await page.locator('body').innerHTML(), pageBefore, 'Searching changed the page');
  assert.equal(
    await run(`document.querySelector('.footer-count').textContent`),
    captureCount,
    'Searching recaptured the page',
  );

  // Selecting a match uses the existing tree and scene, and keeps the list.
  const mobile = pick(callback, 'mobile-app');

  await choose(mobile.id);
  await h.until(async () => (await selectedRow()).includes('mobile-app'), 'Match was not selected');
  assert.equal(await heading(), 'ProjectCard');
  assert.equal(pick((await section())!, 'mobile-app').current, true);
  assert.equal(pick((await section())!, 'customer-portal').current, false);
  await click('Explode view');
  await h.until(
    () =>
      run(
        `document.querySelector('.component-plane.active')?.dataset.plane===${JSON.stringify(mobile.id)}`,
      ),
    'The selected match is not the highlighted plane',
  );
  await page.waitForTimeout(350);
  await writeFile(
    'artifacts/same-reference.png',
    Buffer.from(
      (await h.send('Page.captureScreenshot', { format: 'png' }, session)).data,
      'base64',
    ),
  );
  await choose(pick(callback, 'MainContent').id);
  await h.until(async () => (await heading()) === 'MainContent', 'Ancestor was not selected');
  assert.equal((await section())!.rows.length, 3, 'Selecting a match discarded the list');

  // The array is mapped to items, so its identity is not shared with the cards.
  await select('ProjectCard', 'customer-portal');

  const project = await find('project');

  assert.equal(
    project.summary,
    'No other component holds this reference as a top-level prop, among the 24 compared in the React root discovered on this page.',
  );
  assert.equal(project.rows.length, 1);

  // 2. A focused subtree still reports the ancestors above it, and can widen.
  await find('onCompleteTask');
  await click('Focus subtree');

  const focused = await results('Focused search did not finish', (state) =>
    state.hint.includes('ProjectCard and the ancestors'),
  );

  assert.deepEqual(
    focused.rows.map((row) => row.instances[0].text.replace(/c\d+$/, '')),
    [
      'MainContent.onCompleteTaskancestor · above focusFocus to load',
      'ProjectList.onCompleteTaskancestor · above focusFocus to load',
      'ProjectCard.onCompleteTaskkey="customer-portal"searched from',
    ],
  );
  await click('Search the whole page');

  const widened = await results('Whole page search did not finish', (state) =>
    state.hint.includes('discovered on this page'),
  );

  assert.equal(widened.summary, '5 component instances received this same reference.');
  assert.match(pick(widened, 'design-system').text, /Focus to load/);
  await choose(pick(widened, 'ProjectList').id);
  await h.until(
    () =>
      run(
        `document.querySelector('.stage-title, .focus-navigation')&&Array.from(document.querySelectorAll('.focus-navigation button')).at(-1)?.textContent==='ProjectList'&&!document.querySelector('[aria-label="Capture"]').disabled`,
      ),
    'An uncaptured match did not focus its component',
  );

  const loaded = await results('Search did not follow the new capture', (state) =>
    state.rows.some((row) => row.instances.length === 3),
  );

  assert(!pick(loaded, 'design-system').text.includes('Focus to load'));
  assert.equal(await heading(), 'ProjectList');

  // 3. A capture pairs the list with the reference the page holds now.
  await click('Whole page');
  await h.until(
    () =>
      run(
        `!document.querySelector('.focus-navigation')&&!document.querySelector('[aria-label="Capture"]').disabled`,
      ),
    'Whole page capture did not finish',
  );
  await results('Search did not follow the whole page capture', (state) =>
    state.hint.includes('discovered on this page'),
  );

  const agent = pageAgent.toString();
  const call = <T>(request: object) =>
    page.evaluate<T>(`(()=>{${agent};return pageAgent(${JSON.stringify(request)});})()`);
  const belowSource = await call<Result<ReferenceSearch>>({
    action: 'same-reference',
    id: pick(callback, 'MainContent').id,
    name: 'onCompleteTask',
    scopeId: mobile.id,
  });
  assert(belowSource.ok);
  const focusedCard = belowSource.matches.find((match) => match.id === mobile.id);
  assert.equal(focusedCard?.relation, 'descendant');
  assert.equal(focusedCard.outside, false);

  const before = await call<Result<ReferenceSearch>>({
    action: 'same-reference',
    id: loaded.rows[2].instances[1].id,
    name: 'onCompleteTask',
  });

  assert(before.ok);
  await page.locator('.project-card .complete-task').first().click();
  await click('Capture');
  await page.waitForTimeout(300);
  await settled();

  const replaced = await results('Search did not follow the capture');

  assert.equal(replaced.summary, '5 component instances received this same reference.');
  assert.deepEqual(errors, []);

  // 4. Controls: renamed props, gaps, portals, components without output,
  // a second root, accessors, hostile props and equal primitives.
  await page.goto(fixture.url + '/references');
  await page.getByText('Memo leaf').waitFor();

  const reloaded = await results('A search survived navigation', (state) => !!state.error);

  assert.match(reloaded.error!, /page was reloaded/);
  assert.equal(reloaded.rows.length, 0, 'IDs from the previous document were offered');
  // The reconnecting capture can run before the second root commits.
  await h.until(async () => {
    if (
      await run(
        `Array.from(document.querySelectorAll('.node-name')).some(n=>n.textContent==='OtherRoot')`,
      )
    ) {
      return true;
    }

    await click('Capture');
    await settled();

    return false;
  }, 'The second root was not captured');
  await select('Form');
  await h.until(
    () => run(`!!document.querySelector('[aria-label="Find same reference as handler"]')`),
    'The prop action is missing',
  );
  assert.deepEqual(
    await run(
      `Array.from(document.querySelectorAll('.reference-action'),el=>el.getAttribute('aria-label'))`,
    ),
    ['Find same reference as handler', 'Find same reference as theme'],
    'A primitive prop offered an identity search',
  );

  const handler = await find('handler');
  const flat = handler.rows.map((row) => row.title || row.instances[0].text.replace(/c\d+$/, ''));

  assert.deepEqual(flat, [
    'Toolbar.onSave',
    'Panel.onSubmitancestor',
    'Relayno matching prop',
    'Form.handlersearched from',
    'SubmitButton.onPressdescendant',
    'NoOutput.onSavedescendant',
    'Dialog.handlerdescendant',
    'PortalAction.actiondescendant',
    'Row.onSelect× 3',
    'MemoLeaf.onSave',
  ]);
  assert.deepEqual(
    handler.rows[8].instances.map((item) => item.text.replace(/c\d+$/, '')),
    ['key="alpha"', 'key="beta"', 'key="gamma"'],
    'A different function with the same source matched',
  );
  assert.equal(
    handler.summary,
    '11 component instances received this same reference. The search was incomplete, so others may exist.',
  );
  assert.deepEqual(handler.notes, [
    '1 accessor prop skipped to avoid calling a getter.',
    'Props of 1 component could not be read.',
  ]);
  await choose(pick(handler, 'NoOutput').id);
  await h.until(
    async () => (await heading()) === 'NoOutput',
    'A match without output was not selected',
  );
  await choose(pick(handler, 'PortalAction').id);
  await h.until(
    async () => (await heading()) === 'PortalAction',
    'A portal match was not selected',
  );
  await select('Row', 'delta');

  const alone = await find('onSelect');

  assert.equal(alone.rows.length, 1);
  assert.equal(
    alone.summary,
    'No other match was found. The search was incomplete, so others may exist.',
    'A search that skipped props claimed that nothing else holds the reference',
  );
  assert.equal(alone.notes.length, 2);
  await select('Form');

  const theme = await find('theme');

  assert.deepEqual(
    theme.rows.map((row) => row.instances[0].text.replace(/c\d+$/, '')),
    [
      'Panel.themeancestor',
      'Relayno matching prop',
      'Form.themesearched from',
      'Guarded.theme',
      'OtherRoot.theme',
    ],
  );
  assert.match(theme.hint, /the 2 React roots discovered on this page/);

  // The page-side contract: bounded, JSON-safe metadata and explicit refusals.
  const form = pick(theme, 'Form').id;
  const request = { action: 'same-reference', id: form, name: 'handler' };
  const complete = await call<Result<ReferenceSearch>>(request);

  assert(complete.ok);
  assert.deepEqual(JSON.parse(JSON.stringify(complete)), complete);
  assert.deepEqual(Object.keys(complete.matches[0]).sort(), [
    'id',
    'key',
    'moreProps',
    'name',
    'outside',
    'path',
    'pathTruncated',
    'props',
    'relation',
  ]);
  assert.deepEqual(pickPath(complete, 'PortalAction'), [
    'ReferenceApp',
    'Panel',
    'Relay',
    'Form',
    'Dialog',
  ]);
  assert.equal(complete.coverage.limit, null);

  const limited = await call<Result<ReferenceSearch>>({ ...request, maxComponents: 3 });

  assert(limited.ok);
  assert.equal(limited.coverage.limit, 'components');
  assert.equal(limited.coverage.components, 4, 'The limit must stop the search');
  assert.equal(limited.matches.at(-1)!.relation, 'source', 'A partial search lost its source');

  const scoped = await call<Result<ReferenceSearch>>({ ...request, scopeId: form });

  assert(scoped.ok);
  assert.deepEqual(
    scoped.matches.map((item) => [item.name, item.relation, item.outside]),
    [
      ['Panel', 'ancestor', true],
      ['Relay', 'gap', true],
      ['Form', 'source', false],
      ['SubmitButton', 'descendant', false],
      ['NoOutput', 'descendant', false],
      ['Dialog', 'descendant', false],
      ['PortalAction', 'descendant', false],
    ],
  );

  for (const [refused, message] of [
    [{ ...request, name: 'label' }, /Only objects, arrays, and functions/],
    [{ ...request, name: 'missing' }, /no longer receives missing/],
    [{ ...request, id: 'c999999' }, /no longer mounted/],
    [{ ...request, scopeId: 'c999999' }, /focused component is no longer mounted/],
    [{ ...request, epoch: 'another-document' }, /page was reloaded/],
  ] as const) {
    const result = await call<Result<ReferenceSearch>>(refused);

    assert(!result.ok && message.test(result.message), `Not refused: ${JSON.stringify(refused)}`);
  }

  const guarded = pick(theme, 'Guarded').id;
  const accessor = await call<Result<ReferenceSearch>>({ ...request, id: guarded, name: 'secret' });

  assert(!accessor.ok && /Accessor props are not evaluated/.test(accessor.message));

  // 5. A replaced reference and an unmounted instance are reported, not reused.
  await find('handler');
  await page.evaluate(() => window.replaceReference!());
  await page.waitForTimeout(100);

  const fresh = await call<Result<ReferenceSearch>>({ ...request, epoch: complete.epoch });

  assert(fresh.ok && fresh.matches.length === complete.matches.length);
  await page.evaluate(() => window.unmountReferenceForm!());
  await page.waitForTimeout(100);
  await click('Search again');

  const unmounted = await results(
    'Unmounted instance was read as current',
    (state) => !!state.error,
  );

  assert.match(unmounted.error!, /no longer mounted/);
  assert.equal(unmounted.rows.length, 0);
  await click('Close same reference');
  await h.until(async () => (await section()) === null, 'The search did not close');
  assert.equal(await page.evaluate(() => window.referenceGetterCalls || 0), 0, 'A getter ran');
  assert.equal(await page.evaluate(() => window.referenceCallbackCalls || 0), 0, 'A callback ran');
  assert.deepEqual(errors, []);
  console.log(
    'Passed: same reference across renamed props, ancestors, gaps, repeated instances, portals, outputless components and roots; selection in the tree and scene; focus scope and widening; capture refresh; navigation, unmount, limits, accessors, hostile props, primitives, and JSON-safe transport.',
  );
} finally {
  await h.close();
  await fixture.close();
}

function pickPath(search: ReferenceSearch, name: string) {
  return search.matches.find((item) => item.name === name)!.path;
}

import type { DemoTimeline, Point, Box } from '../intro/types.ts';
import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchExtension, openDevtoolsPanel } from '../chrome-harness.ts';
import { startFixtureServer } from '../fixture-server.ts';
import type { CDPSession, Page } from 'playwright';

process.env.FONTCONFIG_FILE = resolve('scripts/demo/fonts.conf');

const output = 'artifacts/demo';

await mkdir(output + '/frames', { recursive: true });

const resumeLive = process.argv.includes('--resume-live');
const resume = resumeLive || process.argv.includes('--resume-elements');
const previous: DemoTimeline | null = resume
  ? JSON.parse(await readFile(output + '/timeline.json', 'utf8'))
  : null;

if (resumeLive && previous) {
  const cut = previous.captions.find(
    (c: { title: string }) => c.title === 'Newly mounted components appear in the hierarchy.',
  )!.start;
  let elapsed = 0;

  previous.frames = previous.frames.flatMap((frame) => {
    const start = elapsed;

    elapsed += frame.duration;

    return start >= cut ? [] : [{ ...frame, duration: Math.min(frame.duration, cut - start) }];
  });
  previous.captions = previous.captions.filter((c: { start: number }) => c.start < cut);
  previous.captions.at(-1)!.end = null;
  previous.chapters = previous.chapters.filter((c: { start: number }) => c.start < cut);
  previous.cursors = previous.cursors
    .filter((c: { start: number }) => c.start < cut)
    .map((c) => ({ ...c, end: Math.min(c.end, cut) }));
  previous.clicks = previous.clicks.filter((c: { time: number }) => c.time < cut);
  previous.duration = cut;
}

const port = resume
  ? Number(process.env.DEMO_PORT || (previous?.url ? new URL(previous.url).port : 0))
  : 0;
const fixture = await startFixtureServer(port);
const h = await launchExtension();
const frames: DemoTimeline['frames'] = previous?.frames || [];
const captions: DemoTimeline['captions'] = previous?.captions || [];
const chapters: DemoTimeline['chapters'] = previous?.chapters || [];
const cursors: DemoTimeline['cursors'] = previous?.cursors || [];
const clicks: DemoTimeline['clicks'] = previous?.clicks || [];
let time = previous?.duration || 0;
let lastFrame = frames.at(-1)?.file || null;
let pointer: Point | null = null;
let view = 'panel';
let session: string | undefined;
let panelSession: string | undefined;
let sourceSession: CDPSession;
let source: Page;
let panelTop = 27;

const pause = (ms: number | undefined) => new Promise((r) => setTimeout(r, ms));

const run = <T = unknown>(expression: string) => h.evaluate<T>(expression, panelSession!);

const ui = <T = unknown>(expression: string) => h.evaluate<T>(expression, session!);

const save = () =>
  writeFile(
    output + '/timeline.json',
    JSON.stringify(
      {
        url: fixture.url + '/demo',
        width: 2560,
        height: 1440,
        contentHeight: 1300,
        fps: 30,
        duration: time,
        frames,
        captions,
        chapters,
        cursors,
        clicks,
      },
      null,
      2,
    ),
  );

function chapter(name: string, title: string, detail: string) {
  if (captions.length) {
    captions.at(-1)!.end = time;
  }

  captions.push({ start: time, end: null, title, detail, chapter: name });
  chapters.push({ start: time, name });
  console.log(`${time.toFixed(1)}s · ${name} · ${title}`);
}

function caption(title: string, detail: string) {
  if (captions.length) {
    captions.at(-1)!.end = time;
  }

  captions.push({ start: time, end: null, title, detail, chapter: chapters.at(-1)!.name });
}

function pointerHold(duration: number) {
  if (pointer) {
    cursors.push({ start: time, end: time + duration, from: pointer!, to: pointer });
  }
}

function hold(duration: number) {
  assert(lastFrame);
  frames.push({ file: lastFrame!, duration });
  pointerHold(duration);
  time += duration;
}

async function settle() {
  await pause(40);
  await run('document.body.offsetHeight');
}

async function shot(duration = 1 / 30) {
  const result =
    view === 'source'
      ? await sourceSession.send('Page.captureScreenshot', { format: 'png' })
      : await h.send('Page.captureScreenshot', { format: 'png' }, session);
  const file = `frames/${String(frames.length).padStart(5, '0')}.png`;

  await writeFile(output + '/' + file, Buffer.from(result.data, 'base64'));
  lastFrame = file;
  frames.push({ file, duration });
  pointerHold(duration);
  time += duration;
}

function show(next: string) {
  view = next;
  pointer = null;
}

async function input<M extends 'Input.dispatchMouseEvent' | 'Input.dispatchKeyEvent'>(
  method: M,
  params: ProtocolMapping.Commands[M]['paramsType'][0],
  target = view,
) {
  if (target === 'source') {
    if (method === 'Input.dispatchMouseEvent') {
      return sourceSession.send(
        'Input.dispatchMouseEvent',
        params as ProtocolMapping.Commands['Input.dispatchMouseEvent']['paramsType'][0],
      );
    }
    return sourceSession.send(
      'Input.dispatchKeyEvent',
      params as ProtocolMapping.Commands['Input.dispatchKeyEvent']['paramsType'][0],
    );
  }

  return h.send(method, params, target === 'native' ? session : panelSession);
}

function screenPoint(point: Point, target = view) {
  return { x: point.x, y: point.y + (target === 'panel' ? panelTop : 0) };
}

async function box(selector: string, target = view): Promise<Box> {
  const expression = `(()=>{const el=${selector};if(!el)throw new Error('Demo target missing');el.scrollIntoView({block:'nearest',inline:'nearest'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,left:r.left,top:r.top};})()`;

  return target === 'source'
    ? source.evaluate<Box>(expression)
    : target === 'native'
      ? ui<Box>(expression)
      : run<Box>(expression);
}

async function moveTo(point: Point, duration = 0.45, target = view) {
  const end = screenPoint(point, target);
  const start = pointer || { x: Math.min(1200, end.x + 60), y: Math.min(600, end.y + 65) };

  frames.push({ file: lastFrame!, duration });
  cursors.push({ start: time, end: time + duration, from: start, to: end });
  time += duration;
  pointer = end;
  await input('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }, target);
}

async function click(selector: string, { target = view, after = 0.35, wait = 140 } = {}) {
  const p = await box(selector, target);

  await moveTo(p, 0.4, target);
  await input(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 },
    target,
  );
  await input(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 },
    target,
  );
  clicks.push({ time, x: pointer!.x, y: pointer!.y });
  await pause(wait);
  await settle();
  await shot(after);
}

const button = (name: string) =>
  `Array.from(document.querySelectorAll('button,label')).find(b=>(b.getAttribute('aria-label')||b.textContent.trim())===${JSON.stringify(name)})`;

const prop = (path: string) =>
  `document.querySelector('[data-prop-path=${JSON.stringify(path)}] > summary')`;

async function select(id: unknown) {
  await click(`document.querySelector('[data-tree="${id}"]')`);
  await h.until(
    () =>
      run(
        `document.querySelector('.tree-row.selected .tree-select').dataset.tree===${JSON.stringify(id)}`,
      ),
    'Selection failed',
  );
}

async function expand(path: string) {
  await h.until(() => run(`${prop(path)}!==null`), 'Missing prop ' + path);
  await click(prop(path));
  await h.until(
    () => run(`document.querySelector('.props-inspector [aria-busy="true"]')===null`),
    'Prop load stalled',
  );
  await shot(0.25);
}

async function slider(label: string, to: number, steps = 42) {
  const selector = `document.querySelector('[aria-label=${JSON.stringify(label)}]')`;
  const data = await run<{
    min: number;
    max: number;
    value: number;
    x: number;
    y: number;
    width: number;
    height: number;
    left: number;
    top: number;
  }>(
    `(()=>{const e=${selector};const r=e.getBoundingClientRect();return{x:r.x,y:r.y+r.height/2,width:r.width,value:+e.value,min:+e.min,max:+e.max};})()`,
  );

  const x = (value: number) =>
    data.x + 7 + ((data.width - 14) * (value - data.min)) / (data.max - data.min);

  const start = { x: x(data.value), y: data.y };

  await moveTo(start);
  await input('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...start,
    button: 'left',
    clickCount: 1,
  });

  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    const eased = progress * progress * (3 - 2 * progress);
    const p = { x: x(data.value + (to - data.value) * eased), y: data.y };

    await input('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...p,
      buttons: 1,
      button: 'left',
    });
    pointer = screenPoint(p);
    await settle();
    await shot();
  }

  await input('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: x(to),
    y: data.y,
    button: 'left',
    clickCount: 1,
  });

  const actual = await run<number>(`${selector}.value`);

  assert(Math.abs(+actual - to) <= 2, `${label} ended at ${actual}, expected ${to}`);
  await shot(0.5);
}

async function drag(selector: string, dx: number, dy: number, steps = 30) {
  const p = await box(selector);

  await moveTo(p);
  await input('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: p.x,
    y: p.y,
    button: 'left',
    clickCount: 1,
  });

  for (let i = 1; i <= steps; i++) {
    const a = i / steps;
    const e = a * a * (3 - 2 * a);
    const next = { x: p.x + dx * e, y: p.y + dy * e };

    await input('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...next,
      buttons: 1,
      button: 'left',
    });
    pointer = screenPoint(next);
    await settle();
    await shot();
  }

  await input('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: p.x + dx,
    y: p.y + dy,
    button: 'left',
    clickCount: 1,
  });
  await shot(0.4);
}

async function key(key: string, code: string) {
  await input('Input.dispatchKeyEvent', { type: 'keyDown', key, code });
  await input('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
  await pause(150);
  await settle();
  await shot(0.4);
}

try {
  source = h.context.pages()[0];

  const sourceErrors: string[] = [];

  source.on('pageerror', (e) => sourceErrors.push(e.message));
  await source.setViewportSize({ width: 1280, height: 650 });
  await source.goto(fixture.url + '/demo');
  await source.getByRole('button', { name: 'New project' }).waitFor();
  sourceSession = await h.context.newCDPSession(source);
  await sourceSession.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 650,
    deviceScaleFactor: 2,
    mobile: false,
  });
  ({ session, panelSession } = await openDevtoolsPanel(h));
  await h.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1280, height: 650, deviceScaleFactor: 2, mobile: false },
    session,
  );
  await h.until(
    () => run(`document.querySelectorAll('.tree-select').length===24`),
    'Initial capture failed',
  );
  panelTop = await h.until(async () => {
    const top = 650 - (await run<number>('innerHeight'));

    return top > 10 && top < 50 ? top : false;
  }, 'DevTools viewport did not settle');
  await run(
    `document.head.appendChild(Object.assign(document.createElement('style'),{textContent:'.scene,.component-plane{transition:none!important}'}))`,
  );

  const nodes = await run<{ id: string; name: string; key: string | null; children: string[] }[]>(
    `Array.from(document.querySelectorAll('.tree-select')).map(el=>({id:el.dataset.tree,name:el.querySelector('.node-name').textContent,key:el.querySelector('.tree-key')?.textContent}))`,
  );

  const id = (name: string, key?: string) =>
    nodes.find((n) => n.name === name && (!key || n.key?.includes(key)))!.id;

  if (!resume) {
    // Opening shot is a real captured hierarchy; the following chapter starts from the page.
    await run(`${button('Explode view')}.click()`);
    await pause(250);
    await settle();
    chapter(
      'REACT ANATOMY',
      'Understand React in three dimensions.',
      'A component tree, a rendered 3D view, and props — together in Chrome DevTools.',
    );
    await shot(3.8);
    await run(`${button('Reset view')}.click()`);
    await pause(100);
    show('source');
    chapter(
      '01 / CONNECT',
      'Start with a running React app.',
      'React Anatomy attaches to mounted components. No package, code changes, or page reload.',
    );
    await shot(4);
    show('native');
    await ui(
      `(async()=>{const UI=await import('devtools://devtools/bundled/ui/legacy/legacy.js');await UI.ViewManager.ViewManager.instance().showView('elements');})()`,
    );
    await pause(250);
    await shot(0.7);

    const strataTab = `(()=>{const walk=root=>{for(const el of root.querySelectorAll('*')){if(el.getAttribute('role')==='tab'&&((el.getAttribute('aria-label')||'').startsWith('Anatomy')||el.textContent.trim()==='Anatomy'))return el;if(el.shadowRoot){const match=walk(el.shadowRoot);if(match)return match;}}};return walk(document);})()`;

    await click(strataTab, { target: 'native', after: 1.8, wait: 250 });
    show('panel');
    await h.until(() => run(`document.visibilityState==='visible'`), 'React Anatomy did not open');
    caption(
      'Open the Anatomy tab.',
      'The first capture maps your components to their rendered output.',
    );
    await shot(2.8);
    await save();

    chapter(
      '02 / EXPLORE',
      'Pull the page apart by component.',
      'Layer separation reveals how the React hierarchy composes the page.',
    );
    await click(button('3D'));
    await slider('Layer separation', 70, 48);
    pointer = null;
    hold(2.5);
    caption(
      'Rotate the hierarchy to see the relationships.',
      'The rendered content stays recognizable as the layers separate.',
    );
    await drag(`document.querySelector('.stage')`, 95, -35, 36);
    pointer = null;
    hold(2.7);
    caption(
      'Adjust the depth to reduce the detail.',
      'Move from the broad structure to the individual components.',
    );
    await slider('Reveal depth', 2, 24);
    hold(1.2);
    await slider('Reveal depth', 4, 24);
    pointer = null;
    hold(1.8);
    caption(
      'Select a component in the hierarchy.',
      'The matching layer is highlighted. Press F to focus its subtree.',
    );
    await select(id('ProjectCard', 'design-system'));
    hold(1.2);
    await key('f', 'KeyF');
    pointer = null;
    hold(3.3);
    caption(
      'Inspect one component and its children.',
      'ProjectCard is composed of a StatusBadge, ProgressBar, and AvatarStack.',
    );
    await select(id('ProgressBar'));
    hold(1.8);
    await select(id('ProjectCard', 'design-system'));
    pointer = null;
    hold(2);
    await save();

    chapter(
      '03 / PROPS',
      'Investigate the data behind the component.',
      'Resize the inspector, then expand the selected component’s props.',
    );
    await drag(`document.querySelector('[aria-label="Component details width"]')`, -110, 0, 24);
    await expand('props.project');
    pointer = null;
    hold(2.2);
    caption(
      'Expand arrays and nested objects.',
      'Follow a property path without losing the component’s visual context.',
    );
    await expand('props.project.team');
    await expand('props.project.team[0]');
    pointer = null;
    hold(3.5);
    caption(
      'Go deeper into the component’s configuration.',
      'Nested values load on demand. Inspection is read-only.',
    );
    await click(prop('props.project.team'));
    await expand('props.project.settings');
    await expand('props.project.settings.release');
    pointer = null;
    hold(3.2);
    await save();

    chapter(
      '04 / PICK ON PAGE',
      'Find a component directly on the page.',
      'Use the picker, then click the rendered UI you want to understand.',
    );
    await click(button('Whole page'));
    await click(button('Pick on page'));
    show('source');
    await shot(1);

    const target = `document.querySelector('[data-project="customer-portal"] h2')`;

    await moveTo(await box(target, 'source'), 0.65, 'source');
    await source.locator('[data-project="customer-portal"] h2').hover();
    await pause(160);
    await shot(1.3);
    await click(target, { target: 'source', after: 0.6 });
    show('panel');
    await h.until(
      () => run(`document.querySelector('.instance-name')?.textContent==='customer-portal'`),
      'Page picker failed',
    );
    caption(
      'The picker selects the matching React component.',
      'The component instance, tree selection, and props stay in sync.',
    );
    await shot(2.4);
    await click(button('Focus subtree'));
    await expand('props.project');
    pointer = null;
    hold(2.8);
    await save();

    chapter(
      '05 / FOLLOW CHANGES',
      'Follow the app as it changes.',
      'Enable Follow changes, then interact with the actual page.',
    );
    await click(button('Whole page'));
    await click(button('Follow changes'));
    show('source');
    await shot(0.8);
    await click(`document.querySelector('[data-project="customer-portal"] .complete-task')`, {
      target: 'source',
      after: 1.3,
    });
    show('panel');
    await h.until(
      () => run(`document.querySelector('.props-inspector')?.textContent.includes('progress: 54')`),
      'Live props did not refresh',
    );
    caption(
      'Rendered output and props update together.',
      'Customer portal progresses from 46% to 54%, while its selection is preserved.',
    );
    await shot(3.3);
    show('source');
    caption(
      'Newly mounted components appear in the hierarchy.',
      'Create a project in the app to mount a new card and a notification.',
    );
    await shot(0.5);
    await click(`document.querySelector('.new-project')`, { target: 'source', after: 2 });
    show('panel');
    await h.until(
      () =>
        run(
          `Array.from(document.querySelectorAll('.node-name')).some(el=>el.textContent==='Notification')`,
        ),
      'Portal missing',
    );
    await shot(1.5);

    const notification = await run(
      `Array.from(document.querySelectorAll('.tree-select')).find(el=>el.querySelector('.node-name').textContent==='Notification').dataset.tree`,
    );

    await select(notification);
    await click(button('Focus subtree'));
    caption(
      'Portals keep their React parent.',
      'The notification renders elsewhere in the DOM and remains part of the component hierarchy.',
    );
    pointer = null;
    await shot(3.8);
    await save();
  } else {
    await source.locator('[data-project="customer-portal"] .complete-task').click();

    if (!resumeLive) {
      await source.locator('.new-project').click();
      await source.locator('.notification').waitFor();
    }

    for (let i = 0; i < (resumeLive ? 1 : 2); i++) {
      const before = await run(`document.querySelector('.footer-count').textContent`);

      await run(`${button('Capture')}.click()`);
      await h.until(
        async () => (await run(`document.querySelector('.footer-count').textContent`)) !== before,
        'Restore capture failed',
      );
    }

    await run(`${button('Follow changes')}.click()`);

    for (let i = 0; i < 11; i++) {
      await run(
        `document.querySelector('[aria-label="Component details width"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`,
      );
      await pause(20);
    }

    if (resumeLive && previous) {
      await run(
        `document.querySelector('[data-tree="${id('ProjectCard', 'customer-portal')}"]').click()`,
      );
      await pause(150);
      await run(`${button('Focus subtree')}.click()`);
      await pause(80);
      await run(`${button('Whole page')}.click()`);
      await h.until(() => run(`${prop('props.project')}!==null`), 'Restore props missing');
      await run(`${prop('props.project')}.click()`);
      await pause(150);
      show('source');
      caption(
        'Newly mounted components appear in the hierarchy.',
        'Create a project in the app to mount a new card and a notification.',
      );
      await shot(0.5);
      await click(`document.querySelector('.new-project')`, { target: 'source', after: 2 });
      show('panel');
      await h.until(
        () =>
          run(
            `Array.from(document.querySelectorAll('.node-name')).some(el=>el.textContent==='Notification')`,
          ),
        'Portal missing',
      );
      await shot(1.5);

      const notification = await run(
        `Array.from(document.querySelectorAll('.tree-select')).find(el=>el.querySelector('.node-name').textContent==='Notification').dataset.tree`,
      );

      await select(notification);
      await click(button('Focus subtree'));
      caption(
        'Portals keep their React parent.',
        'The notification renders elsewhere in the DOM and remains part of the component hierarchy.',
      );
      pointer = null;
      await shot(3.8);
      await save();
    } else {
      await run(
        `Array.from(document.querySelectorAll('.tree-select')).find(el=>el.querySelector('.node-name').textContent==='Notification').click()`,
      );
      await pause(100);
      await run(`${button('Focus subtree')}.click()`);
      await pause(200);
    }

    console.log('Resumed before Elements at', time.toFixed(1), 'seconds.');
  }

  const strataTab = `(()=>{const walk=root=>{for(const el of root.querySelectorAll('*')){if(el.getAttribute('role')==='tab'&&((el.getAttribute('aria-label')||'').startsWith('Anatomy')||el.textContent.trim()==='Anatomy'))return el;if(el.shadowRoot){const match=walk(el.shadowRoot);if(match)return match;}}};return walk(document);})()`;

  chapter(
    '06 / ELEMENTS',
    'Continue debugging in Chrome Elements.',
    'Reveal the selected component’s DOM output in the browser’s native inspector.',
  );
  await click(button('Whole page'));
  await select(id('ProjectCard', 'customer-portal'));
  await click(button('Reveal in Elements'), { after: 2, wait: 300 });
  show('native');
  await shot(2);
  await click(strataTab, { target: 'native', after: 0.6, wait: 200 });
  show('panel');
  await click(button('Follow changes'));
  await click(button('Reset view'));
  await click(button('Explode view'));
  await select(id('ProjectCard', 'customer-portal'));
  await expand('props.project');
  pointer = null;
  chapter(
    'GET STARTED',
    'Open your app. Open React Anatomy. Understand the page.',
    'Chrome DevTools extension · Unpacked preview v0.4.2 · React component inspection',
  );
  await shot(5);
  assert.deepEqual(sourceErrors, [], 'The inspected app emitted a JavaScript error');
  assert.equal(
    await run(`document.querySelector('[role=alert]')?.textContent||null`),
    null,
    'The inspector has an error banner',
  );
  captions.at(-1)!.end = time;
  await save();
  await writeFile(
    output + '/recording-checks.json',
    JSON.stringify(
      {
        sourceErrors,
        initialComponents: nodes.length,
        finalComponents: await run(`document.querySelectorAll('.tree-select').length`),
        duration: time,
        frames: frames.length,
        nativeWidth: 2560,
        nativeHeight: 1300,
      },
      null,
      2,
    ),
  );
  console.log(
    `Captured ${frames.length} timed frames; ${time.toFixed(2)} seconds. Ready to render.`,
  );
} finally {
  await h.close();
  await fixture.close();
}

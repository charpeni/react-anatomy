import type { IntroTimeline, Point, Box, Rect } from './types.ts';
import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping';
import type { Narration } from './types.ts';
// Records the React Anatomy introduction with the real unpacked extension in Chrome DevTools.
// Output is a timeline of real screenshots plus cursor, camera and narration cues in
// "desktop" coordinates (a 1280 × 720 browser window with an undocked DevTools window on
// top). compose.ts turns that timeline into video frames.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { launchExtension, openDevtoolsPanel } from '../chrome-harness.ts';
import { startFixtureServer } from '../fixture-server.ts';
import { DESKTOP, CHROME_HEIGHT, WINDOW, TITLE_HEIGHT, DEVTOOLS, SUBTITLE_BAND } from './layout.ts';
import type { CDPSession, Page } from 'playwright';

process.env.FONTCONFIG_FILE = resolve('scripts/demo/fonts.conf');

const output = 'artifacts/intro';
const narration: Narration = JSON.parse(await readFile(output + '/narration.json', 'utf8'));

await rm(output + '/frames', { recursive: true, force: true });
await mkdir(output + '/frames', { recursive: true });

const clip = Object.fromEntries(narration.clips.map((c) => [c.id, c]));

const portFree = (port: number | undefined) =>
  new Promise((r) => {
    const s = createServer()
      .once('error', () => r(false))
      .listen(port, '127.0.0.1', () => s.close(() => r(true)));
  });

const fixture = await startFixtureServer((await portFree(4174)) ? 4174 : 0);
const h = await launchExtension();

const pause = (ms: number | undefined) => new Promise((r) => setTimeout(r, ms));

let time = 0;
let pageFile: string | null = null;
let devFile: string | null = null;
let count = 0;
let session: string | undefined;
let panelSession: string | undefined;
let sourceSession: CDPSession;
let source: Page;
let panelTop = 27;
let view = 'page';
let pointer: Point | null = null;
let speechEnd = 0;
const frames: IntroTimeline['frames'] = [];
const cursor: IntroTimeline['cursor'] = [];
const clicks: IntroTimeline['clicks'] = [];
const camera: IntroTimeline['camera'] = [];
const keys: { start: number; end: number; label: string[] }[] = [];
const speech: IntroTimeline['speech'] = [];
const events: IntroTimeline['events'] = {};

const run = <T = unknown>(expression: string) => h.evaluate<T>(expression, panelSession!);

const ui = <T = unknown>(expression: string) => h.evaluate<T>(expression, session!);

const save = () =>
  writeFile(
    output + '/timeline.json',
    JSON.stringify(
      {
        url: fixture.url + '/demo',
        fps: 30,
        duration: time,
        frames,
        cursor,
        clicks,
        camera,
        keys,
        speech,
        events,
      },
      null,
      2,
    ),
  );

const mark = (name: string) => {
  events[name] = +time.toFixed(4);
  console.log(`${time.toFixed(2)}s  ${name}`);
};

// ---- Clock, screenshots and narration -------------------------------------------------
function advance(seconds: number) {
  time += seconds;
}

async function capture(target: string) {
  const file = `frames/${String(count++).padStart(5, '0')}.png`;
  const result =
    target === 'page'
      ? await sourceSession.send('Page.captureScreenshot', { format: 'png' })
      : await h.send('Page.captureScreenshot', { format: 'png' }, session);

  await writeFile(output + '/' + file, Buffer.from(result.data, 'base64'));

  if (target === 'page') {
    pageFile = file;
  } else {
    devFile = file;
  }

  frames.push({ start: +time.toFixed(4), page: pageFile, dev: devFile });
}

async function settle(ms = 40) {
  await pause(ms);
  await run('document.body.offsetHeight');
}

async function shot(seconds = 1 / 30) {
  await capture(view === 'page' ? 'page' : 'dev');
  advance(seconds);
}

function say(id: string, { gap = 0.3 } = {}) {
  holdUntil(speechEnd + gap);
  speech.push({ id, start: +time.toFixed(4) });
  speechEnd = time + clip[id].duration;
  console.log(`${time.toFixed(2)}s  “${clip[id].text}”`);

  return time;
}

// Moment inside the clip that was just started, as a fraction of its spoken characters.
function at(id: string, phrase: string) {
  const c = clip[id];
  const i = c.text.indexOf(phrase);

  assert(i >= 0, phrase);

  return speech.find((s) => s.id === id)!.start + (c.duration * i) / c.text.length;
}

function holdUntil(t: number) {
  if (t > time) {
    advance(t - time);
  }
}

function finishSpeech(extra = 0.35) {
  holdUntil(speechEnd + extra);
}

// ---- Coordinates ----------------------------------------------------------------------
const toDesktop = (p: Point, target: string) =>
  target === 'page'
    ? { x: p.x, y: p.y + CHROME_HEIGHT }
    : { x: WINDOW.x + p.x, y: WINDOW.y + TITLE_HEIGHT + p.y + (target === 'panel' ? panelTop : 0) };

const desktopRect = (r: Box, target: string) => {
  const a = toDesktop({ x: r.left, y: r.top }, target);

  return { x: a.x, y: a.y, w: r.width, h: r.height };
};

// Camera: frame a desktop rectangle, keeping the top band clear for subtitles.
function frameRect(r: Rect, { pad = 14, top = SUBTITLE_BAND, maxZoom = 1.5 } = {}) {
  const s = Math.max(
    1,
    Math.min(maxZoom, DESKTOP.w / (r.w + pad * 2), (DESKTOP.h - top) / (r.h + pad * 2)),
  );
  const w = DESKTOP.w / s;
  const h = DESKTOP.h / s;
  let x = r.x + r.w / 2 - w / 2;
  let y = r.y + r.h / 2 - (DESKTOP.h - top) / s / 2 - top / s;

  x = Math.max(0, Math.min(DESKTOP.w - w, x));
  y = Math.max(0, Math.min(DESKTOP.h - h, y));

  return { x: +x.toFixed(2), y: +y.toFixed(2), w: +w.toFixed(2) };
}

function cameraTo(rect: { x: number; y: number; w: number }, seconds = 1.1) {
  camera.push({ start: +time.toFixed(4), duration: seconds, rect });
}

const FULL = { x: 0, y: 0, w: DESKTOP.w };

// ---- Input ----------------------------------------------------------------------------
async function input<M extends 'Input.dispatchMouseEvent' | 'Input.dispatchKeyEvent'>(
  method: M,
  params: ProtocolMapping.Commands[M]['paramsType'][0],
  target = view,
) {
  if (target === 'page') {
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

async function box(selector: string, target = view): Promise<Box> {
  const expression = `(()=>{const el=${selector};if(!el)throw new Error('Demo target missing');el.scrollIntoView({block:'nearest',inline:'nearest'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,left:r.left,top:r.top};})()`;

  return target === 'page'
    ? source.evaluate<Box>(expression)
    : target === 'native'
      ? ui<Box>(expression)
      : run<Box>(expression);
}

// Moves the drawn cursor (and the real mouse) to a point, spending `seconds` of video time.
async function moveTo(point: Point, seconds = 0.55, target = view, { live = false } = {}) {
  const end = toDesktop(point, target);
  const start = pointer || { x: end.x + 70, y: end.y + 90 };

  cursor.push({ start: +time.toFixed(4), end: +(time + seconds).toFixed(4), from: start, to: end });
  await input('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }, target);
  pointer = end;

  if (live) {
    await settle(60);
    await shot(seconds);
  } else {
    advance(seconds);
  }
}

async function press(point: Point, target = view) {
  await input(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 },
    target,
  );
  await input(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 },
    target,
  );
  clicks.push({ time: +time.toFixed(4), ...pointer! });
}

async function click(
  selector: string,
  { target = view, after = 0.35, wait = 160, move = 0.55 } = {},
) {
  const p = await box(selector, target);

  await moveTo(p, move, target);
  await press(p, target);
  await pause(wait);

  if (target !== 'native') {
    await settle();
  }

  await shot(after);
}

const button = (name: string) =>
  `Array.from(document.querySelectorAll('button,label')).find(b=>(b.getAttribute('aria-label')||b.textContent.trim())===${JSON.stringify(name)})`;

const prop = (path: string) =>
  `document.querySelector('[data-prop-path=${JSON.stringify(path)}] > summary')`;

async function expand(path: string, after = 0.3) {
  await h.until(() => run(`${prop(path)}!==null`), 'Missing prop ' + path);
  await click(prop(path), { after: 0.05, move: 0.45 });
  await h.until(
    () => run(`document.querySelector('.props-inspector [aria-busy="true"]')===null`),
    'Prop load stalled',
  );
  await settle();
  await shot(after);
}

// A point that actually hits the given 3D plane (planes overlap once rotated).
async function planePoint(id: string, prefer = { x: 0.5, y: 0.5 }) {
  return run<Point>(`(()=>{const el=document.querySelector('[data-plane="${id}"]');const r=el.getBoundingClientRect();let best=null;
    for(let i=1;i<20;i++)for(let j=1;j<20;j++){const x=r.left+r.width*i/20,y=r.top+r.height*j/20;const hit=document.elementFromPoint(x,y)?.closest('[data-plane]');
      if(hit===el){const d=Math.hypot(i/20-${prefer.x},j/20-${prefer.y});if(!best||d<best.d)best={x,y,d};}}
    if(!best)throw new Error('Plane not reachable: ${id}');return best;})()`);
}

async function hoverPlane(id: string, seconds = 0.5, prefer?: Point) {
  const p = await planePoint(id, prefer);

  await moveTo(p, seconds, 'panel');
  await settle(60);
  await shot(0.04);

  return p;
}

// Plays a CSS transition of the real panel in slow motion, frame by frame.
async function slow(trigger: () => Promise<unknown>, seconds: number) {
  const ms = Math.round(seconds * 1000);

  await run(`(()=>{let s=document.getElementById('demo-slow');if(!s){s=document.createElement('style');s.id='demo-slow';document.head.appendChild(s);}
    s.textContent='.scene,.component-plane{transition-duration:${ms}ms!important;transition-timing-function:cubic-bezier(.65,0,.3,1)!important}.plane-label{animation:demo-label ${Math.round(ms * 0.45)}ms ease ${Math.round(ms * 0.45)}ms both}@keyframes demo-label{from{opacity:0}to{opacity:1}}';})()`);
  await trigger();
  await pause(80);

  const count = await run<number>(
    `(window.__demo=document.getAnimations()).forEach(a=>a.pause()),window.__demo.length`,
  );

  assert(count > 0, 'No transition to play');

  const total = Math.round(seconds * 30);

  for (let i = 0; i <= total; i++) {
    await run(
      `window.__demo.forEach(a=>{a.currentTime=${(i * 1000) / 30};}),document.body.offsetHeight`,
    );
    await pause(25);
    await shot();
  }

  await run(
    `window.__demo.forEach(a=>a.finish());document.getElementById('demo-slow').textContent=''`,
  );
  await settle();
}

async function rotate(selector: string, dx: number, dy: number, steps = 40) {
  const p = await box(selector);

  await moveTo(p, 0.45);
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

    const d = toDesktop(next, 'panel');

    cursor.push({
      start: +time.toFixed(4),
      end: +(time + 1 / 30).toFixed(4),
      from: pointer!,
      to: d,
    });
    pointer = d;
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
  await settle();
  await shot(0.1);
}

try {
  // ---- Setup (not recorded) ----
  source = h.context.pages()[0];

  const sourceErrors: string[] = [];

  source.on('pageerror', (e) => sourceErrors.push(e.message));
  await source.setViewportSize({ width: DESKTOP.w, height: DESKTOP.h - CHROME_HEIGHT });
  await source.goto(fixture.url + '/demo');
  await source.getByRole('button', { name: 'New project' }).waitFor();
  sourceSession = await h.context.newCDPSession(source);
  await sourceSession.send('Emulation.setDeviceMetricsOverride', {
    width: DESKTOP.w,
    height: DESKTOP.h - CHROME_HEIGHT,
    deviceScaleFactor: 2,
    mobile: false,
  });
  ({ session, panelSession } = await openDevtoolsPanel(h));
  await h.send(
    'Emulation.setDeviceMetricsOverride',
    { width: DEVTOOLS.w, height: DEVTOOLS.h, deviceScaleFactor: 3, mobile: false },
    session,
  );
  await h.until(
    () => run(`document.querySelectorAll('.tree-select').length===24`),
    'Initial capture failed',
  );
  panelTop = await h.until(async () => {
    const top = DEVTOOLS.h - (await run<number>('innerHeight'));

    return top > 10 && top < 50 ? top : false;
  }, 'DevTools viewport did not settle');

  const nodes = await run<{ id: string; name: string; key: string | null; children: string[] }[]>(
    `Array.from(document.querySelectorAll('.tree-select')).map(el=>({id:el.dataset.tree,name:el.querySelector('.node-name').textContent,key:el.querySelector('.tree-key')?.textContent}))`,
  );

  const id = (name: string, key?: string) =>
    nodes.find((n) => n.name === name && (!key || n.key?.includes(key)))!.id;

  const child = (parent: string, name: string) =>
    nodes.slice(nodes.findIndex((n) => n.id === parent)).find((n) => n.name === name)!.id;

  await ui(
    `(async()=>{const UI=await import('devtools://devtools/bundled/ui/legacy/legacy.js');await UI.ViewManager.ViewManager.instance().showView('elements');})()`,
  );
  await pause(700);

  const anatomyTab = `(()=>{const walk=root=>{for(const el of root.querySelectorAll('*')){if(el.getAttribute('role')==='tab'&&((el.getAttribute('aria-label')||'').startsWith('Anatomy')||el.textContent.trim()==='Anatomy'))return el;if(el.shadowRoot){const match=walk(el.shadowRoot);if(match)return match;}}};return walk(document);})()`;
  const tab = await box(anatomyTab, 'native');

  // The real DevTools tab must read “Anatomy”; nothing in DevTools or the panel may still say Strata.
  assert.equal(
    await ui<string>(`${anatomyTab}.textContent.trim()`),
    'Anatomy',
    'DevTools tab label',
  );
  assert.equal(
    await run<string>(`document.title+document.body.textContent`).then((t) => /strata/i.test(t)),
    false,
    'Old product name in the panel',
  );

  // ---- 1. A normal website ----
  mark('website');
  camera.push({ start: 0, duration: 0, rect: FULL });
  view = 'page';
  await shot(0.6);
  say('c01', { gap: 0 });
  cursor.push({
    start: +time.toFixed(4),
    end: +time.toFixed(4),
    from: { x: 860, y: 610 },
    to: { x: 860, y: 610 },
  });
  pointer = { x: 860, y: 610 };
  await moveTo({ x: 640, y: 395 }, 1.6, 'page');
  say('c02', { gap: 0.35 });
  await moveTo({ x: 700, y: 470 }, 1.2, 'page');

  // ---- 2. Open DevTools ----
  view = 'native';
  await capture('dev');
  say('c03', { gap: 0.45 });
  holdUntil(at('c03', 'DevTools') - 0.35);
  keys.push({ start: +time.toFixed(4), end: +(time + 1.25).toFixed(4), label: ['⌥', '⌘', 'I'] });
  advance(0.45);
  mark('devtools');
  advance(0.9);
  say('c04', { gap: 0.3 });
  holdUntil(at('c04', 'new tab') - 0.2);
  await moveTo(tab, 0.9, 'native');
  holdUntil(at('c04', 'Anatomy') + 0.05);
  await press(tab, 'native');
  await pause(250);
  view = 'panel';
  await h.until(() => run(`document.visibilityState==='visible'`), 'Anatomy did not open');
  await settle(200);
  mark('panel');
  await shot(0.4);

  // ---- 3. Flat capture of the page ----
  const stage = desktopRect(
    await run(
      `(()=>{const a=document.querySelector('.stage').getBoundingClientRect(),b=document.querySelector('[aria-label="Layer controls"]').getBoundingClientRect();return{left:0,top:a.top,width:a.right,height:b.bottom-a.top};})()`,
    ),
    'panel',
  );

  say('c05', { gap: 0.25 });
  cameraTo(frameRect(stage), 1.4);
  await moveTo({ x: 330, y: 420 }, 1, 'panel');
  say('c06', { gap: 0.3 });
  finishSpeech(0.15);

  // ---- 4. Explode (centerpiece) ----
  say('c07', { gap: 0.25 });

  const explode = await box(`document.querySelector('.explode-button')`);

  await moveTo(explode, 0.7);
  holdUntil(speechEnd - 0.1);
  mark('explode');
  say('c08', { gap: 0.15 });
  await slow(() => press(explode), 3.6);
  finishSpeech(0.2);

  // ---- 5. Rotate and read the structure ----
  say('c09', { gap: 0.2 });
  await rotate(`document.querySelector('.stage')`, 120, -26, 40);

  const cue = clip.c09.cues[1].start + speech.at(-1)!.start;

  holdUntil(cue - 0.35);
  await hoverPlane(id('Sidebar'), 0.45, { x: 0.5, y: 0.25 });
  holdUntil(at('c09', 'project list') - 0.3);
  await hoverPlane(id('ProjectList'), 0.45, { x: 0.5, y: 0.15 });
  holdUntil(at('c09', 'each card') - 0.25);

  const card = await hoverPlane(id('ProjectCard', 'customer-portal'), 0.45, { x: 0.5, y: 0.6 });

  finishSpeech(0.25);

  // ---- 6. Select a layer ----
  const devtools = { x: WINDOW.x, y: WINDOW.y, w: WINDOW.w, h: WINDOW.h };

  say('c10', { gap: 0.2 });
  cameraTo(frameRect(devtools, { pad: 4 }), 1.1);
  advance(0.5);
  await press(card, 'panel');
  await settle(120);
  await h.until(
    () =>
      run(
        `document.querySelector('.tree-row.selected .tree-select')?.dataset.tree===${JSON.stringify(id('ProjectCard', 'customer-portal'))}`,
      ),
    'Plane selection failed',
  );
  mark('select');
  await shot(0.3);
  finishSpeech(0.3);

  // ---- 7. Focus the subtree ----
  say('c11', { gap: 0.15 });

  const focus = await box(button('Focus subtree'));

  await moveTo(focus, 0.7);
  await slow(() => press(focus), 1.8);
  finishSpeech(0.2);

  const stage2 = desktopRect(
    await run(
      `(()=>{const a=document.querySelector('.stage').getBoundingClientRect();return{left:0,top:a.top,width:a.right,height:a.height};})()`,
    ),
    'panel',
  );

  say('c12', { gap: 0.25 });
  cameraTo(frameRect(stage2), 1.2);
  holdUntil(at('c12', 'StatusBadge') - 0.35);
  await hoverPlane(child(id('ProjectCard', 'customer-portal'), 'StatusBadge'), 0.45);
  holdUntil(at('c12', 'ProgressBar') - 0.3);
  await hoverPlane(child(id('ProjectCard', 'customer-portal'), 'ProgressBar'), 0.4);
  holdUntil(at('c12', 'AvatarStack') - 0.3);
  await hoverPlane(child(id('ProjectCard', 'customer-portal'), 'AvatarStack'), 0.4);
  finishSpeech(0.3);

  // ---- 8. Props ----
  const details = desktopRect(
    await run(
      `(()=>{const r=document.querySelector('[aria-label="Component details"]').getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height};})()`,
    ),
    'panel',
  );

  say('c13', { gap: 0.2 });
  cameraTo(
    frameRect({
      x: details.x - 150,
      y: details.y,
      w: details.w + 150,
      h: Math.min(details.h, 400),
    }),
    1.2,
  );
  await moveTo({ x: 960, y: 120 }, 0.8);
  holdUntil(at('c13', 'real props') - 0.2);
  await expand('props.project', 0.4);
  finishSpeech(0.15);
  say('c14', { gap: 0.15 });
  holdUntil(at('c14', 'its team') - 0.4);
  await expand('props.project.team');
  await expand('props.project.team[0]', 0.2);
  holdUntil(at('c14', 'its settings') - 0.35);
  await click(prop('props.project.team'), { after: 0.15, move: 0.4 });
  await expand('props.project.settings');
  await expand('props.project.settings.release', 0.2);
  finishSpeech(0.5);

  // ---- 9. Close: back to the whole page ----
  say('c15', { gap: 0.2 });
  cameraTo(FULL, 1.4);

  const whole = await box(button('Whole page'));

  await moveTo(whole, 0.8);
  await slow(() => press(whole), 1.6);
  finishSpeech(0.2);
  say('c16', { gap: 0.3 });
  await moveTo({ x: 700, y: 300 }, 0.6, 'panel');
  await rotate(`document.querySelector('.stage')`, -70, -14, 46);
  say('c17', { gap: 0.3 });
  finishSpeech(0.7);
  mark('end');
  advance(3.6);
  cursor.push({ start: +time.toFixed(4), end: +time.toFixed(4), hide: true });

  assert.deepEqual(sourceErrors, [], 'The inspected app emitted a JavaScript error');
  assert.equal(
    await run(`document.querySelector('[role=alert]')?.textContent||null`),
    null,
    'The inspector has an error banner',
  );
  await save();
  await writeFile(
    output + '/recording-checks.json',
    JSON.stringify(
      {
        sourceErrors,
        components: nodes.length,
        duration: time,
        frames: frames.length,
        devtools: { ...DEVTOOLS, deviceScaleFactor: 3 },
        page: { width: DESKTOP.w, height: DESKTOP.h - CHROME_HEIGHT, deviceScaleFactor: 2 },
      },
      null,
      2,
    ),
  );
  console.log(`Captured ${frames.length} frames; ${time.toFixed(2)} seconds.`);
} finally {
  await h.close();
  await fixture.close();
}

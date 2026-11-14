// Record real interactions in Chromium, then produce a seekable H.264 walkthrough.
import { chromium, type Locator } from 'playwright';
import { mkdir, rename } from 'node:fs/promises';
import { browserOptions } from './browser-options.ts';
import { spawnSync } from 'node:child_process';
import ffmpegBinary from 'ffmpeg-static';

if (!ffmpegBinary) {
  throw new Error('FFmpeg is not available on this platform.');
}
const ffmpeg: string = ffmpegBinary;

await mkdir('artifacts/raw', { recursive: true });

const browser = await chromium.launch({ ...browserOptions(), headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
  recordVideo: { dir: 'artifacts/raw', size: { width: 1600, height: 1000 } },
});
const page = await context.newPage();
const errors: string[] = [];

page.on('pageerror', (e) => errors.push(e.message));
await page.goto(process.env.PROTOTYPE_URL || 'http://localhost:4173');
await page.waitForFunction(() => window.__anatomyPrototype);
await page.evaluate(() => {
  const cursor = document.createElement('div');

  cursor.id = 'record-cursor';
  cursor.style.cssText =
    'position:fixed;top:0;left:0;z-index:10000;pointer-events:none;transform:translate(800px,700px);filter:drop-shadow(0 2px 3px #0009)';
  cursor.innerHTML =
    '<svg width="22" height="27" viewBox="0 0 22 27"><path d="M2 1v22l5.7-6.2 4.6 9 4-2-4.5-8.7H20Z" fill="#eef6f0" stroke="#344a40" stroke-width="1.3"/></svg>';
  document.body.appendChild(cursor);
  document.addEventListener(
    'pointermove',
    (e) => (cursor.style.transform = `translate(${e.clientX}px,${e.clientY}px)`),
  );
  document.addEventListener(
    'pointerdown',
    () => (cursor.style.filter = 'drop-shadow(0 0 8px #b6ddc6)'),
  );
  document.addEventListener(
    'pointerup',
    () => (cursor.style.filter = 'drop-shadow(0 2px 3px #0009)'),
  );
});

const wait = (ms: number) => page.waitForTimeout(ms);

async function caption(kicker: string, title: string, text: string) {
  await page.evaluate((c) => window.__anatomyPrototype.setCaption(c), { kicker, title, text });
}

async function clearCaption() {
  await page.evaluate(() => window.__anatomyPrototype.setCaption(null));
}

async function click(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();

  const b = await locator.boundingBox();
  if (!b) {
    throw new Error('Recording target is not visible.');
  }

  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 16 });
  await wait(180);
  await locator.click();
}

async function slider(name: string, from: number, to: number, duration = 1800) {
  const el = page.getByRole('slider', { name });
  const box = await el.boundingBox();
  if (!box) {
    throw new Error('Recording slider is not visible.');
  }
  const max = Number(await el.getAttribute('max'));
  const min = Number(await el.getAttribute('min'));

  const point = (value: number) => box.x + 5 + ((box.width - 10) * (value - min)) / (max - min);

  await page.mouse.move(point(from), box.y + box.height / 2, { steps: 12 });
  await page.mouse.down();

  for (let i = 1; i <= 60; i++) {
    await page.mouse.move(point(from + ((to - from) * i) / 60), box.y + box.height / 2);
    await wait(duration / 60);
  }

  await page.mouse.up();
}

console.log('Recording: assembled page → exploded hierarchy');
await caption(
  '01 / SPATIAL WORKBENCH',
  'Start with the page you know.',
  'A real React app. 26 component instances, measured from their rendered output.',
);
await wait(3500);
await clearCaption();
await click(page.getByRole('button', { name: '3D', exact: true }));
await wait(700);
await slider('Layer separation', 0, 73, 2400);
await caption(
  '01 / SPATIAL WORKBENCH',
  'Pull the React hierarchy into view.',
  'The page keeps its layout. Component nesting becomes spatial depth.',
);
await wait(3200);
await clearCaption();
await page.mouse.move(1050, 220, { steps: 20 });
await page.mouse.down();

for (let i = 1; i <= 50; i++) {
  await page.mouse.move(1050 - (100 * i) / 50, 220 + (40 * i) / 50);
  await wait(20);
}

await page.mouse.up();
await wait(1200);
await click(page.getByRole('button', { name: '3D', exact: true }));
await wait(600);
console.log('Recording: select and reveal depth');
await click(page.locator('[data-tree=c13]'));
await wait(600);
await caption(
  'CONNECTED SELECTION',
  'A name, a place, and a parent.',
  'The tree, 3D scene, and ownership path stay connected.',
);
await wait(3000);
await clearCaption();
await slider('Reveal depth', 5, 2, 1600);
await wait(1300);
await caption(
  'PROGRESSIVE DISCLOSURE',
  'Read the structure before the details.',
  'Reveal deeper levels when you’re ready to explore them.',
);
await wait(2300);
await clearCaption();
await slider('Reveal depth', 2, 5, 2000);
await wait(900);
await click(page.locator('[data-tree=c14]'));
await wait(500);
await click(page.getByRole('button', { name: 'Focus subtree' }));
await wait(600);
await caption(
  'FOCUS A SUBTREE',
  'Look inside a ProjectCard.',
  'Its ProgressBar and AvatarStack separate from the card itself.',
);
await wait(3800);
await clearCaption();
console.log('Recording: subtree lens');
await click(page.locator('[data-variant=B]'));
await wait(700);
await caption(
  '02 / SUBTREE LENS',
  'Give one branch the whole stage.',
  'Breadcrumbs keep your place; child components are the way forward.',
);
await wait(3300);
await clearCaption();
await click(page.locator('.lens-children button').filter({ hasText: 'ProjectGrid' }));
await wait(1400);
await click(page.locator('.lens-children button').filter({ hasText: 'ProjectCard' }).first());
await wait(800);
await slider('Layer separation', 66, 100, 1300);
await wait(1100);
await click(page.locator('.lens-navigation button').filter({ hasText: 'ProjectGrid' }));
await wait(1700);
console.log('Recording: depth atlas');
await click(page.locator('[data-variant=C]'));
await wait(600);
await caption(
  '03 / DEPTH ATLAS',
  'Lay out the composition, level by level.',
  'Each sheet preserves where that level’s components appear on the page.',
);
await wait(3300);
await clearCaption();
await page.mouse.move(1100, 600, { steps: 16 });

for (let i = 1; i <= 65; i++) {
  await page.locator('.atlas-scroll').evaluate((el, x) => (el.scrollLeft = x), (800 * i) / 65);
  await wait(20);
}

await wait(1500);
await click(page.locator('.atlas-names button').filter({ hasText: 'ProjectCard' }).first());
await wait(1800);
console.log('Recording: conclusion');
await click(page.locator('[data-variant=A]'));
await wait(600);
await slider('Reveal depth', 5, 4, 900);
await wait(500);
await caption(
  'REACT ANATOMY / REACT COMPOSITION STUDY',
  'Understand how the page is put together.',
  'Three working prototypes. One component hierarchy.',
);
await page.mouse.move(1520, 960, { steps: 20 });
await wait(4000);
await page.screenshot({ path: 'artifacts/poster.png' });

const video = page.video();
if (!video) {
  throw new Error('Video recording did not start.');
}

await context.close();

const raw = await video.path();

await rename(raw, 'artifacts/walkthrough.webm');
await browser.close();

if (errors.length) {
  throw new Error(errors.join('\n'));
}

console.log('Converting recording to MP4…');

const result = spawnSync(
  ffmpeg,
  [
    '-y',
    '-i',
    'artifacts/walkthrough.webm',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    'artifacts/react-anatomy-walkthrough.mp4',
  ],
  { encoding: 'utf8' },
);

if (result.status !== 0) {
  throw new Error(result.stderr);
}

console.log('Saved artifacts/react-anatomy-walkthrough.mp4');

import { launchExtension, openDevtoolsPanel } from './chrome-harness.ts';
import { startFixtureServer } from './fixture-server.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import ffmpegBinary from 'ffmpeg-static';

if (!ffmpegBinary) {
  throw new Error('FFmpeg is not available on this platform.');
}
const ffmpeg: string = ffmpegBinary;

const fixture = await startFixtureServer();
const h = await launchExtension();
const frames: { file: string; time: number }[] = [];
const writes: Promise<void>[] = [];
let stopRecording;

await mkdir('artifacts/props-frames', { recursive: true });

const pause = (ms: number | undefined) => new Promise((r) => setTimeout(r, ms));

try {
  const source = h.context.pages()[0];

  await source.goto(fixture.url + '/');
  await source.getByRole('button', { name: 'Update app (0)' }).waitFor();

  const { session, panelSession } = await openDevtoolsPanel(h);

  await h.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    session,
  );

  const run = <T = unknown>(expression: string) => h.evaluate<T>(expression, panelSession);

  await h.until(() => run(`document.querySelectorAll('.tree-select').length>0`), 'No snapshot');
  await pause(700);
  await run(
    `(()=>{const caption=document.createElement('div');caption.id='walkthrough-caption';caption.style.cssText='position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:1000;pointer-events:none;text-align:center;padding:9px 16px;border:1px solid #45464a;border-radius:2px;background:#202124f5;font-family:Arial,sans-serif;';document.body.appendChild(caption)})()`,
  );

  const caption = async (title: string, detail: string) =>
    run(
      `(()=>{const el=document.getElementById('walkthrough-caption');el.style.display='block';el.replaceChildren();const strong=document.createElement('strong');strong.textContent=${JSON.stringify(title)};strong.style.cssText='display:block;color:#e8eaed;font-size:13px;font-weight:500;';const p=document.createElement('p');p.textContent=${JSON.stringify(detail)};p.style.cssText='color:#bdc1c6;font-size:11px;margin:4px 0 0';el.append(strong,p);})()`,
    );

  const clear = () => run(`document.getElementById('walkthrough-caption').style.display='none'`);

  const click = async (text: string) =>
    run(
      `Array.from(document.querySelectorAll('button, label')).find(b=>(b.getAttribute('aria-label')||b.textContent.trim())===${JSON.stringify(text)})?.click()`,
    );

  const select = async (name: string) =>
    run(
      `Array.from(document.querySelectorAll('.tree-select')).find(b=>b.querySelectorAll('span')[1].textContent===${JSON.stringify(name)})?.click()`,
    );

  const expand = async (path: string) => {
    await h.until(
      () =>
        run(`document.querySelector('[data-prop-path=${JSON.stringify(path)}] summary')!==null`),
      'Missing prop ' + path,
    );
    await run(`document.querySelector('[data-prop-path=${JSON.stringify(path)}] summary').click()`);
    await pause(300);
  };

  const filter = async (value: string) => {
    await run(
      `(()=>{const el=document.querySelector('[aria-label="Filter prop names"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await pause(450);
  };

  for (let i = 0; i < 14; i++) {
    await run(
      `document.querySelector('[aria-label="Component details width"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`,
    );
    await pause(20);
  }

  await select('ProjectCard');
  await click('Focus subtree');
  await pause(650);
  stopRecording = h.onEvent((message) => {
    if (message.method !== 'Page.screencastFrame' || message.sessionId !== session) {
      return;
    }

    const file = `frame-${String(frames.length).padStart(5, '0')}.jpg`;

    frames.push({ file, time: message.params.metadata.timestamp! });
    writes.push(
      writeFile('artifacts/props-frames/' + file, Buffer.from(message.params.data, 'base64')),
    );
    h.send('Page.screencastFrameAck', { sessionId: message.params.sessionId }, session).catch(
      () => {},
    );
  });
  await h.send(
    'Page.startScreencast',
    { format: 'jpeg', quality: 88, maxWidth: 1600, maxHeight: 1000, everyNthFrame: 1 },
    session,
  );
  console.log('Recording real DevTools extension…');
  await caption(
    'Select a component. Inspect its props.',
    'The tree, rendered component, and property inspector stay connected.',
  );
  await pause(2500);
  await clear();
  await expand('props.project');
  await pause(900);
  await expand('props.project.people');
  await caption(
    'Expand objects and arrays',
    'Each branch loads on demand, with its property path shown below.',
  );
  await pause(2800);
  await clear();
  await click('Whole page');
  await select('PropsFixture');
  await pause(450);
  await filter('settings');

  for (const path of [
    'props.settings',
    'props.settings.account',
    'props.settings.account.team',
    'props.settings.account.team.preferences',
    'props.settings.account.team.preferences.palette',
  ]) {
    await expand(path);
  }

  await caption(
    'Follow nested values all the way down',
    'Filter by prop name, then expand the relevant branch.',
  );
  await pause(2700);
  await clear();
  await filter('items');
  await expand('props.items');
  await run(
    `document.querySelector('[data-prop-path="props.items"] .props-more').scrollIntoView({block:'nearest'})`,
  );
  await pause(650);
  await run(`document.querySelector('[data-prop-path="props.items"] .props-more').click()`);
  await pause(400);
  await run(
    `document.querySelector('[data-prop-path="props.items[50]"]').scrollIntoView({block:'center'})`,
  );
  await caption(
    'Large arrays load in pages',
    'Show more entries without serializing the whole object graph.',
  );
  await pause(2300);
  await clear();
  await filter('guarded');
  await expand('props.guarded');
  await caption(
    'Read-only inspection',
    'Getters stay unevaluated. Functions are shown without calling them.',
  );
  await pause(2500);
  await clear();
  await filter('version');
  await pause(600);
  await source.evaluate(() => window.updateInspectedProps!());
  await pause(500);
  await click('Refresh props');
  await h.until(
    () => run(`document.querySelector('.props-inspector').textContent.includes('version: 2')`),
    'Props did not refresh',
  );
  await caption(
    'Refresh props independently',
    'The React prop changed from 1 to 2. No DOM change or page recapture.',
  );
  await pause(2800);
  await clear();
  await select('ProjectCard');
  await click('Focus subtree');
  await pause(400);
  await expand('props.project');
  await expand('props.project.people');
  await pause(700);

  const shot = await h.send('Page.captureScreenshot', { format: 'png' }, session);

  await writeFile('artifacts/props-poster.png', Buffer.from(shot.data, 'base64'));
  await h.send('Page.stopScreencast', undefined, session);
  stopRecording();
  await Promise.all(writes);

  const lines = frames
    .map(
      (frame, i) =>
        `file '${frame.file}'\nduration ${i + 1 < frames.length ? Math.max(0.02, frames[i + 1].time - frame.time) : 2}`,
    )
    .join('\n');

  await writeFile('artifacts/props-frames/frames.txt', lines + `\nfile '${frames.at(-1)!.file}'\n`);
  console.log(`Converting ${frames.length} browser frames…`);

  const result = spawnSync(
    ffmpeg,
    [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'artifacts/props-frames/frames.txt',
      '-r',
      '25',
      '-c:v',
      'libx264',
      '-crf',
      '20',
      '-preset',
      'fast',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      'artifacts/react-anatomy-props.mp4',
    ],
    { encoding: 'utf8' },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr);
  }

  console.log('Saved artifacts/react-anatomy-props.mp4');
} finally {
  stopRecording?.();
  await h.close();
  await fixture.close();
}

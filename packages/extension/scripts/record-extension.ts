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

await mkdir('artifacts/extension-frames', { recursive: true });

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

  async function slider(name: string, from: number, to: number, duration = 1600) {
    for (let i = 0; i <= 45; i++) {
      await run(
        `(()=>{const el=document.querySelector('input[aria-label=${JSON.stringify(name)}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${from + ((to - from) * i) / 45});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await pause(duration / 45);
    }
  }

  stopRecording = h.onEvent((message) => {
    if (message.method !== 'Page.screencastFrame' || message.sessionId !== session) {
      return;
    }

    const file = `frame-${String(frames.length).padStart(5, '0')}.jpg`;

    frames.push({ file, time: message.params.metadata.timestamp! });
    writes.push(
      writeFile('artifacts/extension-frames/' + file, Buffer.from(message.params.data, 'base64')),
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
    'React Anatomy in Chrome DevTools',
    'Compact toolbars, component hierarchy, and a property inspector.',
  );
  await pause(3000);
  await clear();
  await click('3D');
  await pause(350);
  await slider('Layer separation', 0, 65, 1800);
  await caption(
    'Separate the rendered components',
    'Drag to rotate. The tree and selected plane stay connected.',
  );
  await pause(2400);
  await clear();

  const stage = await run<{ x: number; y: number }>(
    `(()=>{const r=document.querySelector('.stage').getBoundingClientRect();return {x:r.x+r.width*.75,y:r.y+r.height*.7}})()`,
  );

  // Browser input is dispatched to the panel frame; this exercises actual pointer capture.
  await h.send(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: stage.x, y: stage.y, button: 'left', clickCount: 1 },
    panelSession,
  );

  for (let i = 1; i <= 24; i++) {
    await h.send(
      'Input.dispatchMouseEvent',
      {
        type: 'mouseMoved',
        x: stage.x + (70 * i) / 24,
        y: stage.y + (30 * i) / 24,
        button: 'left',
        buttons: 1,
      },
      panelSession,
    );
    await pause(25);
  }

  await h.send(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: stage.x + 70, y: stage.y + 30, button: 'left', clickCount: 1 },
    panelSession,
  );
  await pause(500);
  await select('WorkspaceApp');
  await click('Focus subtree');
  await pause(600);
  await slider('Reveal depth', 4, 6, 1200);
  await caption(
    'Work through the hierarchy',
    'Arrow keys navigate the tree. Double-click or press F to focus.',
  );
  await pause(2400);
  await clear();

  const divider = await run<{ x: number; y: number }>(
    `(()=>{const r=document.querySelector('[aria-label="Component tree width"]').getBoundingClientRect();return {x:r.x+2,y:r.y+200}})()`,
  );

  await h.send(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', ...divider, button: 'left', clickCount: 1 },
    panelSession,
  );

  for (let i = 1; i <= 24; i++) {
    await h.send(
      'Input.dispatchMouseEvent',
      {
        type: 'mouseMoved',
        x: divider.x + (84 * i) / 24,
        y: divider.y,
        button: 'left',
        buttons: 1,
      },
      panelSession,
    );
    await pause(18);
  }

  await h.send(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: divider.x + 84, y: divider.y, button: 'left', clickCount: 1 },
    panelSession,
  );
  await select('ProjectCard');
  await click('Focus subtree');
  await pause(600);
  await run(`document.querySelector('.property-object summary')?.click()`);
  await pause(350);
  await caption(
    'Inspect a component in context',
    'Expandable props, rendered bounds, and the component stack.',
  );
  await pause(3000);
  await clear();
  await run(
    `document.querySelector('.tree-row.selected .tree-select').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`,
  );
  await pause(1100);
  await run(
    `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`,
  );
  await pause(900);
  await click('Whole page');
  await click('Pick on page');
  await pause(500);
  await source.locator('.project-card').nth(1).click();
  await h.until(
    () =>
      run(
        `document.querySelector('.inspector .instance-name')?.textContent.includes('Customer portal')`,
      ),
    'Picker did not update',
  );
  await click('Focus subtree');
  await pause(500);
  await caption(
    'Select directly in the running page',
    'The page picker finds the matching React component.',
  );
  await pause(2600);
  await clear();
  await click('Whole page');
  await click('Follow changes');
  await source.getByRole('button', { name: 'Toggle portal' }).click();
  await h.until(
    () =>
      run(
        `Array.from(document.querySelectorAll('.tree-select')).some(b=>b.textContent.includes('Notification'))`,
      ),
    'Live capture did not update',
  );
  await select('Notification');
  await click('Focus subtree');
  await pause(500);
  await caption(
    'Follow changes as the app runs',
    'This portal appeared in the page. Its React parent is preserved.',
  );
  await pause(2800);
  await clear();
  await click('Whole page');
  await select('WorkspaceApp');
  await click('Focus subtree');
  await pause(500);
  await slider('Reveal depth', 6, 5, 800);
  await select('ProjectCard');
  await pause(600);
  await caption(
    'An inspector for React composition',
    'Resizable panes · Keyboard navigation · Reveal in Elements',
  );
  await pause(2500);
  await clear();
  await pause(400);

  const shot = await h.send('Page.captureScreenshot', { format: 'png' }, session);

  await writeFile('artifacts/extension-poster.png', Buffer.from(shot.data, 'base64'));
  await h.send('Page.stopScreencast', undefined, session);
  stopRecording();
  await Promise.all(writes);

  const lines = frames
    .map(
      (frame, i) =>
        `file '${frame.file}'\nduration ${i + 1 < frames.length ? Math.max(0.02, frames[i + 1].time - frame.time) : 2}`,
    )
    .join('\n');

  await writeFile(
    'artifacts/extension-frames/frames.txt',
    lines + `\nfile '${frames.at(-1)!.file}'\n`,
  );
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
      'artifacts/extension-frames/frames.txt',
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
      'artifacts/react-anatomy-devtools.mp4',
    ],
    { encoding: 'utf8' },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr);
  }

  console.log('Saved artifacts/react-anatomy-devtools.mp4');
} finally {
  stopRecording?.();
  await h.close();
  await fixture.close();
}

import { transform } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { launchExtension, openDevtoolsPanel } from './chrome-harness.ts';
import { startFixtureServer } from './fixture-server.ts';

await mkdir('artifacts', { recursive: true });

declare const makeSnapshotRenderer: typeof import('../src/inspector/snapshot.ts').makeSnapshotRenderer;
declare const fontFacesOnly: typeof import('../src/inspector/snapshot.ts').fontFacesOnly;

const fixture = await startFixtureServer();
const harness = await launchExtension();

try {
  const page = harness.context.pages()[0];
  const sourceErrors: string[] = [];

  page.on('pageerror', (error) => sourceErrors.push(error.message));
  await page.goto(fixture.url + '/');
  await page.getByRole('button', { name: 'Update app (0)' }).waitFor();

  const { session, panelSession } = await openDevtoolsPanel(harness);

  const evaluate = <T = unknown>(expression: string) =>
    harness.evaluate<T>(expression, panelSession);

  const click = async (text: string) => {
    const found = await evaluate(
      `(()=>{const b=Array.from(document.querySelectorAll('button, label')).find(b=>(b.getAttribute('aria-label')||b.textContent.trim())===${JSON.stringify(text)});if(!b)return false;b.click();return true;})()`,
    );

    assert(found, `Missing button: ${text}`);
  };

  const select = async (name: string) => {
    const id = await evaluate(
      `(()=>{const b=Array.from(document.querySelectorAll('.tree-select')).find(b=>b.querySelectorAll('span')[1].textContent===${JSON.stringify(name)});if(!b)return null;b.click();return b.dataset.tree;})()`,
    );

    assert(id, `Missing component: ${name}`);

    return id;
  };

  const captureCount = () => evaluate(`document.querySelector('.footer-count').textContent`);

  await harness.until(
    () => evaluate(`document.querySelectorAll('.tree-select').length>0`),
    'Capture did not render',
  );

  const initial = await evaluate<{ count: number; text: string; errors?: string }>(
    `({count:document.querySelectorAll('.tree-select').length,text:document.body.textContent,errors:document.querySelector('[role=alert]')?.textContent})`,
  );

  console.log(
    'Initial capture:',
    JSON.stringify({ components: initial.count, error: initial.errors }),
  );
  await writeFile('artifacts/extension-initial.txt', initial.text);
  assert(initial.count >= 30, 'Independent app hierarchy was not captured');
  assert(
    initial.text.includes('Pair') &&
      initial.text.includes('MemoBadge') &&
      initial.text.includes('RefBadge') &&
      initial.text.includes('NullOutput'),
    'React component forms are missing',
  );
  assert(initial.text.includes('2 roots'), 'Multiple React roots are missing');
  assert(!initial.errors, initial.errors ?? 'Unexpected capture error');

  const card = await select('ProjectCard');

  await click('Focus subtree');
  await harness.until(
    () =>
      evaluate(
        `!!document.querySelector('.focus-navigation')&&!document.querySelector('[aria-label="Capture"]').disabled`,
      ),
    'Focused capture did not finish',
  );
  await harness.until(
    () =>
      evaluate(`document.querySelector('.focus-navigation')?.textContent.includes('ProjectCard')`),
    'Subtree focus failed',
  );
  assert.equal(await evaluate(`document.querySelectorAll('[data-plane]').length`), 3);
  await click('Whole page');
  await harness.until(
    () =>
      evaluate(
        `!document.querySelector('.focus-navigation')&&!document.querySelector('[aria-label="Capture"]').disabled`,
      ),
    'Whole page capture did not finish',
  );
  await page.getByRole('button', { name: 'Update app (0)' }).click();
  await harness.until(
    () =>
      evaluate(`document.querySelector('.extension-footer').textContent.includes('Page changed')`),
    'The stale snapshot was not detected',
  );

  const before = await captureCount();

  await click('Follow changes');
  await harness.until(
    async () => (await captureCount()) !== before,
    'Follow changes did not recapture',
  );
  assert.equal(
    await evaluate(`document.querySelector('.tree-row.selected .tree-select').dataset.tree`),
    card,
    'Selection was lost during capture',
  );
  assert(
    await evaluate(
      `Array.from(document.querySelectorAll('.plane-content')).some(el=>el.textContent.includes('Update app (1)'))`,
    ),
  );
  console.log('Passed: stale detection, following changes, stable selection, focus.');
  await click('Pick on page');
  await page.locator('.project-card').nth(1).click();
  await harness.until(
    () =>
      evaluate(
        `document.querySelector('.inspector .instance-name')?.textContent.includes('Customer portal')`,
      ),
    'Page picker did not select the component',
  );
  await click('Highlight on page');
  assert.equal(await page.locator('[data-strata-overlay]').count(), 1);
  console.log('Passed: real page picking and highlighting.');

  const beforePortal = await captureCount();

  await page.getByRole('button', { name: 'Toggle portal' }).click();
  await harness.until(
    async () => (await captureCount()) !== beforePortal,
    'Portal update was not captured',
  );
  await harness.until(
    () =>
      evaluate(
        `Array.from(document.querySelectorAll('.node-name')).some(n=>n.textContent==='Notification')`,
      ),
    'Portal did not appear after follow-up capture',
  );
  await select('Notification');
  assert(
    await evaluate(`document.querySelector('.component-kind').textContent.includes('portal')`),
    'Portal metadata is missing',
  );
  await click('Focus subtree');
  await harness.until(
    () =>
      evaluate(
        `!!document.querySelector('.focus-navigation')&&!document.querySelector('[aria-label="Capture"]').disabled`,
      ),
    'Focused capture did not finish',
  );

  const portalOrigin = await evaluate<{ x: number; y: number; text: string }>(
    `(()=>{const host=document.querySelector('.plane-content').firstElementChild.firstElementChild;return{x:host.offsetLeft,y:host.offsetTop,text:host.textContent};})()`,
  );

  assert.equal(portalOrigin.x, 0, 'Fixed portal output was displaced horizontally');
  assert.equal(portalOrigin.y, 0, 'Fixed portal output was displaced vertically');
  assert(portalOrigin.text.includes('A React portal'));
  await click('Reveal in Elements');
  await new Promise((r) => setTimeout(r, 200));
  await harness.evaluate(
    `(async()=>{const UI=await import('devtools://devtools/bundled/ui/legacy/legacy.js');const manager=UI.ViewManager.ViewManager.instance();await manager.showView(Array.from(manager.views.values()).find(v=>v.title()==='Anatomy').viewId());})()`,
    session,
  );
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(
    await evaluate(`document.querySelector('[role=alert]')?.textContent||null`),
    null,
    'Reveal in Elements returned an error',
  );
  await click('Whole page');
  await harness.until(
    () =>
      evaluate(
        `!document.querySelector('.focus-navigation')&&!document.querySelector('[aria-label="Capture"]').disabled`,
      ),
    'Whole page capture did not finish',
  );
  console.log('Passed: visible fixed-position portal output and Reveal in Elements.');
  await select('Pair');
  assert(
    await evaluate(
      `document.querySelector('.component-kind').textContent.includes('Multiple DOM roots')`,
    ),
    'Fragment output is missing',
  );
  await select('NullOutput');
  assert(
    await evaluate(
      `document.querySelector('.component-kind').textContent.includes('No DOM output')`,
    ),
  );
  console.log('Passed: portal ownership, fragments, and null output.');
  await page.goto(fixture.url + '/plain');

  try {
    await harness.until(
      () =>
        evaluate(
          `document.querySelector('.empty-state')?.textContent.includes('No mounted React')`,
        ),
      'Navigation to a non-React page did not clear the old hierarchy',
    );
  } catch (e) {
    console.log('Navigation failure:', await evaluate(`document.body.textContent.slice(0,2000)`));

    throw e;
  }

  await page.goto(fixture.url + '/');
  await page.getByRole('button', { name: 'Update app (0)' }).waitFor();
  await harness.until(
    () => evaluate(`document.querySelectorAll('.tree-select').length>=30`),
    'Navigation back did not reconnect',
  );
  assert.equal(sourceErrors.length, 0, sourceErrors.join('\n'));
  console.log('Passed: navigation, empty state, and reconnect; no source page errors.');

  if (await evaluate(`document.querySelector('.follow-control input').checked`)) {
    await click('Follow changes');
  }

  await evaluate(
    `Array.from(document.querySelectorAll('button, label')).find(b=>(b.getAttribute('aria-label')||b.textContent.trim())==='Explode view').click()`,
  );
  await harness.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    session,
  );
  await new Promise((r) => setTimeout(r, 500));

  const shot = await harness.send('Page.captureScreenshot', { format: 'png' }, session);

  await writeFile('artifacts/extension-devtools.png', Buffer.from(shot.data, 'base64'));
  // Exercise interactions that the compact tree and split panes depend on.
  await select('ProjectCard');
  await evaluate(
    `document.querySelector('.tree-row.selected .tree-select').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`,
  );
  assert.equal(
    await evaluate(`document.querySelector('.tree-row.selected .node-name').textContent`),
    'ProgressBar',
  );
  await evaluate(
    `document.querySelector('.tree-row.selected .tree-select').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`,
  );
  assert.equal(
    await evaluate(`document.querySelector('.tree-row.selected .node-name').textContent`),
    'ProjectCard',
  );

  const oldWidth = await evaluate<number>(
    `document.querySelector('.tree-panel').getBoundingClientRect().width`,
  );

  await evaluate(
    `document.querySelector('[aria-label="Component tree width"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`,
  );
  assert.equal(
    await evaluate(`document.querySelector('.tree-panel').getBoundingClientRect().width`),
    oldWidth + 10,
  );
  await click('Focus subtree');
  await harness.until(
    () =>
      evaluate(
        `!!document.querySelector('.focus-navigation')&&!document.querySelector('[aria-label="Capture"]').disabled`,
      ),
    'Focused capture did not finish',
  );
  assert.equal(
    await evaluate(`document.querySelector('.inspector-heading h2').textContent`),
    'ProjectCard',
  );
  await harness.until(
    () => evaluate(`document.querySelector('.property-object')!==null`),
    'Expandable props are missing',
  );
  await evaluate(`document.querySelector('.property-object').open=true`);
  await new Promise((r) => setTimeout(r, 300));

  const focused = await harness.send('Page.captureScreenshot', { format: 'png' }, session);

  await writeFile('artifacts/extension-focused.png', Buffer.from(focused.data, 'base64'));

  for (const [width, height] of [
    [1000, 600],
    [760, 430],
    [560, 400],
  ]) {
    await harness.send(
      'Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile: false },
      session,
    );
    await new Promise((r) => setTimeout(r, 150));

    const layout = await evaluate<{
      viewport: number;
      body: number;
      canvas: number;
      toolbar: number;
    }>(
      `({viewport:innerWidth,body:document.documentElement.scrollWidth,canvas:document.querySelector('.stage').getBoundingClientRect().width,toolbar:document.querySelector('.control-dock').getBoundingClientRect().height})`,
    );

    assert(
      layout.body <= layout.viewport,
      `Horizontal overflow at ${width}: ${JSON.stringify(layout)}`,
    );
    assert(layout.canvas > 150, `Canvas too narrow at ${width}`);

    if (width === 760) {
      await click('Toggle component details');
      assert.equal(
        await evaluate(`getComputedStyle(document.querySelector('.inspector')).display`),
        'flex',
      );
      await click('Close component details');

      const docked = await harness.send('Page.captureScreenshot', { format: 'png' }, session);

      await writeFile('artifacts/extension-docked.png', Buffer.from(docked.data, 'base64'));
    }
  }

  await harness.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    session,
  );
  console.log(
    'Passed: tree keyboard navigation, sidebar resizing, expandable props, narrow/short layouts.',
  );

  const nativeTheme = await evaluate(`chrome.devtools.panels.themeName`);

  assert.equal(
    await evaluate(`document.documentElement.dataset.theme`),
    nativeTheme === 'dark' ? 'dark' : 'light',
  );
  // Render the alternate palette as well, independently of the browser profile theme.
  await evaluate(`document.documentElement.dataset.theme='dark'`);
  await new Promise((r) => setTimeout(r, 200));

  const dark = await harness.send('Page.captureScreenshot', { format: 'png' }, session);

  await writeFile('artifacts/extension-dark.png', Buffer.from(dark.data, 'base64'));

  const isolated = await harness.context.newPage();

  await isolated.addScriptTag({
    content: (
      await transform(
        (await readFile('src/inspector/snapshot.ts', 'utf8')).replace(/^export /gm, ''),
        { loader: 'ts', target: 'esnext' },
      )
    ).code,
  });

  const sanitization = await isolated.evaluate(() => {
    const renderer = makeSnapshotRenderer({
      html: '<div data-strata-host="h1"><script>window.bad=true</script><iframe srcdoc="bad"></iframe><img src="javascript:bad()" onerror="window.bad=true"><a href="javascript:bad()">link</a><input type="password" value="fixture-secret"></div>',
      hostRects: { h1: { x: 0, y: 0, w: 100, h: 100 } },
    });
    const html = renderer({ id: 'c1', hosts: ['h1'], frame: { x: 0, y: 0, w: 100, h: 100 } }, []);
    const root = document.createElement('div');

    root.innerHTML = html;

    return {
      active: root.querySelectorAll('script,iframe,[onerror],[href],img[src]').length,
      passwordLeaked: html.includes('fixture-secret'),
      fonts: fontFacesOnly(
        'body {display:none} @font-face {font-family:Safe;src:url(data:font/woff2;base64,AA==)}',
      ),
    };
  });

  assert.equal(sanitization.active, 0);
  assert.equal(sanitization.passwordLeaked, false);
  assert(!sanitization.fonts.includes('body'));
  await isolated.close();
  console.log('Passed: independent viewer-side markup and font sanitization.');
  console.log('Real DevTools panel capture passed.');
} finally {
  await harness.close();
  await fixture.close();
}

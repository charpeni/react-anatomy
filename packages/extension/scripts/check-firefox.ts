import { transform } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchFirefox } from './firefox-harness.ts';
import { startFixtureServer } from './fixture-server.ts';

await mkdir('artifacts/firefox', { recursive: true });

const fixture = await startFixtureServer();
let h!: Awaited<ReturnType<typeof launchFirefox>>;
let artifacts = 'artifacts/firefox';

try {
  h = await launchFirefox();
  artifacts += '/' + h.version;
  await mkdir(artifacts, { recursive: true });
  console.log(`Testing native Firefox ${h.version}`);
  await h.navigate(fixture.url);
  await h.until(
    () => h.page(`Boolean(document.querySelector('.project-card'))`),
    'Fixture did not mount',
  );
  await h.openPanel();

  const run = <T = unknown>(expression: string) => h.panel<T>(expression);

  const click = async (label: string) => {
    const found = await run(
      `(()=>{const el=[...document.querySelectorAll('button,label')].find(el=>(el.getAttribute('aria-label')||el.textContent.trim())===${JSON.stringify(label)});if(!el)return false;el.click();return true;})()`,
    );

    assert(found, `Missing control: ${label}`);
  };

  const select = async (name: string) => {
    const id = await run(
      `(()=>{const el=[...document.querySelectorAll('.tree-select')].find(el=>el.querySelector('.node-name').textContent===${JSON.stringify(name)});if(!el)return null;el.click();return el.dataset.tree;})()`,
    );

    assert(id, `Missing component: ${name}`);

    return id;
  };

  const props = () => run<string>(`document.querySelector('.props-inspector')?.textContent||''`);

  const expand = async (path: string) => {
    const selector = JSON.stringify(`[data-prop-path="${path}"] summary`);

    await h.until(
      () => run(`Boolean(document.querySelector(${selector}))`),
      `Missing prop: ${path}`,
    );
    await run(`document.querySelector(${selector}).click()`);
  };

  const count = () => run(`document.querySelector('.footer-count').textContent`);

  const settle = () =>
    run(
      `Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{}))).then(()=>true)`,
    );

  await h.until(
    () => run(`document.querySelectorAll('.tree-select').length>=30`),
    'React hierarchy was not captured',
  );

  const initial = await run<{ count: number; text: string; error?: string }>(
    `({count:document.querySelectorAll('.tree-select').length,text:document.body.textContent,error:document.querySelector('[role=alert]')?.textContent})`,
  );

  assert(!initial.error, initial.error ?? 'Unexpected capture error');

  for (const name of ['Pair', 'MemoBadge', 'RefBadge', 'NullOutput', '2 roots']) {
    assert(initial.text.includes(name), `Missing ${name}`);
  }

  await click('Explode view');

  const card = await select('ProjectCard');

  await click('Focus subtree');
  await h.until(
    () => run(`document.querySelector('.focus-navigation')?.textContent.includes('ProjectCard')`),
    'Focus failed',
  );
  assert.equal(await run<string>(`document.querySelectorAll('[data-plane]').length`), 3);
  await expand('props.project');
  await h.until(async () => (await props()).includes('Orbit design system'), 'Card props missing');
  await settle();
  await h.screenshot(artifacts + '/focused.png');
  await click('Whole page');
  await h.page(
    `(()=>{[...document.querySelectorAll('button')].find(el=>el.textContent==='Update app (0)').click();return true;})()`,
  );
  await h.until(
    () => run(`document.querySelector('.extension-footer').textContent.includes('Page changed')`),
    'Stale snapshot not detected',
  );

  const before = await count();

  await click('Follow changes');
  await h.until(async () => (await count()) !== before, 'Follow did not recapture');
  assert.equal(
    await run(`document.querySelector('.tree-row.selected .tree-select').dataset.tree`),
    card,
  );
  console.log(
    'Passed: native DevTools capture, multiple roots, layers, focus, props, following changes and stable selection.',
  );

  await click('Pick on page');
  await h.clickPage('.project-card:nth-of-type(2)');
  await h.until(
    () =>
      run(
        `document.querySelector('.inspector .instance-name')?.textContent.includes('Customer portal')`,
      ),
    'Page picker did not select the component',
  );
  await click('Highlight on page');
  assert.equal(await h.page(`document.querySelectorAll('[data-strata-overlay]').length`), 1);
  await click('Reveal in Elements');
  await h.until(
    () => h.chrome(`window.__anatomyToolbox.currentToolId==='inspector'`),
    'Reveal did not switch to Firefox Inspector',
  );

  const revealed = await h.chrome<{ name: string; classes: string | null }>(
    `(()=>{const node=window.__anatomyToolbox.getPanel('inspector').selection.nodeFront;return {name:node.nodeName,classes:node.getAttribute('class')};})()`,
  );

  assert(revealed.classes?.includes('project-card'), 'Reveal selected the wrong DOM node');
  await h.showPanel();
  await select('Pair');
  assert(
    await run(
      `document.querySelector('.component-kind').textContent.includes('Multiple DOM roots')`,
    ),
  );
  await select('NullOutput');
  assert(
    await run(`document.querySelector('.component-kind').textContent.includes('No DOM output')`),
  );

  const portalCount = await count();

  await h.page(
    `(()=>{[...document.querySelectorAll('button')].find(el=>el.textContent==='Toggle portal').click();return true;})()`,
  );
  await h.until(async () => (await count()) !== portalCount, 'Portal change not captured');
  await select('Notification');
  assert(
    await run<string>(`document.querySelector('.component-kind').textContent.includes('portal')`),
  );
  await click('Focus subtree');

  const portal = await run<{ x: number; y: number; text: string }>(
    `(()=>{const host=document.querySelector('.plane-content').firstElementChild.firstElementChild;return {x:host.offsetLeft,y:host.offsetTop,text:host.textContent};})()`,
  );

  assert.equal(portal.x, 0);
  assert.equal(portal.y, 0);
  assert(portal.text.includes('A React portal'));
  await click('Whole page');
  await click('Follow changes');
  console.log(
    'Passed: real page picking, highlighting, reveal in Firefox Inspector, fragments, null output and portals.',
  );

  await select('PropsFixture');
  await h.until(async () => (await props()).includes('9007199254740993n'), 'Typed props missing');

  for (const path of [
    'props.settings',
    'props.settings.account',
    'props.settings.account.team',
    'props.settings.account.team.preferences',
    'props.settings.account.team.preferences.palette',
  ]) {
    await expand(path);
  }

  await h.until(async () => (await props()).includes('#315cf5'), 'Nested props missing');
  await expand('props.circular');
  await h.until(async () => (await props()).includes('Circular reference'), 'Cycle not identified');
  await expand('props.guarded');
  await h.until(
    async () => (await props()).includes('[Getter — not evaluated]'),
    'Getter not identified',
  );
  await expand('props.hostile');
  await h.until(
    async () => (await props()).includes('This value cannot be inspected'),
    'Throwing proxy not contained',
  );
  await expand('props.items');
  await h.until(
    () => run(`Boolean(document.querySelector('[data-prop-path="props.items[49]"]'))`),
    'Array page missing',
  );
  await run(`document.querySelector('[data-prop-path="props.items"] .props-more').click()`);
  await h.until(
    () => run(`Boolean(document.querySelector('[data-prop-path="props.items[99]"]'))`),
    'Array paging failed',
  );

  const beforeRefresh = await count();

  await h.page('window.updateInspectedProps()');
  await click('Refresh props');
  await h.until(async () => (await props()).includes('version: 2'), 'Live props refresh failed');
  assert.equal(await count(), beforeRefresh, 'Props refresh recaptured the page');
  assert.equal(await h.page('window.propGetterCalls||0'), 0);
  assert.equal(await h.page('window.propCallbackCalls||0'), 0);
  await h.page('window.unmountInspectedProps()');
  await click('Refresh props');
  await h.until(async () => (await props()).includes('no longer mounted'), 'Unmount not detected');
  console.log(
    'Passed: typed/nested props, lazy paging, cycles, getters, hostile proxies, live props refresh and unmount.',
  );

  await h.navigate(fixture.url + '/plain');
  await h.until(
    () => run(`document.querySelector('.empty-state')?.textContent.includes('No mounted React')`),
    'Non-React navigation retained old hierarchy',
  );

  const snapshotSource = (
    await transform(
      (await readFile('src/inspector/snapshot.ts', 'utf8')).replace(/^export /gm, ''),
      { loader: 'ts', target: 'esnext' },
    )
  ).code;
  const sanitized = await h.page<{ active: number; passwordLeaked: boolean; fonts: string }>(`(()=>{
    ${snapshotSource}
    const render=makeSnapshotRenderer({
      html:'<div data-strata-host="h1"><script>window.bad=true</script><iframe srcdoc="bad"></iframe><img src="javascript:bad()" onerror="window.bad=true"><a href="javascript:bad()">link</a><input type="password" value="fixture-secret"></div>',
      hostRects:{h1:{x:0,y:0,w:100,h:100}}
    });
    const html=render({id:'c1',hosts:['h1'],frame:{x:0,y:0,w:100,h:100}},[]);
    const root=document.createElement('div');root.innerHTML=html;
    return {active:root.querySelectorAll('script,iframe,[onerror],[href],img[src]').length,passwordLeaked:html.includes('fixture-secret'),fonts:fontFacesOnly('body {display:none} @font-face {font-family:Safe;src:url(data:font/woff2;base64,AA==)}')};
  })()`);

  assert.equal(sanitized.active, 0);
  assert.equal(sanitized.passwordLeaked, false);
  assert(!sanitized.fonts.includes('body'));
  console.log('Passed: independent viewer-side markup and font sanitization in Firefox.');
  await h.navigate(fixture.url + '/');
  await h.until(
    () => run(`document.querySelectorAll('.tree-select').length>=30`),
    'Navigation did not reconnect',
  );

  const nativeTheme = await run('chrome.devtools.panels.themeName');

  assert.equal(
    await run('document.documentElement.dataset.theme'),
    nativeTheme === 'dark' ? 'dark' : 'light',
  );
  await settle();
  await h.screenshot(artifacts + '/devtools.png');
  await h.navigate(fixture.url + '/deep');
  await h.until(
    () => run(`document.querySelectorAll('.tree-select').length>100`),
    'Production tree did not load',
  );

  const production = await run<{ count: number; error?: string }>(
    `({count:document.querySelectorAll('.tree-select').length,text:document.body.textContent,error:document.querySelector('[role=alert]')?.textContent})`,
  );

  assert(!production.error, production.error ?? 'Unexpected capture error');
  console.log(
    `Passed: navigation, empty state, reconnect, native theme and production capture (${production.count} visible rows).`,
  );

  await h.navigate(fixture.url + '/');
  await h.until(
    () => run(`document.body.textContent.includes('PropsFixture')`),
    'Fixture did not reconnect',
  );

  const popup = await h.openToolbarInspector();

  await h.until(
    () => popup(`document.querySelectorAll('.tree-select').length>=30`),
    'Toolbar capture failed',
  );
  await popup(
    `Array.from(document.querySelectorAll('.tree-select')).find(el=>el.querySelector('.node-name').textContent==='ProjectCard').click()`,
  );
  await h.until(
    () =>
      popup(`document.querySelector('.props-inspector')?.textContent.includes('project: Object')`),
    'Toolbar props failed',
  );
  assert.equal(await popup(`document.querySelector('[role=alert]')?.textContent||null`), null);
  await writeFile(
    artifacts + '/validation.json',
    JSON.stringify(
      {
        browser: 'Firefox',
        version: h.version,
        extension: h.extensionId,
        nativeDevtools: true,
        toolbarActiveTab: true,
        initialComponents: initial.count,
        productionVisibleRows: production.count,
        passed: true,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Passed: real toolbar click, activeTab grant, MAIN-world scripting capture and props.',
  );
  console.log('Firefox extension checks passed.');
} catch (error) {
  if (h) {
    try {
      await h.screenshot(artifacts + '/failure.png');
    } catch {}

    try {
      await writeFile(artifacts + '/failure.txt', await h.panel('document.body.textContent'));
    } catch {}
  }

  throw error;
} finally {
  await h?.close();
  await fixture.close();
}

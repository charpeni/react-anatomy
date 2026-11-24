import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchExtension, openDevtoolsPanel } from './chrome-harness.ts';
import { startFixtureServer } from './fixture-server.ts';

const fixture = await startFixtureServer();
const harness = await launchExtension();

try {
  const page = harness.context.pages()[0];

  await page.goto(fixture.url + '/deep');
  await page.locator('[data-region="card"]').first().waitFor();
  assert.equal(
    await page.evaluate(() => !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__),
    false,
    'Fixture must work without React DevTools',
  );

  const { session, panelSession } = await openDevtoolsPanel(harness);

  const evaluate = <T = unknown>(expression: string) =>
    harness.evaluate<T>(expression, panelSession);

  await harness.until(
    () => evaluate(`Number(document.querySelector('.tree-scroll')?.dataset.componentCount)>100`),
    'Deep tree did not load',
  );
  await harness.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    session,
  );

  const click = async (label: string) =>
    assert(
      await evaluate(
        `(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>(b.getAttribute('aria-label')||b.textContent.trim())===${JSON.stringify(label)});if(!b)return false;b.click();return true;})()`,
      ),
      `Missing ${label}`,
    );

  await click('Explode view');
  await harness.until(
    () => evaluate(`document.querySelector('[aria-label="Assemble"]')!==null`),
    'Explode did not commit',
  );
  await new Promise((r) => setTimeout(r, 250));

  const state = await evaluate<{
    tree: number;
    depth: string;
    planes: { id: string; width: number; height: number; text: string }[];
  }>(
    `({tree:Number(document.querySelector('.tree-scroll').dataset.componentCount),planes:Array.from(document.querySelectorAll('[data-plane]')).map(p=>({id:p.dataset.plane,width:parseFloat(p.style.width),height:parseFloat(p.style.height),text:p.textContent})),depth:document.querySelector('.depth-control output').textContent})`,
  );

  console.log(
    'Deep production hierarchy:',
    JSON.stringify({
      components: state.tree,
      planes: state.planes.length,
      depth: state.depth,
      widths: state.planes.map((p) => p.width),
    }),
  );
  await mkdir('artifacts', { recursive: true });

  const shot = await harness.send('Page.captureScreenshot', { format: 'png' }, session);

  await writeFile('artifacts/deep-hierarchy.png', Buffer.from(shot.data, 'base64'));
  assert(
    state.planes.some((p: { width: number }) => p.width === 220),
    'Sidebar has no individual plane at the initial depth',
  );
  assert(
    state.planes.some((p: { width: number }) => p.width === 260),
    'Details panel has no individual plane at the initial depth',
  );
  assert(
    state.planes.filter((p: { text: string | string[] }) =>
      p.text.includes('A distinct React component'),
    ).length >= 3,
    'Cards are not individually exposed',
  );
  assert(state.planes.length < 20, 'Shared-output wrappers overwhelm the scene');
  console.log(
    'Passed: distinct production components visible on initial explode, without React DevTools.',
  );

  const overviewCount = state.planes.length;
  const card = state.planes.find(
    (p: { text: string | string[] }) =>
      p.text.includes('Website') &&
      p.text.includes('A distinct React component') &&
      !p.text.includes('Mobile app'),
  );

  assert(card, 'An individual card plane is missing');
  await evaluate(
    `document.querySelector('[data-plane="${card.id}"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
  );
  await harness.until(
    () =>
      evaluate(
        `document.querySelector('.tree-row.selected [data-tree]')?.dataset.tree===${JSON.stringify(card.id)}&&document.querySelector('.props-inspector')?.textContent.includes('Website')`,
      ),
    'Plane selection did not select the original component and its props',
  );
  await click('Focus subtree');
  await harness.until(
    () =>
      evaluate(
        `!!document.querySelector('.focus-navigation')&&!document.querySelector('[aria-label="Capture"]').disabled`,
      ),
    'Focused capture did not finish',
  );
  await harness.until(
    () => evaluate(`document.querySelectorAll('[data-plane]').length===2`),
    'Focused card must show the card and its badge, not its wrappers',
  );
  await click('Whole page');
  await harness.until(
    () =>
      evaluate(
        `!document.querySelector('.focus-navigation')&&!document.querySelector('[aria-label="Capture"]').disabled`,
      ),
    'Whole page capture did not finish',
  );
  await harness.until(
    () => evaluate(`document.querySelectorAll('[data-plane]').length===${overviewCount}`),
    'Returning to whole page lost layers',
  );
  // A selected wrapper keeps its own props but highlights its shared plane.
  await evaluate(`document.querySelector('.tree-select').click()`);
  await harness.until(
    () => evaluate(`document.querySelectorAll('.component-plane.active').length===1`),
    'Wrapper selection did not highlight its represented output',
  );
  await click('Show wrapper layers');
  await harness.until(
    () => evaluate(`document.querySelectorAll('[data-plane]').length>60`),
    'Explicit wrapper view did not restore wrapper planes',
  );
  await click('Show wrapper layers');
  await harness.until(
    () => evaluate(`document.querySelectorAll('[data-plane]').length===${overviewCount}`),
    'Turning off wrappers did not restore distinct components',
  );
  await click('Collapse all components');
  await harness.until(
    () =>
      evaluate(
        `document.querySelectorAll('[data-plane]').length===1&&document.querySelectorAll('.tree-select').length===1`,
      ),
    'Collapsing wrappers must preserve their complete output',
  );
  await evaluate(`document.querySelector('.tree-toggle').click()`);
  // Collapse all also closes descendants, so reset restores the full scene.
  await click('Reset view');
  await harness.until(
    () => evaluate(`document.querySelectorAll('[data-plane]').length===${overviewCount}`),
    'Reset did not restore a useful depth',
  );
  await click('Pick on page');
  await page.locator('[data-region="card"]').nth(1).click();
  await harness.until(
    () =>
      evaluate(`document.querySelector('.props-inspector')?.textContent.includes('Mobile app')`),
    'Page picking did not reach a deep component',
  );

  const treeLabel = await evaluate<{ visible: boolean }>(
    `(()=>{const label=document.querySelector('.tree-row.selected .node-name').getBoundingClientRect(),pane=document.querySelector('.tree-scroll').getBoundingClientRect();return{visible:label.width>0&&label.left>=pane.left&&label.right<=pane.right};})()`,
  );

  assert(treeLabel.visible, 'Deep selected component label must be visible in the tree');

  const pickedId = await evaluate(
    `document.querySelector('.tree-row.selected [data-tree]').dataset.tree`,
  );

  const previousCapture = await evaluate(`document.querySelector('.footer-count').textContent`);
  await click('Capture');
  await harness.until(
    () =>
      evaluate(
        `document.querySelector('.footer-count').textContent!==${JSON.stringify(previousCapture)}&&!document.querySelector('[aria-label="Capture"]').disabled`,
      ),
    'Recapture failed',
  );
  assert.equal(
    await evaluate(`document.querySelector('.tree-row.selected [data-tree]').dataset.tree`),
    pickedId,
    'Recapture lost selected component',
  );
  await click('Explode view');
  await harness.until(
    () => evaluate(`document.querySelector('[aria-label="Assemble"]')!==null`),
    'Final explode failed',
  );
  await new Promise((r) => setTimeout(r, 250));

  const finalShot = await harness.send('Page.captureScreenshot', { format: 'png' }, session);

  await writeFile('artifacts/deep-hierarchy.png', Buffer.from(finalShot.data, 'base64'));
  console.log(
    'Passed: plane selection, original props, wrapper selection, focus, whole page, wrapper toggle, collapse, reset, page picker, recapture.',
  );
  await page.goto(fixture.url + '/deep?large');
  await page.locator('[data-region="card"]').first().waitFor();
  await harness.until(
    () =>
      evaluate(
        `document.querySelector('.capture-limit-banner')?.textContent.includes('Partial hierarchy')`,
      ),
    'Truncated captures must be visibly identified',
  );
  console.log('Passed: capture-limit warning is visible without opening details.');

  for (const projects of [40, 20]) {
    await page.goto(fixture.url + '/deep?projects=' + projects);
    await harness.until(
      () =>
        evaluate(
          `Number(document.querySelector('.tree-scroll')?.dataset.componentCount)===${105 + projects * 18}`,
        ),
      'Project tree did not finish capturing',
    );
    assert(
      await evaluate(`document.querySelectorAll('.tree-select').length < 100`),
      'Only the window of rows and focus targets should mount',
    );
    const width = await evaluate<number>(`document.querySelector('.tree-scroll').scrollWidth`);
    const widthAtBottom = await evaluate<number>(`(async () => {
      const box = document.querySelector('.tree-scroll');
      box.scrollTop = box.scrollHeight;
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const width = box.scrollWidth;
      box.scrollTop = 0;
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      return width;
    })()`);
    assert.equal(
      widthAtBottom,
      width,
      'The scrollbar must include deep rows before the user selects one',
    );
    await evaluate(`(() => {
      const input = document.querySelector('.tree-search input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Project 12');
      input.dispatchEvent(new Event('input', {bubbles: true}));
    })()`);
    const id = await harness.until(
      () =>
        evaluate<string>(`document.querySelector('[data-search-result]')?.dataset.searchResult`),
      'Missing search result for Project 12',
    );
    await evaluate(`document.querySelector('[data-search-result]').click()`);
    await harness.until(
      () =>
        evaluate(
          `document.querySelector('.tree-row.selected .tree-select')?.dataset.tree===${JSON.stringify(id)}`,
        ),
      'Search did not select the component',
    );
    const position = await evaluate<{
      labelVisible: boolean;
      bottomGap: number;
      width: number;
    }>(`(() => {
      const box = document.querySelector('.tree-scroll');
      const button = document.querySelector('.tree-row.selected .tree-select');
      const label = button.querySelector('.node-name').getBoundingClientRect();
      const pane = box.getBoundingClientRect();
      return {labelVisible:label.left >= pane.left - 1 && label.right <= pane.left + box.clientWidth + 1,
        bottomGap:pane.top + box.clientHeight - button.getBoundingClientRect().bottom, width:box.scrollWidth};
    })()`);
    assert(position.labelVisible, 'The selected component name must scroll into view horizontally');
    assert(Math.abs(position.bottomGap) <= 2, 'Scroll only far enough to reveal the selected row');
    assert.equal(position.width, width, 'Horizontal scrolling range must be stable across windows');
    const successor = await harness.until(
      () =>
        evaluate<string>(
          `document.querySelector('.tree-row.selected')?.nextElementSibling?.querySelector('.tree-select')?.dataset.tree`,
        ),
      'Selected row has no mounted successor',
    );
    await evaluate(`(async () => {
      document.querySelector('.tree-row.selected .tree-select').focus();
      document.querySelector('.tree-scroll').scrollTop = 0;
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    })()`);
    assert.equal(
      await evaluate(`document.activeElement.dataset.tree`),
      id,
      'Scrolling a focused row offscreen must preserve focus',
    );
    await evaluate(
      `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`,
    );
    await harness.until(
      () =>
        evaluate(
          `document.activeElement.matches('.tree-select[aria-selected="true"]') && document.activeElement.dataset.tree===${JSON.stringify(successor)} && document.querySelector('.tree-scroll').scrollTop>0`,
        ),
      'Arrow Down must navigate from the offscreen row and reveal its successor',
    );
  }
} finally {
  await harness.close();
  await fixture.close();
}

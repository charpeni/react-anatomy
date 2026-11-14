import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from './browser-options.ts';
import { startFixtureServer } from './fixture-server.ts';
import { pageAgent } from '../src/inspector/page-agent.ts';
import { makeSnapshotRenderer } from '../src/inspector/snapshot.ts';
import { makeLayerHierarchy } from '../src/inspector/layers.ts';
import { makeScene } from '../src/inspector/scene.ts';
import { launchExtension, openDevtoolsPanel } from './chrome-harness.ts';
import type {
  CaptureBudget,
  Snapshot,
  PageRequests,
  PageResponses,
  SearchMatch,
} from '../src/inspector/types.ts';

const fixture = await startFixtureServer();
const browser = await chromium.launch({ headless: true, ...browserOptions() });

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const partition = await page.evaluate(`(() => {
    const renderer = (${makeSnapshotRenderer.toString()})({
      html: '<div data-anatomy-host="parent"><section data-anatomy-host="child"><p>Child supplied by another plane</p></section><p>Parent content</p></div>',
      hostRects: { parent: { x: 0, y: 0, w: 100, h: 100 }, child: { x: 0, y: 0, w: 50, h: 50 } }
    });
    return renderer({ id: 'parent', hosts: ['parent'], frame: { x: 0, y: 0, w: 100, h: 100 } },
      [{ id: 'child', hosts: ['child'], frame: { x: 0, y: 0, w: 50, h: 50 } }]);
  })()`);
  assert(typeof partition === 'string');
  assert(partition.includes('Parent content'));
  assert(partition.includes('data-anatomy-host="child"'));
  assert(
    !partition.includes('Child supplied by another plane'),
    'Parent planes must not duplicate hidden child subtrees',
  );
  await page.goto(fixture.url + '/deep?large');
  await page.locator('[data-region="details"]').waitFor();
  const capture: (request: { action: 'capture' } & CaptureBudget) => Snapshot = pageAgent;
  const snapshot = await page.evaluate(capture, { action: 'capture' as const });
  assert.equal(snapshot.nodes.length, 2000);
  assert(
    snapshot.html?.includes('Project 0'),
    'Visible card text must survive a large offscreen list',
  );
  const details = await page.evaluate(
    () =>
      [...window.__REACT_ANATOMY_INSPECTOR_V1__!.elements].find(([, hosts]) =>
        hosts.some((el) => el.getAttribute('data-region') === 'details'),
      )?.[0],
  );
  assert(details, 'A large early branch must not omit the later Activity region from the overview');
  console.log('Passed: a capped overview includes sibling layout regions.');

  const list = await page.evaluate(
    () =>
      [...window.__REACT_ANATOMY_INSPECTOR_V1__!.elements].find(([, hosts]) =>
        hosts.some((el) => el.getAttribute('data-region') === 'list'),
      )?.[0],
  );
  assert(list);
  const focusedList = await page.evaluate(capture, { action: 'capture' as const, scopeId: list });
  assert(
    focusedList.html?.includes('Project 0'),
    'Focusing a long list must retain visible card contents, not spend the visual budget on offscreen containers',
  );
  assert(focusedList.nodes[0].bounds!.h > 20000, 'The fixture must exceed the page viewport');
  assert(
    focusedList.nodes[0].frame!.h <= 900,
    'Focus must fit the visible composition instead of shrinking a full scrolling list into the viewer',
  );
  const focusedScene = makeScene(makeLayerHierarchy(focusedList.nodes), { focused: true });
  const focusedText = await page.evaluate(`(() => {
      const render = (${makeSnapshotRenderer.toString()})(${JSON.stringify(focusedList)});
      const planes = ${JSON.stringify(focusedScene.layers)};
      const composition = document.createElement('div');
      for (const plane of planes) {
        const texture = document.createElement('div');
        texture.innerHTML = render(
          plane,
          planes.filter((child) => plane.sceneChildren.includes(child.id)),
        );
        composition.appendChild(texture);
      }
      return composition.textContent;
    })()`);
  assert(typeof focusedText === 'string');
  assert(focusedText.includes('Project 0'), 'Focused planes must retain the captured UI');
  assert(focusedText.includes('A distinct React component'));
  assert(!focusedList.visualLimited, 'Offscreen rows must not exhaust the focused visual budget');

  const visibleTitle = await page.evaluate(async () => {
    scrollTo(0, 6000);
    await new Promise(requestAnimationFrame);
    return [...document.querySelectorAll('[data-region="card"]')]
      .find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight;
      })
      ?.querySelector('h3')?.textContent;
  });
  assert(visibleTitle && visibleTitle !== 'Project 0');
  const scrolledList = await page.evaluate(capture, { action: 'capture' as const, scopeId: list });
  assert(
    scrolledList.html?.includes(visibleTitle),
    'Focusing a scrolled list must preserve the section currently on screen',
  );
  assert(scrolledList.nodes[0].frame!.y >= 0);
  assert(scrolledList.nodes[0].frame!.h <= 900);
  assert(!scrolledList.visualLimited);
  await page.evaluate(async () => {
    scrollTo(0, 0);
    await new Promise(requestAnimationFrame);
  });
  console.log('Passed: focusing a long list preserves visible UI and readable framing.');

  const scoped = await page.evaluate(capture, { action: 'capture' as const, scopeId: details });
  assert.equal(scoped.scope?.id, details);
  assert(scoped.nodes.length < 30, 'Focus must capture only the selected subtree');
  assert(scoped.scope!.path.length > 1, 'Focus needs a path back to the overview');
  assert(scoped.html?.includes('Three projects updated'));
  assert(!scoped.html?.includes('Project 159'), 'Focused snapshots must not copy other regions');

  const search: (
    request: { action: 'search' } & PageRequests['search'],
  ) => PageResponses['search'] = pageAgent;
  let cursor: string | undefined;
  const matches: SearchMatch[] = [];
  do {
    const result = await page.evaluate(search, {
      action: 'search' as const,
      query: 'Project 159',
      cursor,
    });
    matches.push(...result.matches);
    cursor = result.cursor || undefined;
    assert.equal(result.limited, false);
  } while (cursor);
  assert(matches.length > 0, 'Search must discover components outside the active snapshot');
  const card = await page.evaluate(capture, { action: 'capture' as const, scopeId: matches[0].id });
  assert(card.nodes.length < 20);
  assert(card.html?.includes('Project 159'));
  assert(
    card.nodes[0].frame,
    'Focus must reconstruct a mounted component even outside the page viewport',
  );
  const scopedSearch = await page.evaluate(search, {
    action: 'search' as const,
    query: 'Project 159',
    scopeId: details,
  });
  assert.equal(
    scopedSearch.matches.length,
    0,
    'Subtree search must not leak results from siblings',
  );
  assert.equal(scopedSearch.cursor, null);
  console.log('Passed: fresh subtree capture, breadcrumbs, and search beyond captured components.');

  const themedPage = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  await themedPage.goto(fixture.url + '/deep?projects=60');
  await themedPage.locator('[data-region="card"]').last().waitFor();
  await themedPage.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `:root { --capture-accent:#254edb; ${Array.from({ length: 5000 }, (_, i) => `--theme-${i}:${i}`).join(';')} }
      [data-region="list"]{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}
      [data-region="list"]>h2{grid-column:1/-1}
      article[data-region="card"]{height:70px;padding:4px;margin:0;overflow:hidden}
      article h3{font-size:10px;line-height:12px;margin:0;color:var(--capture-accent)}
      article p{font-size:8px;line-height:10px;margin:3px 0}
      [data-region="badge"]{font-size:8px;line-height:10px;padding:1px}`;
    document.head.appendChild(style);
  });
  assert(
    await themedPage
      .locator('[data-region="card"]')
      .last()
      .evaluate((element) => element.getBoundingClientRect().bottom < innerHeight),
    'All themed cards must be visible to exercise visual capture rather than offscreen culling',
  );
  await themedPage.evaluate(capture, { action: 'capture' as const });
  const themedList = await themedPage.evaluate(
    () =>
      [...window.__REACT_ANATOMY_INSPECTOR_V1__!.elements].find(([, hosts]) =>
        hosts.some((el) => el.getAttribute('data-region') === 'list'),
      )?.[0],
  );
  assert(themedList);
  const themed = await themedPage.evaluate(capture, {
    action: 'capture' as const,
    scopeId: themedList,
  });
  assert(
    themed.html?.includes('Project 59'),
    'A large CSS theme must not exhaust capture before visible card text is copied',
  );
  assert(!themed.visualLimited);
  const titleColor = await themedPage.evaluate((html) => {
    const template = document.createElement('template');
    template.innerHTML = html!;
    return template.content.querySelector('h3')?.style.color;
  }, themed.html);
  assert.equal(
    titleColor,
    'rgb(37, 78, 219)',
    'Custom-property values must remain resolved in the captured UI',
  );

  await themedPage.evaluate(() => {
    const hidden = document.createElement('div');
    hidden.style.display = 'none';
    for (let i = 0; i < 1500; i++) {
      const item = document.createElement('span');
      item.textContent = `Hidden menu item ${i}`;
      hidden.appendChild(item);
    }
    document.querySelector('[data-region="list"]')!.prepend(hidden);
  });
  const hiddenMenu = await themedPage.evaluate(capture, {
    action: 'capture' as const,
    scopeId: themedList,
  });
  assert(
    hiddenMenu.html?.includes('Project 59'),
    'Hidden menus must not consume the budget needed for visible UI',
  );
  assert(!hiddenMenu.html?.includes('Hidden menu item'));
  assert(!hiddenMenu.visualLimited);
  await themedPage.evaluate(() => {
    for (const card of document.querySelectorAll('[data-region="card"]')) {
      for (let i = 0; i < 6; i++) {
        const decoration = document.createElement('span');
        decoration.textContent = '·';
        card.appendChild(decoration);
      }
    }
  });
  const dense = await themedPage.evaluate(capture, {
    action: 'capture' as const,
    scopeId: themedList,
  });
  assert(dense.visualLimited, 'The dense fixture must exercise the visual budget');
  assert(
    dense.html?.includes('Project 0'),
    'Budget-limited captures must keep complete visible content instead of only empty containers',
  );
  assert(dense.html?.includes('A distinct React component'));
  await themedPage.close();
  console.log(
    'Passed: large CSS themes and hidden menus preserve visible text and resolved styles.',
  );

  const start: (
    request: { action: 'capture-start' } & CaptureBudget,
  ) => PageResponses['capture-start'] = pageAgent;
  const step: (request: {
    action: 'capture-step';
    token: string;
  }) => PageResponses['capture-step'] = pageAgent;
  const cancel: (request: {
    action: 'capture-cancel';
    token: string;
  }) => PageResponses['capture-cancel'] = pageAgent;
  const cancelled = await page.evaluate(start, { action: 'capture-start' as const });
  await page.evaluate(step, { action: 'capture-step' as const, token: cancelled.token });
  await page.evaluate(cancel, { action: 'capture-cancel' as const, token: cancelled.token });
  await assert.rejects(
    page.evaluate(step, { action: 'capture-step' as const, token: cancelled.token }),
    /cancelled/,
  );
  const job = await page.evaluate(start, {
    action: 'capture-start' as const,
    maxComponents: 10000,
  });
  let steps = 0;
  let result;
  do {
    result = await page.evaluate(step, { action: 'capture-step' as const, token: job.token });
    steps++;
  } while (!result.done);
  assert(steps > 1, 'Large captures must yield between steps');
  assert.equal(result.snapshot.limits?.components, 5000, '5,000 is the maximum per scope');
  assert.equal(result.snapshot.nodes.length, 2985);
  assert(result.snapshot.elementCount! <= 3000);
  console.log('Passed: cancellable stepped capture and independent component/visual budgets.', {
    steps,
    components: result.snapshot.nodes.length,
    elements: result.snapshot.elementCount,
    workMs: result.snapshot.captureMs,
    htmlBytes: result.snapshot.html?.length,
  });

  const harness = await launchExtension();
  try {
    const source = harness.context.pages()[0];
    await source.goto(fixture.url + '/deep?projects=320');
    await source.locator('[data-region="details"]').waitFor();
    const { session, panelSession } = await openDevtoolsPanel(harness);
    await harness.send(
      'Emulation.setDeviceMetricsOverride',
      { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
      session,
    );
    const run = <T = unknown>(expression: string) => harness.evaluate<T>(expression, panelSession);
    const ready = () =>
      run<boolean>(
        `!!document.querySelector('.tree-scroll')&&!document.querySelector('[aria-label="Capture"]').disabled`,
      );
    const count = () =>
      run<number>(`Number(document.querySelector('.tree-scroll')?.dataset.componentCount)`);
    const click = (label: string) =>
      run(
        `Array.from(document.querySelectorAll('button')).find(b=>(b.getAttribute('aria-label')||b.textContent.trim())===${JSON.stringify(label)})?.click()`,
      );
    const find = (query: string) =>
      run(
        `(()=>{const input=document.querySelector('[aria-label="Find a component"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(query)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    await harness.until(ready, 'Overview did not finish');
    assert.equal(await count(), 2000);
    assert(
      await run<boolean>(`document.querySelectorAll('.tree-select').length<120`),
      'Large tree must render a bounded window',
    );
    await mkdir('artifacts/scoped-capture', { recursive: true });
    await click('Explode view');
    await harness.until(
      () => run(`!!document.querySelector('[aria-label="Assemble"]')`),
      'Overview did not explode',
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    const overviewShot = await harness.send('Page.captureScreenshot', { format: 'png' }, session);
    await writeFile(
      'artifacts/scoped-capture/overview.png',
      Buffer.from(overviewShot.data, 'base64'),
    );

    const beforeListPick = await run<string>(
      `document.querySelector('.tree-row.selected [data-tree]').dataset.tree`,
    );
    await click('Pick on page');
    await source.locator('[data-region="list"] > h2').click();
    await harness.until(
      () =>
        run(
          `document.querySelector('.tree-row.selected [data-tree]')?.dataset.tree!==${JSON.stringify(beforeListPick)}`,
        ),
      'The list did not become inspectable',
    );
    await click('Focus subtree');
    await harness.until(
      async () => (await ready()) && (await run(`!!document.querySelector('.focus-navigation')`)),
      'The list did not finish its focused capture',
    );
    assert(
      await run<boolean>(
        `Array.from(document.querySelectorAll('.plane-content')).some(p=>p.textContent.includes('Project 0')&&p.textContent.includes('A distinct React component'))`,
      ),
      'Focusing a large list must show the card UI inside its planes',
    );
    assert(await run<boolean>(`parseFloat(document.querySelector('.scene').style.height)<=1000`));
    await new Promise((resolve) => setTimeout(resolve, 350));
    const listShot = await harness.send('Page.captureScreenshot', { format: 'png' }, session);
    await writeFile(
      'artifacts/scoped-capture/focused-list.png',
      Buffer.from(listShot.data, 'base64'),
    );
    await click('Whole page');
    await harness.until(
      async () => (await ready()) && !(await run(`!!document.querySelector('.focus-navigation')`)),
      'The overview did not return after focusing the list',
    );

    await find('Project 319');
    await harness.until(
      () =>
        run(
          `document.querySelector('[data-search-result]')?.textContent.includes('Focus to load')`,
        ),
      'Search did not find an uncaptured component',
    );
    await run(`document.querySelector('[data-search-result]').click()`);
    await harness.until(
      async () => (await ready()) && (await count()) < 20,
      'Search result did not capture its own subtree',
    );
    assert(await run<boolean>(`document.querySelector('.focus-navigation')!==null`));
    assert(
      await run<boolean>(`document.querySelectorAll('[data-plane]').length>0`),
      'Offscreen search results need a visible scoped scene',
    );
    const focusShot = await harness.send('Page.captureScreenshot', { format: 'png' }, session);
    await writeFile('artifacts/scoped-capture/focused.png', Buffer.from(focusShot.data, 'base64'));
    await find('Project 0');
    await harness.until(
      () =>
        run(
          `document.querySelector('[role="tree"] [role="status"]')?.textContent.includes('No matching components')`,
        ),
      'Focused search escaped its subtree',
    );
    await click('Whole page');
    await harness.until(
      async () => (await ready()) && (await count()) === 2000,
      'Whole page did not restore its budget',
    );
    await click('Capture more');
    await harness.until(
      async () => (await ready()) && (await count()) === 5000,
      'Expanded capture did not reach its bounded maximum',
    );
    assert(await run<boolean>(`document.querySelectorAll('.tree-select').length<120`));
    assert(await run<boolean>(`!document.querySelector('[aria-label="Capture more"]')`));
    await run(
      `document.querySelector('.tree-select').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`,
    );
    await harness.until(
      () =>
        run(
          `document.activeElement?.classList.contains('tree-select')&&document.querySelector('.tree-scroll').scrollTop>1000`,
        ),
      'Keyboard navigation did not reach an unmounted row',
    );
    await click('Pick on page');
    await source.locator('[data-region="badge"]').last().click();
    await harness.until(
      async () => (await ready()) && (await count()) < 20,
      'Picking outside the overview did not capture that component',
    );
    console.log(
      'Passed: real DevTools scoped search/focus, 5,000 limit, virtual tree, keyboard navigation, and uncaptured page picking.',
    );
  } finally {
    await harness.close();
  }
} finally {
  await browser.close();
  await fixture.close();
}

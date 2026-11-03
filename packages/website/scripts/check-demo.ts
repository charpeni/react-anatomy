import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page, type Locator } from 'playwright';
import { browserOptions } from '../../extension/scripts/browser-options.ts';

const directory = fileURLToPath(new URL('../dist/', import.meta.url));
const shots = fileURLToPath(new URL('../artifacts/demo-check/', import.meta.url));

await mkdir(shots, { recursive: true });

const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const file = resolve(directory, `.${path.endsWith('/') ? path + 'index.html' : path}`);

  if (!file.startsWith(directory)) {
    response.writeHead(403).end();

    return;
  }

  try {
    response
      .writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' })
      .end(await readFile(file));
  } catch {
    response.writeHead(404).end('Not found');
  }
});

await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));

const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const browser = await chromium.launch({ headless: true, ...browserOptions() });
const errors: string[] = [];
const failures: string[] = [];

const observe = (page: Page) => {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failures.push(response.url());
    }
  });
};

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function assertPageScrollsOver(page: Page, target: Locator) {
  await target.hover();

  const readInnerState = (element: Element) => {
    const ancestors = [];

    for (let node: Element | null = element; node; node = node.parentElement) {
      ancestors.push([node.scrollLeft, node.scrollTop]);
    }

    return {
      ancestors,
      zoom: element.ownerDocument.querySelector('.zoom-value')?.textContent,
    };
  };

  const innerBefore = await target.evaluate(readInnerState);
  const pageBefore = await page.evaluate(() => scrollY);

  await page.mouse.wheel(0, 120);
  await page.waitForFunction((before) => scrollY > before + 100, pageBefore);
  assert.deepEqual(
    await target.evaluate(readInnerState),
    innerBefore,
    'Wheel scrolling must not zoom or scroll inside the demo',
  );
  assert(Math.abs((await page.evaluate(() => scrollY)) - pageBefore - 120) < 2);
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });

  observe(page);
  await page.goto(base);
  await page.locator('#demo').scrollIntoViewIfNeeded();

  const source = page.frameLocator('#anatomy-source');
  const panel = page.frameLocator('#anatomy-panel');

  await source.locator('.project-card').first().waitFor();
  await page.waitForFunction(
    () => document.querySelector<HTMLButtonElement>('[data-view="anatomy"]')?.disabled === false,
  );
  await assertPageScrollsOver(page, source.locator('.project-card').first());
  assert.equal(await page.locator('#demo').getAttribute('data-guide'), 'start');
  await page.locator('#demo').screenshot({ path: `${shots}/desktop-start.png` });
  assert.equal(await page.locator('video').count(), 0);
  assert.equal(
    await page.locator('#anatomy-panel').getAttribute('src'),
    null,
    'Inspector should load on demand',
  );
  await source.getByRole('button', { name: 'Complete task', exact: true }).first().click();
  await page.locator('[data-step="props"]').click();
  await panel.locator('[data-prop-path="props.project.progress"]').waitFor();
  assert.equal(await page.locator('.demo-start-hint').isVisible(), false);
  assert.match(await panel.locator('[data-prop-path="props.project.progress"]').innerText(), /80/);
  assert.equal(await panel.locator('.tree-select').count(), 24);
  await panel.locator('[data-prop-path="props.project.settings"] > summary').click();
  await panel.locator('[data-prop-path="props.project.settings.release"] > summary').click();
  await panel.locator('[data-prop-path="props.project.settings.release.version"]').waitFor();
  assert.match(
    await panel.locator('[data-prop-path="props.project.settings.release.version"]').innerText(),
    /2\.4\.0/,
  );

  for (const selector of ['.stage', '.tree-scroll', '.inspector-scroll']) {
    await assertPageScrollsOver(page, panel.locator(selector));
  }

  const wheelZoom = await panel.locator('.zoom-value').innerText();
  const scrollBeforeLines = await page.evaluate(() => scrollY);

  await panel.locator('.stage').dispatchEvent('wheel', { deltaMode: 1, deltaY: -3 });
  assert.equal(await page.evaluate(() => scrollY), scrollBeforeLines - 48);

  const scrollBeforePinch = await page.evaluate(() => scrollY);

  await panel.locator('.stage').dispatchEvent('wheel', { deltaY: 80, ctrlKey: true });
  assert.equal(await page.evaluate(() => scrollY), scrollBeforePinch);
  assert.equal(await panel.locator('.zoom-value').innerText(), wheelZoom);

  const zoomBefore = await panel.locator('.zoom-value').innerText();

  await panel.getByRole('button', { name: 'Zoom in', exact: true }).click();
  assert.notEqual(await panel.locator('.zoom-value').innerText(), zoomBefore);
  await panel.getByRole('button', { name: 'Reset zoom', exact: true }).click();
  await panel.getByRole('button', { name: 'Focus subtree', exact: true }).click();
  await panel.locator('.focus-navigation').waitFor();
  assert.equal(await panel.locator('[data-plane]').count(), 4);
  await page.locator('#demo').screenshot({ path: `${shots}/desktop-props.png` });
  await page.locator('[data-step="page"]').click();
  await source.getByRole('button', { name: 'Complete task', exact: true }).first().click();
  await page.locator('[data-step="props"]').click();
  await page.waitForFunction(() =>
    document
      .querySelector<HTMLIFrameElement>('#anatomy-panel')!
      .contentDocument!.querySelector('[data-prop-path="props.project.progress"]')
      ?.textContent.includes('88'),
  );
  await page.locator('[data-step="explode"]').click();
  await panel.getByRole('button', { name: 'Pick on page', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector<HTMLIFrameElement>('#anatomy-panel')!.hidden,
  );
  await source.getByRole('heading', { name: 'Design system', exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector<HTMLIFrameElement>('#anatomy-panel')!.hidden,
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector<HTMLIFrameElement>('#anatomy-panel')!
        .contentDocument!.querySelector('.tree-row.selected .node-name')?.textContent ===
      'ProjectCard',
  );
  await panel.getByRole('button', { name: 'Pick on page', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector<HTMLIFrameElement>('#anatomy-panel')!.hidden,
  );
  await source.locator('body').press('Escape');
  await page.waitForFunction(
    () => !document.querySelector<HTMLIFrameElement>('#anatomy-panel')!.hidden,
  );
  await page.getByRole('button', { name: 'Restart example' }).click();
  await source.locator('.project-card').first().waitFor();
  assert.equal(await page.locator('#anatomy-panel').getAttribute('src'), null);
  await assertPageScrollsOver(page, source.locator('.project-card').first());
  // Interrupt initial loading; returning to the page must not leave an overlay.
  await page.locator('[data-step="explode"]').click();
  await page.locator('[data-step="page"]').click();
  assert.equal(await page.locator('.demo-loading').isVisible(), false);
  await page.locator('[data-step="props"]').click();
  await panel.locator('[data-prop-path="props.project.progress"]').waitFor();
  assert.match(await panel.locator('[data-prop-path="props.project.progress"]').innerText(), /72/);
  await assertPageScrollsOver(page, panel.locator('.stage'));
  assert.doesNotMatch(await panel.locator('.stage-help').innerText(), /Scroll to zoom/);
  assert(await noOverflow(page));
  console.log(
    'Passed: live sample updates, real component capture, lazy loading, nested props, focus, recapture, picker/cancellation, restart, and interrupted navigation.',
  );

  for (const width of [390, 320]) {
    const mobile = await browser.newPage({
      viewport: { width, height: 844 },
      reducedMotion: 'reduce',
      hasTouch: true,
    });

    observe(mobile);
    await mobile.goto(base);
    await mobile.locator('#demo').scrollIntoViewIfNeeded();
    await mobile.frameLocator('#anatomy-source').locator('.project-card').first().waitFor();
    await mobile.waitForFunction(
      () => document.querySelector<HTMLButtonElement>('[data-view="anatomy"]')?.disabled === false,
    );
    await mobile.locator('[data-view="anatomy"]').waitFor({ state: 'visible' });
    assert.equal(
      await mobile
        .locator('[data-view="anatomy"]')
        .evaluate((element) => getComputedStyle(element, '::before').animationName),
      'none',
    );
    assert(await noOverflow(mobile));
    await mobile.locator('#demo').screenshot({ path: `${shots}/mobile-${width}-start.png` });
    await mobile.locator('[data-step="explode"]').click();

    const inspector = mobile.frameLocator('#anatomy-panel');

    await inspector.getByRole('button', { name: 'Assemble', exact: true }).waitFor();
    assert.equal(
      await inspector
        .getByRole('button', { name: 'Toggle component tree', exact: true })
        .getAttribute('aria-pressed'),
      'false',
    );
    assert.equal(
      await inspector
        .locator('.scene')
        .evaluate((element) => getComputedStyle(element).transitionDuration),
      '0s',
    );
    assert(await noOverflow(mobile));
    assert(
      await inspector.locator('html').evaluate((element) => element.scrollWidth <= innerWidth),
    );
    await mobile.locator('#demo').screenshot({ path: `${shots}/mobile-${width}-exploded.png` });
    await mobile.locator('[data-step="props"]').click();
    await inspector.locator('[data-prop-path="props.project.name"]').waitFor();
    await mobile.locator('#demo').screenshot({ path: `${shots}/mobile-${width}-props.png` });
    await mobile.close();
  }

  console.log('Passed: 390px/320px layouts, touch controls, mobile props, and reduced motion.');

  await page.reload();
  await page.waitForFunction(
    () => document.querySelector<HTMLButtonElement>('[data-step="explode"]')?.disabled === false,
  );
  await page.locator('[data-step="explode"]').focus();
  await page.locator('[data-step="explode"]').press('Enter');
  await panel.getByRole('button', { name: 'Assemble', exact: true }).waitFor();
  assert.equal(
    await panel
      .locator('.scene')
      .evaluate((element) => getComputedStyle(element).transitionDuration),
    '0s',
  );

  // Images stay on the current page while the viewer handles zoom and focus.
  await page.goto(base);

  const sketch = page.locator('.sketch a[data-image-viewer]');
  const viewer = page.getByRole('dialog', { name: 'Image viewer' });
  const closeViewer = page.getByRole('button', { name: 'Close image viewer' });
  const currentImage = page.locator(
    '.pswp__item[aria-hidden="false"] .pswp__img:not(.pswp__img--placeholder)',
  );
  const landingUrl = page.url();

  await sketch.focus();
  await sketch.press('Enter');
  await closeViewer.waitFor();
  await page.waitForFunction(() => !!document.activeElement?.closest('.pswp'));
  assert.equal(page.url(), landingUrl);
  assert.equal(await viewer.getAttribute('aria-modal'), 'true');
  assert.match((await currentImage.getAttribute('src')) ?? '', /page-composition\.svg$/);

  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => !!document.activeElement?.closest('.pswp')));
  }

  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Shift+Tab');
    assert(await page.evaluate(() => !!document.activeElement?.closest('.pswp')));
  }

  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() =>
    document
      .querySelector('.pswp__item[aria-hidden="false"] img:not(.pswp__img--placeholder)')
      ?.getAttribute('src')
      ?.endsWith('/composition-front.png'),
  );

  const fitWidth = (await currentImage.boundingBox())!.width;

  await page.getByRole('button', { name: 'Zoom image' }).click();
  await page.waitForFunction(
    (width) =>
      document
        .querySelector('.pswp__item[aria-hidden="false"] img:not(.pswp__img--placeholder)')!
        .getBoundingClientRect().width >
      width + 20,
    fitWidth,
  );
  await page.screenshot({ path: `${shots}/lightbox-desktop.png` });
  await page.keyboard.press('Escape');
  await viewer.waitFor({ state: 'detached' });
  assert.equal(page.url(), landingUrl);
  assert(await sketch.evaluate((element) => document.activeElement === element));
  assert.notEqual(await page.evaluate(() => document.documentElement.style.overflow), 'hidden');

  await sketch.click();
  await page.waitForFunction(() => !!document.activeElement?.closest('.pswp'));
  await page.mouse.click(10, 100);
  await viewer.waitFor({ state: 'detached' });

  const touch = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });

  observe(touch);
  await touch.goto(base);
  await touch.locator('.origin-compare a[data-image-viewer]').nth(1).tap();
  await touch.getByRole('dialog', { name: 'Image viewer' }).waitFor();
  await touch.waitForFunction(() => !!document.activeElement?.closest('.pswp'));
  assert(await noOverflow(touch));
  assert.equal(touch.url(), base + '/');
  await touch.screenshot({ path: `${shots}/lightbox-mobile.png` });
  await touch.getByRole('button', { name: 'Close image viewer' }).tap();
  await touch.locator('.pswp').waitFor({ state: 'detached' });
  await touch.close();
  console.log(
    'Passed: image viewer, unchanged URLs, zoom, gallery keys, focus, backdrop close, and touch.',
  );

  const docsWithScreenshots = [
    '/docs/',
    '/docs/understand/',
    '/docs/explain-a-change/',
    '/docs/explore/',
    '/docs/props/',
  ];

  for (const path of docsWithScreenshots) {
    await page.goto(base + path);

    const images = page.locator('main img');

    assert((await images.count()) > 0, `${path} has no documentation screenshots`);

    for (const img of await images.all()) {
      await img.scrollIntoViewIfNeeded();
      await page.waitForFunction(
        (src) =>
          [...document.images].some(
            (image) => image.src === src && image.complete && image.naturalWidth > 0,
          ),
        await img.getAttribute('src').then((src) => new URL(src ?? '', base).href),
      );

      const link = await img.locator('..').getAttribute('href');

      assert(link?.endsWith('.png'), 'Screenshots retain a full-size fallback link');

      const trigger = img.locator('..');
      const url = page.url();

      await trigger.click();
      await page.getByRole('dialog', { name: 'Image viewer' }).waitFor();
      await page.waitForFunction(() => !!document.activeElement?.closest('.pswp'));
      assert.equal(page.url(), url, 'Documentation images must not navigate away');
      await page.getByRole('button', { name: 'Close image viewer' }).click();
      await page.locator('.pswp').waitFor({ state: 'detached' });
      assert(await trigger.evaluate((element) => document.activeElement === element));
    }
  }

  // Every internal link on the landing page and docs must resolve, including fragments.
  const checked = new Set();

  for (const path of [
    '/',
    ...docsWithScreenshots,
    '/docs/generated-code/',
    '/docs/limitations/',
    '/docs/compatibility/',
    '/privacy/',
  ]) {
    await page.goto(base + path);

    const links = await page.$$eval('a[href^="/"]', (anchors) =>
      anchors.map((a) => (a as HTMLAnchorElement).href),
    );

    for (const href of links) {
      const url = new URL(href);
      const key = url.pathname + url.hash;

      if (checked.has(key)) {
        continue;
      }

      checked.add(key);

      const response = await page.request.get(base + url.pathname);

      assert(response.ok(), `${path} links to missing ${url.pathname}`);

      if (url.hash) {
        const html = await response.text();

        assert(
          html.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`),
          `${path} links to missing ${key}`,
        );
      }
    }
  }

  await page.goto(base + '/docs/props/');
  await page.getByRole('button', { name: /Search/ }).click();
  await page.getByPlaceholder('Search', { exact: true }).fill('props');
  await page.locator('.pagefind-ui__result').first().waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(
    'Passed: keyboard motion, documentation image viewers, internal links, search, and no browser or asset errors.',
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}

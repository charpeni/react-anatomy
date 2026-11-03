import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';

export async function checkNotFound(browser: Browser, base: string, shots: string) {
  const missing = `${base}/this-page-does-not-exist/`;
  const errors: string[] = [];

  const open = async (
    width: number,
    options: { reducedMotion?: 'reduce'; javaScriptEnabled?: boolean; isMobile?: boolean } = {},
  ) => {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      hasTouch: options.isMobile,
      ...options,
    });

    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400 && !(response.status() === 404 && response.url() === missing)) {
        errors.push(`${response.status()}: ${response.url()}`);
      }
    });

    assert.equal((await page.goto(missing))?.status(), 404);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex');
    assert.equal(await page.locator('h1').textContent(), 'This page isn’t here.');

    if (options.javaScriptEnabled !== false) {
      await page.locator('.not-found-stage.is-interactive').waitFor();
    }

    return page;
  };

  const settle = (page: Page) =>
    page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
  const transform = (page: Page) =>
    page.locator('.not-found-scene').evaluate((element) => getComputedStyle(element).transform);
  const readable = async (page: Page) => {
    const problems = await page.evaluate(() => {
      const problems: string[] = [];

      if (document.documentElement.scrollWidth > innerWidth) {
        problems.push('Horizontal overflow');
      }

      for (const element of document.querySelectorAll(
        '.layer > *, .site-header a, .not-found-hint',
      )) {
        const rect = element.getBoundingClientRect();

        if (rect.width && (rect.left < -1 || rect.right > innerWidth + 1)) {
          problems.push(`Clipped ${element.textContent?.trim()}`);
        }
      }

      for (const link of document.querySelectorAll('main a')) {
        const rect = link.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);

        if (!link.contains(hit)) {
          problems.push(`Obscured ${link.textContent?.trim()}`);
        }
      }

      return problems;
    });

    assert.deepEqual(problems, []);
  };

  const desktop = await open(1440);

  try {
    // Step the entrance before cancelling it with a real keyboard interaction.
    await desktop.evaluate(() => {
      for (const animation of document.getAnimations()) {
        animation.pause();
        animation.currentTime = 370;
      }
    });
    await desktop.screenshot({ path: `${shots}/404-entrance.png` });
    await desktop.keyboard.press('Tab');
    await desktop.keyboard.press('Tab');
    assert(
      await desktop
        .locator('.not-found-stage')
        .evaluate((stage) => stage === document.activeElement),
    );
    assert(await desktop.locator('.hint-keys').isVisible());
    assert.equal(await desktop.evaluate(() => document.getAnimations().length), 0);

    const beforeKeyboard = await transform(desktop);

    await desktop.keyboard.press('ArrowRight');
    assert.notEqual(await transform(desktop), beforeKeyboard);
    await desktop.keyboard.press('Tab');
    assert(
      await desktop
        .getByRole('link', { name: /Back to React Anatomy/ })
        .evaluate((a) => a === document.activeElement),
    );
    await desktop.keyboard.press('Tab');
    assert(
      await desktop
        .getByRole('link', { name: /Read the docs/ })
        .evaluate((a) => a === document.activeElement),
    );
    await desktop.screenshot({ path: `${shots}/404-link-focus.png` });

    await desktop.reload();
    await settle(desktop);
    await readable(desktop);
    await desktop.screenshot({ path: `${shots}/404-desktop.png` });

    const stage = await desktop.locator('.not-found-stage').boundingBox();

    assert(stage);

    const beforeDrag = await transform(desktop);

    await desktop.mouse.move(stage.x + stage.width - 80, stage.y + 70);
    await desktop.mouse.down();
    await desktop.mouse.move(stage.x + stage.width - 250, stage.y + 160, { steps: 8 });
    await desktop.mouse.up();
    assert.notEqual(await transform(desktop), beforeDrag);
    await readable(desktop);

    // Release outside the stage: pointer capture must end, without following later moves.
    await desktop.mouse.move(stage.x + stage.width - 80, stage.y + 70);
    await desktop.mouse.down();
    await desktop.mouse.move(0, 0, { steps: 8 });
    await desktop.mouse.up();

    const released = await transform(desktop);

    await desktop.mouse.move(stage.x + stage.width / 2, stage.y + 100);
    assert.equal(await transform(desktop), released);
    assert(!(await desktop.locator('.not-found-stage.is-dragging').count()));
    await readable(desktop);
    await desktop.screenshot({ path: `${shots}/404-rotated.png` });
    await desktop.getByRole('link', { name: /Read the docs/ }).click();
    await desktop.waitForURL(`${base}/docs/`);
  } finally {
    await desktop.close();
  }

  for (const width of [390, 320]) {
    const page = await open(width, { isMobile: true });

    try {
      await settle(page);
      await readable(page);
      await page.screenshot({ path: `${shots}/404-${width}.png` });

      const stage = await page.locator('.not-found-stage').boundingBox();

      assert(stage);

      const session = await page.context().newCDPSession(page);
      const beforeDrag = await transform(page);
      const startX = stage.x + stage.width - 30;
      const y = stage.y + stage.height - 25;

      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: startX, y, id: 1 }],
      });

      for (let step = 1; step <= 8; step++) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: startX - step * 12, y, id: 1 }],
        });
        await page.waitForTimeout(50);
      }

      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.notEqual(await transform(page), beforeDrag);
      await readable(page);
      await page.screenshot({ path: `${shots}/404-${width}-rotated.png` });
      await page.getByRole('link', { name: /Read the docs/ }).tap();
      await page.waitForURL(`${base}/docs/`, { timeout: 5000 });
    } finally {
      await page.close();
    }
  }

  for (const options of [{ reducedMotion: 'reduce' } as const, { javaScriptEnabled: false }]) {
    const page = await open(390, options);

    try {
      assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
      await readable(page);
      await page.screenshot({
        path: `${shots}/404-${'reducedMotion' in options ? 'reduced-motion' : 'no-js'}.png`,
      });

      if (options.javaScriptEnabled === false) {
        assert.equal(await page.locator('.not-found-stage').getAttribute('tabindex'), null);
        assert(!(await page.locator('.not-found-hint').isVisible()));
      }

      await page.getByRole('link', { name: /Back to React Anatomy/ }).click();
      await page.waitForURL(base + '/');
    } finally {
      await page.close();
    }
  }

  assert.deepEqual(errors, []);
  console.log(
    'Passed: 404 status, exploded layout, rotation, keyboard, touch, navigation, reduced motion, and no-JS fallback.',
  );
}

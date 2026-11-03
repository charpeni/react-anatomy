import assert from 'node:assert/strict';
import type { Browser, BrowserContextOptions, Page } from 'playwright';

export async function checkDemoIntroduction(browser: Browser, base: string, shots: string) {
  const errors: string[] = [];
  const open = async (options: BrowserContextOptions = {}) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ...options });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(
      () => !document.querySelector<HTMLButtonElement>('[data-view="anatomy"]')!.disabled,
    );
    return page;
  };
  const phase = (page: Page) => page.locator('#demo').getAttribute('data-introduction');
  const finished = (page: Page) =>
    page.waitForFunction(
      () => document.querySelector('#demo')?.getAttribute('data-introduction') === 'done',
    );
  const unlocked = async (page: Page) => {
    assert.notEqual(await page.evaluate(() => document.documentElement.style.overflow), 'hidden');
    assert.equal(await page.locator('.demo-intro-cursor').isVisible(), false);
    assert.equal(await page.locator('.demo-intro-skip').isVisible(), false);
  };
  const scrollToDemo = async (page: Page) => {
    const top = await page
      .locator('#demo')
      .evaluate((element) => element.getBoundingClientRect().top);
    await page.mouse.move(10, 400);
    await page.mouse.wheel(0, top + 20);
  };
  const playing = (page: Page) =>
    page.waitForFunction(
      () => document.querySelector('#demo')?.getAttribute('data-introduction') === 'playing',
    );

  const desktop = await open();
  try {
    const originalLeft = await desktop
      .locator('#demo')
      .evaluate((element) => element.getBoundingClientRect().left);
    await scrollToDemo(desktop);
    await playing(desktop);
    const held = await desktop.evaluate(() => scrollY);
    assert.equal(await desktop.evaluate(() => document.documentElement.style.overflow), 'hidden');
    assert.equal(
      await desktop.locator('#demo').evaluate((element) => element.getBoundingClientRect().left),
      originalLeft,
    );
    await desktop.waitForTimeout(200);
    await desktop.screenshot({ path: `${shots}/intro-cursor.png` });
    await desktop.mouse.wheel(0, 180);
    await desktop
      .frameLocator('#anatomy-source')
      .locator('.project-card')
      .first()
      .dispatchEvent('wheel', { deltaY: 180 });
    await desktop.waitForTimeout(80);
    assert.equal(
      await desktop.evaluate(() => scrollY),
      held,
      'Both page and iframe wheels must pause during the introduction',
    );
    await finished(desktop);
    await unlocked(desktop);
    assert.equal(
      await desktop.locator('[data-view="anatomy"]').getAttribute('aria-pressed'),
      'true',
    );
    assert(
      Number(
        await desktop
          .frameLocator('#anatomy-panel')
          .getByRole('slider', { name: 'Layer separation' })
          .inputValue(),
      ) > 0,
    );
    await desktop.screenshot({ path: `${shots}/intro-exploded.png` });
    await desktop.mouse.wheel(0, 220);
    await desktop.waitForFunction((y) => scrollY > y + 100, held);

    await desktop.reload();
    await desktop.waitForFunction(
      () => !document.querySelector<HTMLButtonElement>('[data-view="anatomy"]')!.disabled,
    );
    await scrollToDemo(desktop);
    assert.equal(await phase(desktop), 'done');
    assert.equal(
      await desktop.locator('#anatomy-panel').getAttribute('src'),
      null,
      'Reloading the same session must not replay the introduction',
    );
    await unlocked(desktop);
  } finally {
    await desktop.close();
  }

  for (const method of ['Escape', 'skip', 'reverse'] as const) {
    const page = await open();
    try {
      await scrollToDemo(page);
      await playing(page);
      if (method === 'Escape') {
        await page.keyboard.press('Escape');
      } else if (method === 'skip') {
        await page.getByRole('button', { name: 'Skip intro' }).click();
      } else {
        await page.mouse.wheel(0, -80);
      }
      await finished(page);
      await unlocked(page);
      await page.waitForTimeout(1100);
      assert.equal(
        await page.locator('[data-view="anatomy"]').getAttribute('aria-pressed'),
        'false',
        'A cancelled cursor must never click later',
      );
      await page.locator('[data-view="anatomy"]').click();
      await page.frameLocator('#anatomy-panel').locator('.tree-select').first().waitFor();
      assert.equal(
        await page.locator('[data-view="anatomy"]').getAttribute('aria-pressed'),
        'true',
      );
    } finally {
      await page.close();
    }
  }

  const slow = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let release!: () => void;
  const network = new Promise<void>((resolve) => {
    release = resolve;
  });
  await slow.route('**/interactive/panel.html', async (route) => {
    await network;
    await route.continue();
  });
  try {
    await slow.goto(base);
    await slow.waitForFunction(
      () => !document.querySelector<HTMLButtonElement>('[data-view="anatomy"]')!.disabled,
    );
    await scrollToDemo(slow);
    await playing(slow);
    await finished(slow);
    await unlocked(slow);
    release();
    await slow.waitForFunction(
      () =>
        !!document
          .querySelector<HTMLIFrameElement>('#anatomy-panel')!
          .contentDocument?.querySelector('.tree-select'),
    );
    assert.equal(
      await slow.locator('[data-view="anatomy"]').getAttribute('aria-pressed'),
      'false',
      'Late loading must not reopen a cancelled introduction',
    );
  } finally {
    release();
    await slow.close();
  }

  const reduced = await open({ reducedMotion: 'reduce' });
  try {
    await scrollToDemo(reduced);
    await unlocked(reduced);
    await finished(reduced);
    assert.equal(
      await reduced.locator('[data-view="anatomy"]').getAttribute('aria-pressed'),
      'true',
    );
    await unlocked(reduced);
  } finally {
    await reduced.close();
  }

  const keyboard = await open();
  try {
    await keyboard.keyboard.press('PageDown');
    await finished(keyboard);
    await unlocked(keyboard);
    assert.equal(await keyboard.locator('#anatomy-panel').getAttribute('src'), null);
  } finally {
    await keyboard.close();
  }

  for (const width of [390, 320]) {
    const mobile = await open({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    try {
      // Start the gesture over the sample iframe, not in the outer page's margin.
      await mobile.locator('#demo').evaluate((element) =>
        window.scrollTo({
          top: scrollY + element.getBoundingClientRect().top - 320,
          behavior: 'instant',
        }),
      );
      const session = await mobile.context().newCDPSession(mobile);
      const swipe = async (start: number, end: number, x = width / 2, endX = x) => {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x, y: start, id: 1 }],
        });
        for (let step = 1; step <= 12; step++) {
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
              { x: x + ((endX - x) * step) / 12, y: start + ((end - start) * step) / 12, id: 1 },
            ],
          });
          await mobile.waitForTimeout(25);
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      await swipe(690, 160);
      assert(
        ['playing', 'opening'].includes((await phase(mobile))!),
        'A touch swipe must trigger the introduction without cancelling it',
      );
      const held = await mobile.evaluate(() => scrollY);
      await mobile.screenshot({ path: `${shots}/intro-${width}-cursor.png` });
      await swipe(590, 380);
      assert.equal(await mobile.evaluate(() => scrollY), held);
      await finished(mobile);
      await unlocked(mobile);
      assert.equal(
        await mobile.locator('[data-view="anatomy"]').getAttribute('aria-pressed'),
        'true',
      );
      assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await mobile.screenshot({ path: `${shots}/intro-${width}-exploded.png` });

      const panel = mobile.frameLocator('#anatomy-panel');
      const stage = (await panel.locator('.stage').boundingBox())!;
      const rotation = () =>
        panel
          .locator('.scene')
          .evaluate((element) =>
            (element as HTMLElement).style.transform.match(/rotate[XY]\([^)]+\)/g),
          );
      const beforeDrag = await rotation();
      const dragX = stage.x + stage.width * 0.65;
      const dragY = Math.min(stage.y + stage.height - 50, 760);
      await swipe(dragY, dragY - 140, dragX, dragX - 10);
      assert.notDeepEqual(await rotation(), beforeDrag, 'A canvas drag must rotate the view');
      assert.equal(await mobile.evaluate(() => scrollY), held, 'Canvas drags must not scroll');

      // A touch starting outside the canvas still scrolls, even when it crosses
      // into the canvas. Gesture ownership is decided at touchstart.
      const heading = (await panel.locator('.stage-heading').boundingBox())!;
      const beforeScroll = await rotation();
      await swipe(heading.y + heading.height / 2, heading.y + heading.height / 2 + 100);
      assert(
        (await mobile.evaluate(() => scrollY)) < held - 25,
        'The toolbar must allow page scrolling',
      );
      assert.deepEqual(await rotation(), beforeScroll, 'Page scrolling must not rotate the view');

      // Swipes beside the embedded example continue down the landing page.
      const outsideScroll = await mobile.evaluate(() => scrollY);
      await swipe(650, 400, 2);
      await mobile.waitForFunction((y) => scrollY > y + 100, outsideScroll);
    } finally {
      await mobile.close();
    }
  }

  assert.deepEqual(errors, []);
  console.log(
    'Passed: one-time scroll introduction, cursor click, scroll release, session persistence, cancellation, loading timeout, keyboard bypass, reduced motion, canvas touch rotation, and touch scrolling.',
  );
}

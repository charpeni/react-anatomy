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
      const swipe = async (
        start: number,
        end: number,
        x = width / 2,
        endX = x,
        positions?: number[],
      ) => {
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
          if (positions) {
            positions.push(await mobile.evaluate(() => scrollY));
          }
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
      const rotation = () =>
        panel
          .locator('.scene')
          .evaluate((element) =>
            (element as HTMLElement).style.transform.match(/rotate[XY]\([^)]+\)/g),
          );
      // Find one point on the layers and one on the empty canvas around them.
      const frameBox = (await mobile.locator('#anatomy-panel').boundingBox())!;
      const spots = await panel.locator('.stage').evaluate((element) => {
        const box = element.getBoundingClientRect();
        const layers: { x: number; y: number }[] = [];
        const empty: { x: number; y: number }[] = [];

        for (let y = box.top + 20; y < box.bottom - 20; y += 12) {
          for (let x = box.left + 12; x < box.right - 12; x += 12) {
            const hit = element.ownerDocument.elementFromPoint(x, y);

            if (hit === element) {
              empty.push({ x, y });
            } else if (hit?.closest('.component-plane')) {
              layers.push({ x, y });
            }
          }
        }

        const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        const distance = (point: { x: number; y: number }) =>
          Math.hypot(point.x - centre.x, point.y - centre.y);

        return {
          layer: layers.sort((first, second) => distance(first) - distance(second))[0],
          // The lowest empty point leaves the most room for an upward swipe.
          empty: empty.sort((first, second) => second.y - first.y || first.x - second.x)[0],
        };
      });
      assert(spots.layer && spots.empty, 'The canvas must show layers with empty space around');
      const layer = { x: frameBox.x + spots.layer.x, y: frameBox.y + spots.layer.y };
      const empty = { x: frameBox.x + spots.empty.x, y: frameBox.y + spots.empty.y };

      // A touch that starts on the layers rotates the view, even when it moves
      // straight up, and leaves the page where it is.
      const beforeDrag = await rotation();
      await swipe(layer.y, layer.y - 140, layer.x);
      assert.notDeepEqual(await rotation(), beforeDrag, 'Dragging the layers must rotate');
      assert.equal(
        await mobile.evaluate(() => scrollY),
        held,
        'Dragging the layers must not scroll the page',
      );

      // A sideways drag from the empty canvas rotates too.
      const beforeSideways = await rotation();
      await swipe(empty.y, empty.y - 20, empty.x, empty.x + (empty.x < width / 2 ? 150 : -150));
      assert.notDeepEqual(await rotation(), beforeSideways, 'A sideways canvas drag must rotate');
      assert.equal(
        await mobile.evaluate(() => scrollY),
        held,
        'Sideways canvas drags must not scroll',
      );

      // A vertical swipe that starts on the empty canvas belongs to the page,
      // even when it crosses the layers. Gesture ownership is decided at
      // touchstart. The canvas fills most of a phone screen, so holding every
      // touch there would trap the reader.
      const beforeSwipe = await rotation();
      await swipe(empty.y, empty.y - 200, empty.x);
      await mobile.waitForFunction((y) => scrollY > y + 120, held);
      await mobile.waitForTimeout(300);
      assert.deepEqual(
        await rotation(),
        beforeSwipe,
        'Scrolling past the canvas must leave the view as it was',
      );
      assert.equal(
        await panel.locator('.show-details').count(),
        0,
        'Scrolling past the canvas must not select a layer',
      );
      await mobile.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), held);

      // A touch starting outside the canvas still scrolls, even when it crosses
      // into the canvas. Gesture ownership is decided at touchstart.
      const heading = (await panel.locator('.stage-heading').boundingBox())!;
      const beforeScroll = await rotation();
      await swipe(heading.y + heading.height / 2, heading.y + heading.height / 2 + 100);
      assert(
        (await mobile.evaluate(() => scrollY)) < held - 80,
        'The toolbar must allow page scrolling',
      );
      assert.deepEqual(await rotation(), beforeScroll, 'Page scrolling must not rotate the view');

      // Swipes beside the embedded example continue down the landing page.
      const outsideScroll = await mobile.evaluate(() => scrollY);
      await swipe(650, 400, 2);
      await mobile.waitForFunction((y) => scrollY > y + 100, outsideScroll);

      // The props list is longer than its pane. It scrolls itself first, then
      // hands the next swipe to the page instead of holding the reader inside.
      await mobile.locator('[data-step="props"]').tap();
      await panel.locator('[data-prop-path="props.project"]').waitFor();
      await mobile.locator('#demo').evaluate((element) =>
        window.scrollTo({
          top: scrollY + element.getBoundingClientRect().top - 12,
          behavior: 'instant',
        }),
      );
      await mobile.waitForTimeout(100);
      const list = panel.locator('.inspector-scroll');
      const listBox = (await list.boundingBox())!;
      const listX = listBox.x + listBox.width / 2;
      const listHidden = await list.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      );
      assert(listHidden > 0, 'The sample props must overflow the phone-sized pane');
      const beforeList = await mobile.evaluate(() => scrollY);
      await swipe(listBox.y + listBox.height - 30, listBox.y + 30, listX);
      await mobile.waitForFunction(
        () =>
          document
            .querySelector<HTMLIFrameElement>('#anatomy-panel')!
            .contentDocument!.querySelector('.inspector-scroll')!.scrollTop > 60,
      );
      assert.equal(
        await mobile.evaluate(() => scrollY),
        beforeList,
        'Scrolling the props list must not also scroll the page',
      );
      await mobile.waitForTimeout(300);
      await list.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
      await swipe(listBox.y + listBox.height - 30, listBox.y + 30, listX);
      await mobile.waitForFunction((y) => scrollY > y + 100, beforeList);

      // Orbit should scroll like the surrounding page. Measuring just whether
      // it moves misses the iframe feedback bug: alternating stalls/backward
      // jumps left the page roughly half a gesture behind the finger.
      await mobile.locator('[data-view="page"]').tap();
      for (const [start, end] of [
        [650, 410],
        [410, 650],
      ]) {
        await mobile.locator('#demo').evaluate((element) =>
          window.scrollTo({
            top: scrollY + element.getBoundingClientRect().top - 100,
            behavior: 'instant',
          }),
        );
        await mobile.waitForTimeout(100);
        const before = await mobile.evaluate(() => scrollY);
        const positions: number[] = [];
        await swipe(start, end, width / 2, width / 2, positions);
        const direction = Math.sign(start - end);
        const travel = (positions.at(-1)! - before) * direction;
        assert(travel >= 200 && travel <= 260, `Orbit must track a 240px swipe; got ${travel}px`);
        const deltas = positions.map((y, i) => (y - (positions[i - 1] ?? before)) * direction);
        assert(
          deltas.every((delta) => delta >= 0),
          'Orbit scrolling must not jump backward',
        );
        assert(
          deltas.filter((delta) => delta > 0).length >= 9,
          'Orbit scrolling must not repeatedly stall',
        );
        assert.equal(
          await mobile
            .frameLocator('#anatomy-source')
            .locator('html')
            .evaluate((element) => element.ownerDocument.defaultView!.scrollY),
          0,
          'The sample must stay in place while the landing page scrolls',
        );
        await mobile.waitForTimeout(300);
      }
    } finally {
      await mobile.close();
    }
  }

  assert.deepEqual(errors, []);
  console.log(
    'Passed: one-time scroll introduction, cursor click, scroll release, session persistence, cancellation, loading timeout, keyboard bypass, reduced motion, canvas touch rotation and scroll-through, props list touch scrolling, and smooth Orbit touch scrolling.',
  );
}

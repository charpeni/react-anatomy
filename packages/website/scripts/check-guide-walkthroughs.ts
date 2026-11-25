import type { Browser, Locator, Page } from 'playwright';
import assert from 'node:assert/strict';

async function step(page: Page, heading: string) {
  await page.locator('.guide-title', { hasText: heading }).waitFor();
  await page.locator('.guide-next:not(:disabled)').waitFor();
  assert(
    !(await page.locator('.guide-instruction').innerText()).includes('could not be completed'),
  );
}

// Holds the target's echo at one moment of its loop and captures the space around the target.
async function paintedAt(page: Page, target: Locator, time: number) {
  await target.scrollIntoViewIfNeeded();
  await target.evaluate((el, time) => {
    for (const animation of el.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = time;
    }
  }, time);
  const box = (await target.boundingBox())!;
  return page.screenshot({
    clip: { x: box.x - 16, y: box.y - 16, width: box.width + 32, height: box.height + 32 },
  });
}

async function openGuide(page: Page, base: string, slug: string) {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.goto(`${base}/docs/${slug}/`);
  const start = page.getByRole('button', { name: 'Start interactive walkthrough' });
  await start.waitFor();
  const layout = await start.evaluate((button) => {
    const guide = button.closest<HTMLElement>('.guide-example')!;
    const article = guide.closest('.sl-markdown-content')!;
    const preview = guide.querySelector('.guide-preview')!.getBoundingClientRect();
    const cta = button.getBoundingClientRect();
    return {
      first: article.firstElementChild?.tagName,
      transcript: article
        .querySelector('video + details')
        ?.querySelector('summary')
        ?.textContent?.trim(),
      instructionsBeforeGuide: ['P', 'OL'].includes(guide.previousElementSibling?.tagName ?? ''),
      centered:
        Math.abs(cta.left + cta.width / 2 - preview.left - preview.width / 2) < 1 &&
        Math.abs(cta.top + cta.height / 2 - preview.top - preview.height / 2) < 1,
      width: preview.width,
    };
  });
  assert.equal(layout.first, 'VIDEO');
  assert.equal(layout.transcript, 'Video transcript');
  assert(layout.instructionsBeforeGuide && layout.centered);
  assert.equal(await page.locator('.guide-example iframe').count(), 0);
  assert(
    !requests.some((path) => path.startsWith('/interactive/')),
    'The sample loaded before Start',
  );
  await start.press('Enter');
  assert(Math.abs((await page.locator('.guide-player').boundingBox())!.width - layout.width) < 1);

  return page.frameLocator('#anatomy-panel');
}

export async function checkGuideWalkthroughs(browser: Browser, base: string, shots: string) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    // Keep the desktop reader navigation usable while the inspector uses the extra width.
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`${base}/docs/find-the-same-reference/`);
    const preview = await page.locator('.guide-preview').boundingBox();
    const video = await page.locator('.sl-markdown-content video').boundingBox();
    const toc = await page.locator('.right-sidebar-container').boundingBox();
    assert(preview && video && toc);
    assert(preview.width > video.width + 100 && preview.x + preview.width <= toc.x);
    await page.setViewportSize({ width: 390, height: 844 });
    const panel = await openGuide(page, base, 'find-the-same-reference');
    await step(page, 'Search from the Customer portal card');
    assert.equal(
      await panel.locator('.tree-row.selected .tree-key').textContent(),
      'key="customer-portal"',
    );
    const link = panel.getByRole('button', { name: 'Find same reference as onCompleteTask' });
    assert.deepEqual(await page.locator('.guide-instruction code').allTextContents(), [
      'onCompleteTask',
    ]);
    const fill = await link.evaluate((el) => getComputedStyle(el).backgroundColor);
    await link.hover();
    assert.equal(await link.evaluate((el) => getComputedStyle(el).backgroundColor), fill);
    const box = (await link.boundingBox())!;
    await page.mouse.click(box.x - 2, box.y + box.height / 2);
    await step(page, 'Find the shared callback');
    const summary = panel.locator('.reference-summary[data-guide-target]');
    assert.match(await summary.innerText(), /5 component instances/);
    assert.deepEqual(
      await summary.evaluate((el) => {
        const echo = getComputedStyle(el, '::after');
        const pane = el.closest('.inspector-scroll')!;
        return [
          echo.animationName,
          echo.animationIterationCount,
          pane.scrollWidth <= pane.clientWidth,
        ];
      }),
      ['anatomy-guide-echo', 'infinite', true],
    );
    // A running animation can still paint nothing, so compare the pixels around a full-width row.
    const resting = await paintedAt(page, summary, 1700);
    assert(resting.equals(await paintedAt(page, summary, 1700)));
    assert(!resting.equals(await paintedAt(page, summary, 300)), 'The echo painted nothing');
    await summary.evaluate((el) => el.getAnimations({ subtree: true }).forEach((a) => a.play()));
    await page.locator('.guide-player').screenshot({ path: shots + 'guide-reference.png' });
    await page.getByRole('button', { name: 'Next step' }).click();
    await step(page, 'Locate the Mobile app card');
    assert(
      (await page.locator('#anatomy-panel').isHidden()) ||
        (await page.locator('#anatomy-panel').getAttribute('hidden')) !== null,
    );
    assert.equal(await panel.locator('[data-guide-target]').count(), 0);
    const source = page.frameLocator('#anatomy-source');
    assert(
      await source.locator('[data-project="mobile-app"][data-guide-target]').evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight;
      }),
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await step(page, 'Find the shared callback');
    assert.equal(await source.locator('[data-guide-target]').count(), 0);
    assert.deepEqual(
      await summary.evaluate((el) => [
        getComputedStyle(el).outlineStyle,
        parseFloat(getComputedStyle(el).outlineOffset) > 0,
        getComputedStyle(el, '::after').animationName,
      ]),
      ['solid', true, 'none'],
    );
    await page.getByRole('button', { name: 'Next step' }).click();
    await step(page, 'Locate the Mobile app card');
    const restart = page.getByRole('button', { name: 'Restart', exact: true });
    const restartColor = await restart.evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.equal(
      restartColor,
      await page.locator('.guide-back').evaluate((el) => getComputedStyle(el).backgroundColor),
    );
    await restart.click();
    await step(page, 'Search from the Customer portal card');
    assert.equal(await panel.locator('.same-reference').count(), 0);
    assert.notEqual(
      await page
        .getByRole('button', { name: 'Next step' })
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      restartColor,
    );
    await link.press('Enter');
    await step(page, 'Find the shared callback');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await step(page, 'Search from the Customer portal card');
    await page.getByRole('button', { name: 'Next step' }).click();
    await step(page, 'Find the shared callback');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  } finally {
    await page.close();
  }
}

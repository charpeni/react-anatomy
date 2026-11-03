import assert from 'node:assert/strict';
import type { Browser, BrowserContextOptions } from 'playwright';

export async function checkHero(browser: Browser, base: string, shots: string) {
  const cases: BrowserContextOptions[] = [
    { viewport: { width: 1440, height: 1050 } },
    { viewport: { width: 900, height: 1050 } },
    { viewport: { width: 390, height: 1050 }, reducedMotion: 'reduce' },
    { viewport: { width: 320, height: 1050 }, reducedMotion: 'reduce' },
    { viewport: { width: 390, height: 1050 }, javaScriptEnabled: false },
  ];
  const errors: string[] = [];

  for (const options of cases) {
    const page = await browser.newPage(options);

    page.on('pageerror', (error) => errors.push(error.message));

    try {
      await page.goto(base);
      await page.evaluate(() => document.fonts.ready);

      // Decorative component labels must not become part of the heading's accessible name.
      assert.equal(
        await page
          .getByRole('heading', {
            level: 1,
            name: 'See how a React page is composed.',
            exact: true,
          })
          .count(),
        1,
      );

      const hero = page.locator('.hero');

      if (options.reducedMotion || options.javaScriptEnabled === false) {
        assert.equal(
          await hero.evaluate((element) => element.getAnimations({ subtree: true }).length),
          0,
        );
      } else {
        await hero.evaluate((element) =>
          element.getAnimations({ subtree: true }).forEach((animation) => animation.finish()),
        );
      }

      const problems = await hero.evaluate((element) => {
        const problems: string[] = [];

        if (document.documentElement.scrollWidth > innerWidth) {
          problems.push('Horizontal overflow');
        }

        for (const layer of element.querySelectorAll('.hero-plane, .hero-tag')) {
          const rect = layer.getBoundingClientRect();

          if (rect.left < 0 || rect.right > innerWidth) {
            problems.push(`Clipped ${layer.className}`);
          }
        }

        for (const link of element.querySelectorAll('a')) {
          const rect = link.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);

          if (!link.contains(hit)) {
            problems.push(`Obscured ${link.textContent}`);
          }
        }

        return problems;
      });

      assert.deepEqual(problems, []);
      await page.screenshot({
        path: `${shots}/hero-${options.viewport!.width}${options.javaScriptEnabled === false ? '-no-js' : ''}.png`,
      });

      if (options.javaScriptEnabled === false) {
        await page.getByRole('link', { name: 'Read the guide' }).click();
        await page.waitForURL(base + '/docs/');
      } else if (options.viewport!.width === 1440) {
        await page.getByRole('link', { name: 'Explore the example' }).focus();
        await page.keyboard.press('Enter');
        await page.frameLocator('#anatomy-panel').locator('.tree-select').first().waitFor();
      }
    } finally {
      await page.close();
    }
  }

  assert.deepEqual(errors, []);
  console.log(
    'Passed: hero heading semantics, narrow layouts, transformed links, reduced motion, and no-JS navigation.',
  );
}

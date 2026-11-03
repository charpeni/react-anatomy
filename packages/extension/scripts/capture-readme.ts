import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launchExtension, openDevtoolsPanel } from './chrome-harness.ts';
import { startFixtureServer } from './fixture-server.ts';

const output = fileURLToPath(new URL('../assets/', import.meta.url));
const fixture = await startFixtureServer();
const errors: string[] = [];
let browser: Awaited<ReturnType<typeof launchExtension>> | undefined;

try {
  const activeBrowser = await launchExtension();
  browser = activeBrowser;

  const page = browser.context.pages()[0];

  page.on('pageerror', (error) => errors.push(error.message));

  await page.setViewportSize({ width: 1000, height: 640 });
  await page.goto(fixture.url + '/demo');
  await page.getByRole('button', { name: 'New project' }).waitFor();

  const { session, panelSession } = await openDevtoolsPanel(browser);

  await browser.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
    session,
  );

  const run = <T = unknown>(expression: string) =>
    activeBrowser.evaluate<T>(expression, panelSession);

  await browser.until(
    () => run("document.querySelectorAll('.tree-select').length === 24 && innerWidth === 1440"),
    'The component tree and capture viewport did not settle',
  );

  assert(
    await run(`(() => {
      document.querySelector('[aria-label="Explode view"]').click();
      const card = [...document.querySelectorAll('.tree-select')].find(
        (button) => button.querySelector('.node-name')?.textContent === 'ProjectCard',
      );
      card?.click();
      return !!card;
    })()`),
    'ProjectCard was not captured',
  );

  // Use the inspector's real resizing and expansion controls.
  await run(`(() => {
    const separator = document.querySelector('[aria-label="Component details width"]');
    for (let i = 0; i < 6; i++) {
      separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    }
  })()`);

  for (const path of ['props.project', 'props.project.settings']) {
    await browser.until(
      () => run(`!!document.querySelector('[data-prop-path="${path}"] > summary')`),
      `Missing props: ${path}`,
    );
    await run(`document.querySelector('[data-prop-path="${path}"] > summary').click()`);
  }

  await browser.until(
    () => run('!!document.querySelector(\'[data-prop-path="props.project.settings.release"]\')'),
    'Nested project props did not load',
  );
  await run('document.fonts.ready.then(() => true)');
  await run(
    'Promise.all(document.getAnimations().map((animation) => animation.finished)).then(() => true)',
  );
  await run(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  assert.equal(await run("document.querySelector('.capture-limit-banner')?.textContent || ''"), '');
  assert.deepEqual(errors, []);

  const screenshot = await browser.send(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: false },
    session,
  );
  const png = Buffer.from(screenshot.data, 'base64');

  assert.equal(png.readUInt32BE(16), 1440);
  assert.equal(png.readUInt32BE(20), 900);

  await mkdir(output, { recursive: true });
  await writeFile(output + 'extension.png', png);
  console.log(`Captured the real Anatomy DevTools panel: ${output}extension.png`);
} finally {
  await browser?.close();
  await fixture.close();
}

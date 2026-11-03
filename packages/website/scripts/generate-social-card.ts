import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { browserOptions } from '../../extension/scripts/browser-options.ts';

const source = (path: string) => new URL(path, import.meta.url);
const mark = await readFile(source('../../brand/svg/mark-light.svg'), 'utf8');
const font = await readFile(source('../public/fonts/instrument-sans/latin-wght-normal.woff2'));
const screenshot = await readFile(source('../../extension/assets/extension.png'));
const browser = await chromium.launch({ ...browserOptions(), headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });

  await page.setContent(`<!doctype html><html lang="en"><meta charset="utf-8"><style>
    @font-face { font-family: Instrument; src: url(data:font/woff2;base64,${font.toString('base64')}); font-weight: 400 700; }
    * { box-sizing: border-box; }
    body { margin: 0; width: 1200px; height: 630px; background: #fafaf8; color: #20221f; font-family: Instrument, sans-serif; }
    header { position: absolute; top: 54px; left: 60px; display: flex; gap: 16px; align-items: center; font-size: 34px; letter-spacing: -1px; }
    header svg { width: 48px; height: 48px; }
    h1 { position: absolute; top: 164px; left: 60px; width: 380px; margin: 0; font-size: 50px; line-height: 1.06; font-weight: 600; letter-spacing: -1.8px; }
    p { position: absolute; top: 365px; left: 60px; width: 340px; margin: 0; font-size: 24px; line-height: 1.5; color: #555950; }
    .capture { position: absolute; top: 145px; left: 468px; width: 680px; border: 1px solid #d8dbd2; border-radius: 12px; box-shadow: 0 12px 32px #20221f12; }
    footer { position: absolute; bottom: 46px; left: 60px; font-size: 22px; color: #555950; }
  </style><header>${mark}<span>React <strong>Anatomy</strong></span></header>
  <h1>Your React page,<br>seen in 3D.</h1>
  <p>Explore the component tree.<br>Inspect live props.<br>Understand the page.</p>
  <img class="capture" src="data:image/png;base64,${screenshot.toString('base64')}" alt="React Anatomy DevTools panel">
  <footer>react-anatomy.com</footer></html>`);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 1200);

  await mkdir(source('../public/media/'), { recursive: true });
  await page.screenshot({
    path: fileURLToPath(source('../public/media/react-anatomy-social.png')),
  });
} finally {
  await browser.close();
}

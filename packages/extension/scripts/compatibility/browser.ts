import { writeFile, type FileHandle } from 'node:fs/promises';
import { launchExtension, openDevtoolsPanel } from '../chrome-harness.ts';
import { launchFirefox } from '../firefox-harness.ts';
import type { PathLike } from 'node:fs';

export async function launchBrowser(browser: string) {
  if (browser === 'firefox') {
    const h = await launchFirefox();

    return { ...h, open: () => h.openPanel(), sourceErrors: () => null };
  }

  if (browser !== 'chrome') {
    throw new Error('Use --browser=chrome or --browser=firefox');
  }

  const h = await launchExtension();
  const page = h.context.pages()[0];
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));

  let panelSession: string;
  let session: string | undefined;
  const info = await h.send('Browser.getVersion');

  return {
    version: info.product,
    until: h.until,
    sourceErrors: () => errors.splice(0),
    navigate: (url: string) => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }),
    page: <T = unknown>(expression: string) => page.evaluate<T>(expression),
    clickPage: (selector: string) => page.locator(selector).first().click(),
    async open() {
      ({ panelSession, session } = await openDevtoolsPanel(h));
      await h.send(
        'Emulation.setDeviceMetricsOverride',
        { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
        session,
      );
    },
    panel: <T = unknown>(expression: string) => h.evaluate<T>(expression, panelSession),
    async screenshot(path: PathLike | FileHandle) {
      const shot = await h.send('Page.captureScreenshot', { format: 'png' }, session);

      await writeFile(path, Buffer.from(shot.data, 'base64'));
    },
    close: h.close,
  };
}

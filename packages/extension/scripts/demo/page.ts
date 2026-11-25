import type { Page } from 'playwright';

export const orbitUrl = 'https://orbit.react-anatomy.com/';

// Capture this checkout's self-contained Orbit build at its public address.
export async function openOrbitSample(page: Page) {
  await page.route(orbitUrl, (route) =>
    route.fulfill({ path: 'dist/demo-app.html', contentType: 'text/html' }),
  );
  await page.goto(orbitUrl);
}

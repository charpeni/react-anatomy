import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { launchExtension, openDevtoolsPanel } from '../chrome-harness.ts';
import { browserOptions } from '../browser-options.ts';
import { startFixtureServer } from '../fixture-server.ts';
import { archive, collect, extract, json, node, releaseAt, repository, sha256 } from './common.ts';

const release = await releaseAt();
const output = join(repository, 'artifacts/store', `chrome-${release.version}`);

await mkdir(output, { recursive: true });

const unpacked = await mkdtemp(join(tmpdir(), 'anatomy-store-capture-'));

await extract(await readFile(join(release.directory, release.artifacts.chrome.file)), unpacked);
await node('scripts/demo/build.ts');

const fixture = await startFixtureServer();
let h!: Awaited<ReturnType<typeof launchExtension>>;
const images: ({ file: string; description: string; sha256: string } & ReturnType<
  typeof pngInfo
>)[] = [];
const errors: string[] = [];

function pngInfo(bytes: Buffer) {
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    depth: bytes[24],
    colorType: bytes[25],
  };
}

try {
  h = await launchExtension({ extension: unpacked });

  const page = h.context.pages()[0];

  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1000, height: 640 });
  await page.goto(fixture.url + '/demo');
  await page.getByRole('button', { name: 'New project' }).waitFor();

  const { session, panelSession } = await openDevtoolsPanel(h);

  await h.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
    session,
  );

  const run = <T = unknown>(expression: string) => h.evaluate<T>(expression, panelSession);

  await h.until(
    () => run("document.querySelectorAll('.tree-select').length===24 && innerWidth===1280"),
    'Capture or viewport did not settle',
  );

  const settle = async () => {
    await run('document.fonts.ready.then(()=>true)');
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await run(
      'Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))).then(()=>true)',
    );
  };

  const click = async (label: string) => {
    const result = await run(
      `(()=>{const button=[...document.querySelectorAll('button')].find(el=>(el.getAttribute('aria-label')||el.textContent.trim())===${JSON.stringify(label)});if(!button) return false;button.click();return true})()`,
    );

    assert(result, `Missing control: ${label}`);
    await settle();
  };

  const select = async (name: string) => {
    const result = await run(
      `(()=>{const button=[...document.querySelectorAll('.tree-select')].find(el=>el.querySelector('.node-name')?.textContent===${JSON.stringify(name)});if(!button)return false;button.click();return true})()`,
    );

    assert(result, `Missing component: ${name}`);
    await settle();
  };

  const shot = async (file: string, description: string) => {
    await settle();
    assert.equal(
      await run("document.querySelector('.capture-limit-banner')?.textContent || ''"),
      '',
    );

    const result = await h.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false },
      session,
    );
    const bytes = Buffer.from(result.data, 'base64');

    assert.deepEqual(pngInfo(bytes), { width: 1280, height: 800, depth: 8, colorType: 2 });
    await writeFile(join(output, file), bytes);
    images.push({ file, description, ...pngInfo(bytes), sha256: sha256(bytes) });
  };

  await click('Explode view');
  await select('ProjectList');
  await shot(
    '01-component-hierarchy.png',
    'The complete Orbit component tree and exploded page, with ProjectList selected.',
  );

  await select('ProjectCard');
  await click('Focus subtree');
  await h.until(
    () => run("document.querySelectorAll('[data-plane]').length===4"),
    'Focused card not ready',
  );
  await shot(
    '02-focus-subtree.png',
    'Focus on ProjectCard and its StatusBadge, ProgressBar and AvatarStack children.',
  );

  await click('Whole page');
  await select('ProjectCard');

  // Resize the real details pane with its supported keyboard controls.
  for (let i = 0; i < 10; i++) {
    await run(
      `document.querySelector('[aria-label="Component details width"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`,
    );
    await settle();
  }

  for (const path of [
    'props.project',
    'props.project.settings',
    'props.project.settings.release',
  ]) {
    await h.until(
      () => run(`Boolean(document.querySelector('[data-prop-path="${path}"] > summary'))`),
      `Missing props: ${path}`,
    );
    await run(
      `(()=>{const details=document.querySelector('[data-prop-path="${path}"]');if(!details.open)details.querySelector('summary').click();return true})()`,
    );
    await settle();
  }

  await h.until(
    () =>
      run(
        "document.querySelector('[data-prop-path=\"props.project.settings.release.version\"]')?.textContent.includes('2.4.0')",
      ),
    'Nested props did not load',
  );
  await shot(
    '03-inspect-props.png',
    'Select the Design system ProjectCard and inspect its real nested release settings.',
  );
  await writeFile(
    join(output, 'icon-128.png'),
    await readFile(join(unpacked, 'icons/icon-128.png')),
  );
  assert.deepEqual(errors, []);
} finally {
  if (h) {
    await h.close();
  }

  await fixture.close();
  await rm(unpacked, { recursive: true, force: true });
}

// Optional store tile: approved brand assets laid out in HTML, not a UI screenshot.
const browser = await chromium.launch({ headless: true, ...browserOptions() });

try {
  const page = await browser.newPage({
    viewport: { width: 440, height: 280 },
    deviceScaleFactor: 1,
  });
  const font = (
    await readFile(
      join(repository, 'packages/website/public/fonts/instrument-sans/latin-wght-normal.woff2'),
    )
  ).toString('base64');
  const mark = (await readFile(join(repository, 'packages/brand/svg/mark-light.svg'))).toString(
    'base64',
  );

  await page.setContent(
    `<!doctype html><html><head><style>@font-face{font-family:Instrument;src:url(data:font/woff2;base64,${font});font-weight:400 700}*{box-sizing:border-box}body{margin:0;width:440px;height:280px;display:flex;align-items:center;justify-content:center;background:#fafaf8;color:#202226;font-family:Instrument,sans-serif}.tile{text-align:center}.brand{display:flex;align-items:center;justify-content:center;gap:12px;font-size:30px;letter-spacing:-1px;font-weight:450}.brand img{width:58px;height:58px}.brand strong{font-weight:650}p{margin:22px 0 0;font-size:18px;line-height:1.45;letter-spacing:-.35px;color:#555a63}.type{margin-top:18px;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#1967d2}</style></head><body><div class="tile"><div class="brand"><img src="data:image/svg+xml;base64,${mark}" alt=""><span>React <strong>Anatomy</strong></span></div><p>See how a React page<br>is composed.</p><div class="type">A browser DevTools panel</div></div></body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);

  const bytes = await page.screenshot({ type: 'png' });

  assert.deepEqual(pngInfo(bytes), { width: 440, height: 280, depth: 8, colorType: 2 });
  await writeFile(join(output, 'small-promo-440x280.png'), bytes);
} finally {
  await browser.close();
}

await writeFile(
  join(output, 'README.txt'),
  `React Anatomy ${release.version} — Chrome Web Store images\n\nStore icon: icon-128.png (approved Exploded Stack; PNG with transparency).\nScreenshots: upload 01, 02, 03 in that order (1280 x 800, 24-bit PNG, no alpha).\nSmall promotional tile: small-promo-440x280.png (440 x 280, 24-bit PNG, no alpha).\n\nThe screenshots are direct captures of the real Anatomy DevTools panel, loaded from the verified Chrome package you uploaded. Orbit is the same illustrative React app used on the website. No UI is painted over, labels changed, or screenshots enlarged. Only the sample viewport and DevTools viewport were sized for capture; all views, selections, focus and props use the extension's actual controls.\n\nThe promotional tile is a separate brand composition, not a screenshot. It uses the approved mark and self-hosted Instrument Sans.\n\nThese assets have not been uploaded to a store.\n`,
);
await writeFile(
  join(output, 'validation.json'),
  json({
    version: release.version,
    packageSha256: release.artifacts.chrome.sha256,
    images,
    pageErrors: errors,
  }),
);

const files = await collect(output);

delete files['react-anatomy-chrome-store-images.zip'];
await writeFile(join(output, 'react-anatomy-chrome-store-images.zip'), archive(files));
console.log(`Prepared store images: ${output}`);

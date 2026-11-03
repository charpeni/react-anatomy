import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchExtension, openDevtoolsPanel } from './chrome-harness.ts';
import { startFixtureServer } from './fixture-server.ts';

const fixture = await startFixtureServer();
const harness = await launchExtension();

try {
  const page = harness.context.pages()[0];

  await page.goto(fixture.url + '/layout');
  await page.locator('article').first().waitFor();

  const { session, panelSession } = await openDevtoolsPanel(harness);

  const evaluate = <T = unknown>(expression: string) =>
    harness.evaluate<T>(expression, panelSession);

  await harness.until(
    () => evaluate(`document.querySelectorAll('.tree-select').length>15`),
    'Layout hierarchy did not load',
  );
  await harness.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    session,
  );

  const click = async (label: string) =>
    assert(
      await evaluate(
        `(()=>{const button=Array.from(document.querySelectorAll('button')).find(b=>(b.getAttribute('aria-label')||b.textContent.trim())===${JSON.stringify(label)});if(!button)return false;button.click();return true;})()`,
      ),
      `Missing ${label}`,
    );

  await click('Explode view');
  await harness.until(
    () => evaluate(`document.querySelector('[aria-label="Assemble"]')!==null`),
    'Explode did not finish',
  );
  await new Promise((r) => setTimeout(r, 250));

  const inspect = () =>
    evaluate<{ planes: string[]; depth: string }>(
      `({planes:Array.from(document.querySelectorAll('[data-plane]')).map(p=>p.getAttribute('aria-label')),depth:document.querySelector('.depth-control output').textContent})`,
    );

  const initial = await inspect();

  console.log('Initial layout view:', JSON.stringify(initial));
  await mkdir('artifacts', { recursive: true });

  const shot = await harness.send('Page.captureScreenshot', { format: 'png' }, session);

  await writeFile('artifacts/layout-depth.png', Buffer.from(shot.data, 'base64'));

  const bounds = await evaluate<{ name: string; inside: boolean }[]>(
    `(()=>{const stage=document.querySelector('.stage').getBoundingClientRect();return Array.from(document.querySelectorAll('[data-plane]')).map(p=>{const r=p.getBoundingClientRect();return {name:p.getAttribute('aria-label'),inside:r.left>=stage.left&&r.right<=stage.right&&r.top>=stage.top&&r.bottom<=stage.bottom};});})()`,
  );

  assert(
    bounds.every((p) => p.inside),
    'Automatic overview clips planes outside the canvas: ' +
      JSON.stringify(bounds.filter((p) => !p.inside)),
  );

  if (
    await evaluate(
      `document.querySelector('[aria-label="Automatic layer depth"]')?.getAttribute('aria-pressed')==='true'`,
    )
  ) {
    await click('Automatic layer depth');
  }

  await evaluate(
    `(()=>{const input=document.querySelector('[aria-label="Reveal depth"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,input.max);input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await harness.until(
    () => evaluate(`document.querySelectorAll('[aria-label="Select MessageCard"]').length===3`),
    'Message cards are missing even at full depth',
  );
  console.log('Full manual depth:', JSON.stringify(await inspect()));
  assert.equal(
    await evaluate(`document.querySelector('.capture-limit-banner')===null`),
    true,
    'Fixture must have a complete capture',
  );
  assert.equal(
    initial.planes.filter((name: string) => name === 'Select MessageCard').length,
    3,
    'Default view hides main-content cards behind layout shells',
  );
  assert(initial.planes.includes('Select Composer'), 'Default view hides the composer');
  assert(initial.planes.includes('Select Sidebar'), 'Default view loses the sidebar');
  console.log('Passed: default view reveals distinct regions across uneven React nesting.');
  assert.equal(
    (await inspect()).depth,
    '11/11',
    'Manual depth did not reveal the entire hierarchy',
  );
  await evaluate(
    `(()=>{const input=document.querySelector('[aria-label="Reveal depth"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'4');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await harness.until(
    () => evaluate(`document.querySelector('.depth-control output').textContent==='4/11'`),
    'Manual slider did not update',
  );
  assert.equal(
    await evaluate(`document.querySelectorAll('[aria-label="Select MessageCard"]').length`),
    0,
  );
  await click('Capture');
  await harness.until(
    () => evaluate(`document.querySelector('.footer-count').textContent==='Capture 2'`),
    'Recapture did not finish',
  );
  assert.equal((await inspect()).depth, '4/11', 'Recapture overwrote manual depth');
  await click('Automatic layer depth');
  await harness.until(
    () =>
      evaluate(
        `document.querySelectorAll('[aria-label="Select MessageCard"]').length===3&&document.querySelector('.depth-control output').textContent==='Auto'`,
      ),
    'Auto did not restore the layout overview',
  );
  // Small components remain selectable, with their original props and output.
  await evaluate(
    `Array.from(document.querySelectorAll('.tree-select')).find(b=>b.querySelector('.node-name').textContent==='NavItem').click()`,
  );
  await harness.until(
    () =>
      evaluate(
        `document.querySelectorAll('[aria-label="Select NavItem"]').length===1&&document.querySelector('.props-inspector').textContent.includes('New chat')`,
      ),
    'Auto hid the explicitly selected small component or lost its props',
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.tree-select')).find(b=>b.querySelector('.node-name').textContent==='Sidebar').click()`,
  );
  await click('Focus subtree');
  await harness.until(
    () => evaluate(`document.querySelectorAll('[aria-label="Select NavItem"]').length===4`),
    'Focused overview did not reveal local details',
  );
  await click('Whole page');
  await harness.until(
    () => evaluate(`document.querySelectorAll('[aria-label="Select MessageCard"]').length===3`),
    'Whole page did not restore main layout',
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.tree-select')).find(b=>b.querySelector('.node-name').textContent==='ContentBoundary').click()`,
  );
  await harness.until(
    () => evaluate(`document.querySelectorAll('[aria-label="Select ContentBoundary"]').length===1`),
    'Selected layout container remained hidden',
  );
  await click('Reset view');
  // Select the root to avoid emphasizing the explicitly selected container.
  await evaluate(`document.querySelector('.tree-select').click()`);
  await click('Explode view');
  await harness.until(
    () => evaluate(`document.querySelector('[aria-label="Assemble"]')!==null`),
    'Final explode failed',
  );
  await new Promise((r) => setTimeout(r, 250));

  const final = await harness.send('Page.captureScreenshot', { format: 'png' }, session);

  await writeFile('artifacts/layout-depth.png', Buffer.from(final.data, 'base64'));
  console.log(
    'Passed: manual control, preserved manual depth, Auto restore, small-component selection, props, subtree detail, whole page, selected containers, and camera fit.',
  );
} finally {
  await harness.close();
  await fixture.close();
}

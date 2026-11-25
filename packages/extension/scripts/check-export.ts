import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchExtension, openDevtoolsPanel } from './chrome-harness.ts';
import { startFixtureServer } from './fixture-server.ts';

// Exports a focused subtree with chosen props from the real DevTools panel, and
// checks the composition, the PNG, copying and downloading.

await mkdir('artifacts', { recursive: true });

const fixture = await startFixtureServer();
const h = await launchExtension();
const downloads = await mkdtemp(join(tmpdir(), 'react-anatomy-export-'));

try {
  const page = h.context.pages()[0];

  await page.goto(fixture.url + '/');
  await page.getByRole('button', { name: 'Update app (0)' }).waitFor();

  // A same-origin image without CORS headers. The panel's own origin cannot
  // fetch it, so it can only reach the image through the page.
  await page.evaluate(() => {
    const image = Object.assign(document.createElement('img'), {
      src: '/fixture-image.png',
      alt: '',
    });

    image.style.cssText = 'display:block;width:24px;height:24px';
    document.querySelector('.project-card')!.prepend(image);

    // Characters XML forbids, and a broken surrogate pair, must not stop an export.
    document
      .querySelector('.project-card')!
      .append(Object.assign(document.createElement('small'), { textContent: 'a\fb\x1bc\ud83dd' }));

    return image.decode();
  });

  const { session, panelSession } = await openDevtoolsPanel(h);

  const run = <T = unknown>(expression: string) => h.evaluate<T>(expression, panelSession);

  const click = async (selector: string) => {
    assert(
      await run(
        `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.click();return true;})()`,
      ),
      `Missing ${selector}`,
    );
  };

  const select = async (name: string) => {
    await h.until(
      () =>
        run(
          `(()=>{const el=Array.from(document.querySelectorAll('.tree-select')).find(el=>el.querySelector('.node-name').textContent===${JSON.stringify(name)});if(!el)return false;el.click();return true;})()`,
        ),
      `Missing component ${name}`,
    );
    await h.until(
      () => run(`document.querySelector('.inspector h2')?.textContent===${JSON.stringify(name)}`),
      `${name} was not selected`,
    );
  };

  const idle = () =>
    h.until(
      () => run(`!document.querySelector('[aria-label="Capture"]')?.disabled`),
      'Capture did not finish',
    );

  const openExport = async () => {
    await click('[aria-label="Export image"]');
    await h.until(
      () =>
        run(
          `!!document.querySelector('.export-preview img') || document.querySelector('.export-preview [role="alert"]')?.textContent`,
        ),
      'The export did not render',
    );
    assert(
      await run(`!!document.querySelector('.export-preview img')`),
      await run<string>(`document.querySelector('.export-preview').textContent`),
    );
  };

  // The dialog closes at once, but the panel learns of it from the close event
  // and a later render. Shortcuts are ignored until then, so wait for the
  // dialog to be removed, not only closed.
  const closeExport = async () => {
    await click('[aria-label="Close export"]');
    await h.until(() => run(`!document.querySelector('.export-dialog')`), 'Export did not close');
  };

  const exported = () =>
    run<{ cards: string[]; notes: string; footer: string }>(`({
      cards:Array.from(document.querySelectorAll('.export-card')).map(c=>c.textContent),
      notes:document.querySelector('.export-notes').textContent,
      footer:document.querySelector('.export-footer').textContent,
    })`);

  const setNesting = (value: 'collapsed' | 'inspected') =>
    run(`(()=>{
    const select = document.querySelector('.export-prop-controls select');
    select.value = ${JSON.stringify(value)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const toggleTypes = () => click('.export-prop-controls input');
  const waitForPng = () =>
    h.until(
      () => run(`!!document.querySelector('.export-preview img')`),
      'Updated PNG did not render',
    );

  const pressed = (label: string) =>
    run<string | null>(
      `document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})?.getAttribute('aria-pressed') ?? null`,
    );

  await select('ProjectCard');
  await click('[aria-label="Focus subtree"]');
  await h.until(() => run(`!!document.querySelector('.focus-navigation')`), 'Focus did not open');
  await idle();
  await select('ProjectCard');

  // Include the card's props, open `project`, and hide one of its values.
  await click('[aria-label="Include in image"]');
  assert.equal(await pressed('Include in image'), 'true');
  await h.until(
    () => run(`!!document.querySelector('[data-prop-path="props.project"] > summary')`),
    'Card props did not load',
  );
  await click('[data-prop-path="props.project"] > summary');
  await h.until(
    () => run(`!!document.querySelector('[aria-label="Hide description in props card"]')`),
    'Nested props did not load',
  );
  assert.equal(await pressed('Hide description in props card'), 'false');
  await click('[aria-label="Hide description in props card"]');
  // The label stays the same; aria-pressed says whether the value is hidden.
  assert.equal(await pressed('Hide description in props card'), 'true');
  assert(
    await run(`document.querySelector('[data-prop-path="props.project"]').open`),
    'Hiding a value toggled its parent',
  );

  await select('ProgressBar');
  await h.until(
    () => run(`!!document.querySelector('[data-prop-path="props.progress"]')`),
    'ProgressBar props did not load',
  );
  await click('[aria-label="Include in image"]');
  // The card draws what the inspector showed, reported once it renders.
  await new Promise((resolve) => setTimeout(resolve, 200));

  // The panel follows the DevTools theme; exported images are always light.
  await run(`document.documentElement.dataset.theme='dark'`);
  await openExport();

  const composition = await run<{
    tags: string[];
    overlapping: string;
    cards: string[];
    notes: string;
  }>(`(()=>{
    const tags=Array.from(document.querySelectorAll('.export-tag'));
    const rects=tags.map(t=>t.getBoundingClientRect());
    const overlapping=rects.flatMap((a,i)=>rects.slice(i+1).flatMap((b,j)=>a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom?[tags[i].textContent+' '+JSON.stringify(a.toJSON())+' / '+tags[i+1+j].textContent+' '+JSON.stringify(b.toJSON())]:[])).join('\\n');
    return {
      tags:tags.map(t=>t.textContent),
      overlapping,
      cards:Array.from(document.querySelectorAll('.export-card')).map(c=>c.textContent),
      notes:document.querySelector('.export-notes').textContent,
    };
  })()`);

  assert(composition.tags.includes('1ProjectCardOrbit design system'), composition.tags.join());
  assert(composition.tags.includes('2ProgressBar'), composition.tags.join());
  assert(!composition.overlapping, 'Name tags overlap:\n' + composition.overlapping);
  assert.equal(composition.cards.length, 2);
  assert(composition.cards[0].startsWith('1ProjectCard'));

  for (const text of [
    'project: Object',
    'name: "Orbit design system"',
    'description: •••••• hidden',
  ]) {
    assert(composition.cards[0].includes(text), `Card is missing ${text}`);
  }

  assert(!composition.cards[0].includes('A shared language'), 'A hidden value was exported');
  assert(composition.cards[1].includes('progress: 72'), composition.cards[1]);
  assert(!composition.notes.includes('could not be read'), composition.notes);
  assert(
    composition.notes.includes('Props cards: 1 ProjectCard (1 hidden), 2 ProgressBar.'),
    composition.notes,
  );
  // The hidden description is also drawn on the card's layer.
  assert(composition.notes.includes('also appears in the page text'), composition.notes);
  assert((await exported()).footer.includes('Props reviewed'), 'The footer has no props time');

  // 100% shows the image at its layout size, to proofread it.
  await click('.export-dialog-heading [aria-pressed="false"]');
  assert.equal(
    await run(`document.querySelector('.export-preview.actual-size img').offsetWidth`),
    await run(`document.querySelector('.export-composition').offsetWidth`),
  );
  await click('.export-dialog-heading [aria-pressed="false"]');

  const png = await run<{
    width: number;
    height: number;
    expected: [number, number];
    corner: number[];
    red: number;
    type: string;
  }>(`(async()=>{
    const img=document.querySelector('.export-preview img');
    const blob=await (await fetch(img.src)).blob();
    const bitmap=await createImageBitmap(blob);
    const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);
    const context=canvas.getContext('2d');
    context.drawImage(bitmap,0,0);
    const data=context.getImageData(0,0,bitmap.width,bitmap.height).data;
    let red=0;
    for(let i=0;i<data.length;i+=4){if(data[i]>200&&data[i+1]<70&&data[i+2]<80)red++;}
    const root=document.querySelector('.export-composition');
    return {width:bitmap.width,height:bitmap.height,expected:[root.offsetWidth*2,root.offsetHeight*2],corner:Array.from(data.slice(0,3)),red,type:blob.type};
  })()`);

  assert.equal(png.type, 'image/png');
  assert.deepEqual([png.width, png.height], png.expected);
  assert(
    png.corner.every((channel) => channel > 230),
    `The image follows the dark panel theme: ${png.corner}`,
  );
  assert(png.red > 200, `The page's same-origin image is missing (${png.red} pixels)`);

  await toggleTypes();
  let cards = await exported();
  assert(cards.cards[0].includes('name: string') && cards.cards[0].includes('people: Array'));
  assert(cards.cards[0].includes('description: •••••• hidden'));
  assert(cards.cards[1].includes('progress: number'));
  await setNesting('collapsed');
  cards = await exported();
  assert(cards.cards[0].endsWith('project: Object'));
  assert(cards.cards[1].includes('progress: number'));
  assert(!cards.notes.includes('(1 hidden)'));
  assert(cards.notes.includes('also appears in the page text'));
  await toggleTypes();
  cards = await exported();
  assert(cards.cards[0].endsWith('project: Object'));
  assert(cards.cards[1].includes('progress: 72'));
  await setNesting('inspected');
  assert.deepEqual((await exported()).cards, composition.cards);

  // Change settings again while the previous PNG may still be rendering.
  await setNesting('collapsed');
  assert(
    await run(`(async () => {
    document.querySelector('.export-prop-controls input').click();
    await Promise.resolve();
    return !document.querySelector('.export-preview img') &&
      [...document.querySelectorAll('.export-actions button')].every(button => button.disabled);
  })()`),
    'The old PNG could still be exported',
  );
  await waitForPng();
  const previewHash = await run<string>(`(async () => {
    const img = document.querySelector('.export-preview img');
    await img.decode();
    if (img.naturalHeight >= ${png.height}) throw Error('Collapsed PNG did not shrink');
    const data = await (await fetch(img.src)).arrayBuffer();
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
  })()`);

  // Copying needs a focused document and a user gesture, as in a real click.
  await h.send('Emulation.setFocusEmulationEnabled', { enabled: true }, session);
  await h.send('Emulation.setFocusEmulationEnabled', { enabled: true }, panelSession);
  await h.evaluate(
    `(()=>{
      const find=(root)=>{for(const el of root.querySelectorAll('*')){if(el.tagName==='IFRAME'&&/panel\\.html/.test(el.src))return el;if(el.shadowRoot){const found=find(el.shadowRoot);if(found)return found;}}return null;};
      find(document)?.focus();
    })()`,
    session,
  );
  await h.send(
    'Runtime.evaluate',
    {
      expression: `document.querySelector('.export-actions .primary').click()`,
      userGesture: true,
    },
    panelSession,
  );
  await h.until(
    () => run(`document.querySelector('.export-status').textContent.startsWith('Copied')`),
    'Copy image failed',
  );

  await h.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloads,
    eventsEnabled: true,
  });
  await run(
    `Array.from(document.querySelectorAll('.export-actions button')).find(b=>b.textContent==='Download PNG').click()`,
  );

  const file = join(downloads, 'react-anatomy-ProjectCard.png');

  await h.until(
    async () => (await readdir(downloads)).includes('react-anatomy-ProjectCard.png'),
    'Download PNG failed',
  );
  await h.until(async () => (await readFile(file)).length > 1000, 'Download did not finish');
  assert.deepEqual([...(await readFile(file)).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(
    createHash('sha256')
      .update(await readFile(file))
      .digest('hex'),
    previewHash,
  );
  await copyFile(file, 'artifacts/export.png');

  await closeExport();

  // E opens the dialog too.
  await run(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'e'}))`);
  await h.until(() => run(`!!document.querySelector('dialog[open]')`), 'E did not open export');
  await closeExport();

  // Choices belong to components, not to one focused capture.
  await click('.focus-navigation button');
  await idle();
  await select('ProjectCard');
  assert.equal(await pressed('Include in image'), 'true');

  // Excluding and including again keeps the hidden value hidden.
  await click('[aria-label="Include in image"]');
  await click('[aria-label="Include in image"]');
  await h.until(
    () => run(`!!document.querySelector('[aria-label="Hide description in props card"]')`),
    'Card props did not reload',
  );
  assert.equal(await pressed('Hide description in props card'), 'true');

  // A hidden array entry stays hidden when another item takes its place.
  await select('PropsFixture');
  await click('[aria-label="Include in image"]');
  await h.until(
    () => run(`!!document.querySelector('[data-prop-path="props.items"] > summary')`),
    'Fixture props did not load',
  );
  await click('[data-prop-path="props.items"] > summary');
  await h.until(
    () => run(`!!document.querySelector('[aria-label="Hide 0 in props card"]')`),
    'Items did not load',
  );
  await click('[aria-label="Hide 0 in props card"]');
  await page.evaluate(() => window.prependInspectedItem!());

  // The image still draws what was reviewed, and says the props changed.
  await openExport();

  let state = await exported();

  assert(
    state.cards.some((card) => card.includes('0: •••••• hidden')),
    state.cards.join('\n'),
  );
  assert(state.notes.includes('props changed after you reviewed them'), state.notes);
  await setNesting('collapsed');
  assert(
    (await exported()).notes.includes('props changed after you reviewed them'),
    'Array size changed',
  );
  await toggleTypes();
  assert(
    !(await exported()).notes.includes('props changed after you reviewed them'),
    'A change outside the displayed rows was reported',
  );
  await setNesting('inspected');
  assert(
    (await exported()).notes.includes('props changed after you reviewed them'),
    'The visible mask changed',
  );
  await closeExport();

  // Reading them again finds another value at the hidden position: the whole
  // collection is masked until the author checks it.
  await click('[aria-label="Refresh props"]');
  await h.until(() => run(`!!document.querySelector('.props-stale')`), 'Change was not flagged');
  await openExport();
  state = await exported();
  assert(
    state.cards.some((card) => card.includes('masked: changed after a value was hidden')),
    state.cards.join('\n'),
  );
  assert(!state.cards.some((card) => card.includes('0: Object')), 'A masked collection leaked');
  assert(state.notes.includes('a collection changed after you hid a value'), state.notes);
  await setNesting('collapsed');
  assert(!(await exported()).notes.includes('a collection changed after you hid a value'));
  await closeExport();
  await run(
    `Array.from(document.querySelectorAll('.props-stale button')).find(b=>b.textContent==='Keep hidden values').click()`,
  );
  await h.until(() => run(`!document.querySelector('.props-stale')`), 'Keep did not confirm');

  // Component IDs restart when the page agent restarts, as after a reload.
  // Choices from the old document must not attach to whichever component
  // inherits an ID.
  const capture = await run<string>(`document.querySelector('.footer-count').textContent`);

  await page.evaluate(() => {
    delete (window as { __REACT_ANATOMY_INSPECTOR_V1__?: unknown }).__REACT_ANATOMY_INSPECTOR_V1__;
  });
  await h.until(
    () => run(`document.querySelector('.footer-count')?.textContent!==${JSON.stringify(capture)}`),
    'The panel did not notice the new document',
    10000,
  );
  await idle();
  await select('ProjectCard');
  assert.equal(await pressed('Include in image'), 'false');
  await openExport();
  assert((await exported()).notes.includes('No props cards'), 'Old choices reached the image');
  assert(!(await run(`!!document.querySelector('.export-prop-controls')`)));
  await closeExport();

  console.log(
    `Exported a ${png.width} × ${png.height} PNG with names, chosen props, and a page image.`,
  );
} finally {
  await h.close();
  await fixture.close();
  await rm(downloads, { recursive: true, force: true });
}

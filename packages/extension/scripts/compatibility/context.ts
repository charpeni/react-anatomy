import type { ValidationCase } from './types.ts';
import assert from 'node:assert/strict';

type Harness = {
  until: <T>(
    fn: () => T | Promise<T>,
    message: string,
    timeout?: number,
  ) => Promise<Exclude<T, null | undefined | false>>;
  page: <T = unknown>(expression: string) => Promise<T>;
  panel: <T = unknown>(expression: string) => Promise<T>;
  clickPage: (selector: string) => Promise<void>;
};

type Reader = { id: string; evidence: string; current: boolean; tags: string[] };

// Context readers depend on private Fiber fields and on React's commit hook, so
// every pinned React version checks them. Expects the issue card, which reads
// the workspace's one app-defined context, to be selected.
export async function checkContextReaders(
  h: Harness,
  item: ValidationCase,
  click: (label: string) => Promise<void>,
  pickIssue: () => Promise<void>,
) {
  const readers = () =>
    h.panel<Reader[]>(
      `[...document.querySelectorAll('[aria-labelledby="context-readers-heading"] .context-row')].map(el=>({id:el.dataset.contextInstance,evidence:el.querySelector('.context-row-evidence')?.textContent||'',current:el.getAttribute('aria-current')==='true',tags:[...el.querySelectorAll('.context-tag')].map(tag=>tag.textContent)}))`,
    );

  const evidence = () =>
    h.panel<string>(`document.querySelector('.context-evidence')?.textContent||''`);

  const selected = () =>
    h.panel<string>(`document.querySelector('.tree-row.selected .tree-select')?.dataset.tree`);

  const provider = () =>
    h.panel<{ group: string; text: string } | null>(
      `(()=>{const option=document.querySelector('[aria-label="Context provider"]')?.selectedOptions[0];return option?{group:option.parentElement.label,text:option.textContent}:null;})()`,
    );

  // The section is closed until the user asks for it, and then stays open.
  await h.panel(
    `(()=>{const section=document.querySelector('.context-readers');if(!section.open)section.querySelector('summary').click();return true;})()`,
  );
  await h.until(
    () =>
      h.panel(
        `document.querySelectorAll('[aria-label="Context provider"] option').length>0&&Boolean(document.querySelector('.context-evidence'))`,
      ),
    'Context providers did not load for the selected component',
  );

  const error = await h.panel(
    `document.querySelector('.context-readers .props-error')?.textContent||null`,
  );

  assert(!error, String(error));

  if (item.kind === 'next') {
    return ['context providers'];
  }

  // The provider the selected component reads is preselected, and its only
  // reader is that exact instance.
  const issue = await selected();
  const chosen = await provider();

  assert(
    chosen && chosen.group.startsWith('Read by '),
    'The provider this component reads was not chosen',
  );
  assert(chosen.text.endsWith(' · 1 reader'), `Unexpected reader count: ${chosen.text}`);
  assert.deepEqual(await readers(), [{ id: issue, evidence: '', current: true, tags: ['memo'] }]);
  assert((await evidence()).startsWith('Evidence: dependencies.'));

  // No hook was installed with the app, so counting needs the opt-in reload.
  assert.equal(await h.page(`typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__`), 'undefined');

  const before = await h.panel(`document.querySelector('.footer-count').textContent`);

  await click('Reload page to measure renders');
  await h.until(
    () =>
      h.panel(
        `document.querySelector('.footer-count')?.textContent!==${JSON.stringify(before)}&&document.querySelector('[aria-label="Capture"]')?.disabled===false`,
      ),
    'The panel did not reconnect after the reload',
    30000,
  );
  await h.until(
    () => h.page(`window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers.size>0`),
    'React did not find the commit hook',
  );
  await pickIssue();
  await h.until(async () => (await readers()).length === 1, 'Context readers did not reload');
  await click('Record renders');
  await h.until(
    async () => (await evidence()).startsWith('Evidence: measured renders.'),
    'Recording did not start',
  );
  // A state update in the reader: it renders once, with the same context value.
  await h.clickPage('[data-check="counter"]');
  await h.until(
    async () => (await readers())[0]?.evidence === '1 render · 0 with a new value',
    'The measured render does not match the one state update',
  );
  assert((await evidence()).includes('1 commit, 0 with a new provider value'));
  await click('Stop recording');
  await h.until(
    async () => (await evidence()).includes('Recorded 1 commit'),
    'Recording did not stop',
  );

  return ['context readers', 'measured renders'];
}

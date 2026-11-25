import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { launchFirefox } from './firefox-harness.ts';
import { startFixtureServer } from './fixture-server.ts';

// "Trace in source" in the native Firefox panel. The Chrome check covers the
// cases in depth; this confirms that loading a file, joining an instance to
// its call site, and stale detection work with Firefox's page evaluation.

const fixture = await startFixtureServer();
let h!: Awaited<ReturnType<typeof launchFirefox>>;

try {
  h = await launchFirefox();
  await mkdir(`artifacts/firefox/${h.version}`, { recursive: true });
  await h.navigate(fixture.url + '/source-trace');
  await h.until(
    () => h.page(`Boolean(document.querySelector('.ticket'))`),
    'Fixture did not mount',
  );
  await h.openPanel();

  const run = <T = unknown>(expression: string) => h.panel<T>(expression);
  const section = () => run<string>(`document.querySelector('.source-trace')?.textContent||''`);
  const waitFor = (text: string) =>
    h.until(async () => (await section()).includes(text), `Missing: ${text}`);
  const select = async (name: string) => {
    await h.until(
      () =>
        run(
          `(()=>{const el=[...document.querySelectorAll('.tree-select')].find(el=>el.querySelector('.node-name').textContent===${JSON.stringify(name)});if(!el)return false;el.click();return true;})()`,
        ),
      `Missing component: ${name}`,
    );
    await h.until(
      () =>
        run(
          `document.querySelector('.inspector-heading h2')?.textContent===${JSON.stringify(name)}`,
        ),
      `${name} was not selected`,
    );
  };
  // A native file dialog cannot be driven; hand the same input a File instead.
  const load = async (path: string) =>
    run(
      `(()=>{const input=document.querySelector('.trace-file');const data=new DataTransfer();data.items.add(new File([${JSON.stringify(await readFile(path, 'utf8'))}],${JSON.stringify(path.split('/').pop())},{type:'application/json'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
    );
  const trace = async (name: string) => {
    await run(
      `(()=>{const el=document.querySelector('[aria-label="Prop to trace"]');el.value=${JSON.stringify(name)};el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
    );
    await h.until(
      () => run(`document.querySelector('.trace-key')?.textContent===${JSON.stringify(name)}`),
      `The trace for ${name} did not appear`,
    );

    return run<{ text: string; scope: string }>(
      `(()=>{const el=document.querySelector('.trace-verdict');return {text:el.querySelector('strong').textContent,scope:el.dataset.scope};})()`,
    );
  };

  await select('TicketRow');
  await run(`(()=>{document.querySelector('.source-trace > summary').click();return true;})()`);
  await waitFor('Load a local source analysis to find where');
  await load('dist/source-trace-report.json');
  await waitFor('Call site verified.');
  assert.deepEqual(await trace('onDismiss'), {
    text: 'Used here, only in a deferred event handler',
    scope: 'build',
  });
  assert((await section()).includes('Queue passes its own prop onResolve on under a new name'));
  await select('Queue');
  await waitFor('Call site verified.');
  assert.deepEqual(await trace('density'), {
    text: 'Forwarded, no consumer found in analyzed code',
    scope: 'build',
  });
  assert((await section()).includes('3 mounted below'));
  await h.screenshot(`artifacts/firefox/${h.version}/source-trace.png`);
  await load('dist/source-trace-report-edited-leaf.json');
  await waitFor('(QueueFooter.tsx edited)');
  assert.equal((await trace('density')).scope, 'source');
  await waitFor('Not verified against this build.');
  await load('dist/source-trace-report-edited.json');
  await waitFor('(Queue.tsx edited)');
  await select('TicketRow');
  await waitFor('Out of date.');
  assert.equal(await run(`document.querySelector('.trace-result')`), null);
  console.log(
    'Passed: Firefox source trace loading, verified call site, rename, closed chain, changed leaf, and stale build.',
  );
} finally {
  await h?.close();
  await fixture.close();
}

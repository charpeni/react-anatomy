import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pageAgent } from '../src/inspector/page-agent.ts';
import { SOURCE_REGISTRY_KEY } from '../src/source-trace/report.ts';
import { launchExtension, openDevtoolsPanel } from './chrome-harness.ts';
import { startFixtureServer } from './fixture-server.ts';

// Drives "Trace in source" in the real DevTools panel against the fixture
// built by scripts/source-trace/build-fixture.ts. The analysis files loaded
// here are the analyzer's own output for that fixture's source.

await mkdir('artifacts', { recursive: true });
assert(
  pageAgent.toString().includes(`'${SOURCE_REGISTRY_KEY}'`),
  'The page agent and the build plugin disagree on the metadata global',
);

const fixture = await startFixtureServer();
const h = await launchExtension();

try {
  const page = h.context.pages()[0];
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(fixture.url + '/source-trace');
  await page.getByRole('button', { name: 'Refresh queue' }).waitFor();

  const { session, panelSession } = await openDevtoolsPanel(h);
  const run = <T = unknown>(expression: string) => h.evaluate<T>(expression, panelSession);
  const section = () => run<string>(`document.querySelector('.source-trace').textContent`);
  const waitFor = (text: string, message = `Missing: ${text}`) =>
    h.until(async () => (await section()).includes(text), message);
  const select = (name: string, position = 0) =>
    run(
      `Array.from(document.querySelectorAll('.tree-select')).filter(el=>el.querySelector('.node-name').textContent===${JSON.stringify(name)})[${position}].click()`,
    );
  const heading = () => run<string>(`document.querySelector('.inspector-heading h2').textContent`);
  const loadFile = async (path: string) => {
    const { root } = await h.send('DOM.getDocument', {}, panelSession);
    const { nodeId } = await h.send(
      'DOM.querySelector',
      { nodeId: root.nodeId, selector: '.trace-file' },
      panelSession,
    );

    await h.send('DOM.setFileInputFiles', { files: [resolve(path)], nodeId }, panelSession);
  };
  const traceProp = async (name: string) => {
    await run(
      `(()=>{const el=document.querySelector('[aria-label="Prop to trace"]');el.value=${JSON.stringify(name)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await h.until(
      () => run(`document.querySelector('.trace-key')?.textContent===${JSON.stringify(name)}`),
      `The trace for ${name} did not appear`,
    );
  };
  const verdict = () =>
    run<{ text: string; scope: string; verdict: string }>(
      `(()=>{const el=document.querySelector('.trace-verdict');return {text:el.querySelector('strong').textContent,scope:el.dataset.scope,verdict:el.dataset.verdict};})()`,
    );
  const marks = () =>
    run<string[]>(
      `Array.from(document.querySelectorAll('.trace-result mark')).map(el=>el.textContent)`,
    );
  const locations = () =>
    run<string[]>(
      `Array.from(document.querySelectorAll('.trace-result .trace-location')).map(el=>el.textContent)`,
    );
  const shot = async (name: string) => {
    const image = await h.send('Page.captureScreenshot', { format: 'png' }, session);

    await writeFile(`artifacts/source-trace-${name}.png`, Buffer.from(image.data, 'base64'));
  };

  await h.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false },
    session,
  );
  await h.until(
    () =>
      run(
        `Array.from(document.querySelectorAll('.node-name')).some(n=>n.textContent==='TicketRow')`,
      ),
    'The fixture was not captured',
  );
  await select('TicketRow');
  await h.until(async () => (await heading()) === 'TicketRow', 'TicketRow was not selected');

  // Opt-in: closed, and nothing is asked of the page before an analysis is loaded.
  assert.equal(await run(`document.querySelector('.source-trace').open`), false);
  await run(
    `(()=>{const original=chrome.devtools.inspectedWindow.eval;globalThis.sourceCalls=0;chrome.devtools.inspectedWindow.eval=(expression,callback)=>{if(expression.includes('"action":"source-evidence"')){globalThis.sourceCalls++;}return original(expression,callback);};})()`,
  );
  await run(`document.querySelector('.source-trace > summary').click()`);
  await waitFor('Load a local source analysis to find where');
  await select('Queue');
  await select('TicketRow');
  assert.equal(await run(`globalThis.sourceCalls`), 0, 'The page was read before opting in');
  assert.equal(await run(`document.querySelector('.trace-association')`), null);

  // A file that is not an analysis is refused.
  await loadFile('package.json');
  await waitFor('This file is not a React Anatomy source analysis.');

  await loadFile('dist/source-trace-report.json');
  await waitFor('Call site verified.');
  assert((await section()).includes('support-desk fixture'), 'The loaded analysis is not named');
  assert(!(await section()).includes('not a React Anatomy source analysis'));
  assert.equal(
    await run(`document.querySelector('.trace-association .trace-location').textContent`),
    'Queue.tsx:22:9',
  );
  assert.equal(
    await run(`document.querySelector('.trace-association mark').textContent`),
    '<TicketRow',
  );
  assert.equal(await run(`document.querySelector('.trace-result')`), null);

  // Ordinary entry point: clicking a prop in the Props inspector traces it.
  await h.until(
    () => run(`document.querySelector('[data-prop-path="props.onDismiss"]')!==null`),
    'Props did not load',
  );
  await run(`document.querySelector('[data-prop-path="props.onDismiss"]').click()`);
  await h.until(
    () => run(`document.querySelector('.trace-key')?.textContent==='onDismiss'`),
    'Clicking a prop did not trace it',
  );
  assert.deepEqual(await verdict(), {
    text: 'Used here, only in a deferred event handler',
    scope: 'build',
    verdict: 'used',
  });

  const dismiss = await section();

  for (const text of [
    'Queue passes its own prop onResolve on under a new name, onDismiss.',
    'DeskApp passes the function resolveTicket, created here with useCallback().',
    'Starts here: the function resolveTicket, created here with useCallback().',
    'In an event handler. Runs later, when the event fires.',
    'Checked against the running build',
  ]) {
    assert(dismiss.includes(text), `Missing in the onDismiss trace: ${text}`);
  }

  assert.deepEqual(await marks(), [
    'onDismiss={onResolve}',
    'onResolve={resolveTicket}',
    'resolveTicket',
    'onDismiss(ticket.id)',
  ]);
  assert.deepEqual(await locations(), [
    'Queue.tsx:25:11',
    'DeskApp.tsx:33:9',
    'DeskApp.tsx:13:9',
    'TicketRow.tsx:22:57',
  ]);
  await shot('renamed-handler');

  await run(`document.querySelector('[aria-label="Focus subtree"]').click()`);
  await h.until(
    () =>
      run(
        `!!document.querySelector('.focus-navigation') && !Array.from(document.querySelectorAll('.node-name')).some(el => el.textContent === 'Queue') && !!document.querySelector('[aria-label="Select the mounted Queue"]')`,
      ),
    'The focused capture did not expose the uncaptured owner',
  );
  await run(`document.querySelector('[aria-label="Select the mounted Queue"]').click()`);
  await waitFor('outside the current capture');
  assert.equal(await heading(), 'TicketRow');
  assert.equal(await run(`document.querySelector('.trace-key')?.textContent`), 'onDismiss');
  assert.deepEqual(await marks(), [
    'onDismiss={onResolve}',
    'onResolve={resolveTicket}',
    'resolveTicket',
    'onDismiss(ticket.id)',
  ]);
  await run(`document.querySelector('.focus-navigation button').click()`);
  await h.until(
    () =>
      run(
        `!document.querySelector('.focus-navigation') && Array.from(document.querySelectorAll('.node-name')).some(el => el.textContent === 'Queue')`,
      ),
    'Whole page capture did not return',
  );
  await select('TicketRow');
  await waitFor('Call site verified.');

  // Projected values and mixed use on the same component.
  await traceProp('ticket');
  assert.equal((await verdict()).text, 'Used here');

  const ticket = await section();

  for (const text of [
    'Queue passes each item of its prop tickets as ticket.',
    'DeskApp passes tickets, from useState() in this component.',
    'A property read from it is passed to <PriorityBadge> as level.',
    'A property read from it is passed to <TicketMeta> as updated.',
    'Passed to onDismiss(). In an event handler.',
  ]) {
    assert(ticket.includes(text), `Missing in the ticket trace: ${text}`);
  }

  // A receiver that is given a prop it never reads.
  await traceProp('auditTag');
  assert.deepEqual(await verdict(), {
    text: 'Received, unused here',
    scope: 'build',
    verdict: 'unused',
  });
  assert((await section()).includes('Nothing in TicketRow reads auditTag or passes it on.'));

  // Up the verified chain: the mounted Queue that created this row.
  await traceProp('density');
  assert.equal((await verdict()).text, 'Forwarded, no consumer found in analyzed code');
  await run(`document.querySelector('[aria-label="Select the mounted Queue"]').click()`);
  await h.until(async () => (await heading()) === 'Queue', 'The mounted Queue was not selected');
  await waitFor('Call site verified.');
  await h.until(
    () => run(`document.querySelector('.trace-key')?.textContent==='density'`),
    'The traced prop was not carried to the ancestor',
  );
  assert.deepEqual(await verdict(), {
    text: 'Forwarded, no consumer found in analyzed code',
    scope: 'build',
    verdict: 'forwarded',
  });

  const density = await section();

  for (const text of [
    'TicketRow · density Forwarded, no consumer found in analyzed code',
    'TicketMeta · density Received, unused here',
    'QueueFooter · density Received, unused here',
    '3 mounted below',
    'Starts here: density, from useState() in this component.',
  ]) {
    assert(density.includes(text), `Missing in the density trace: ${text}`);
  }

  await shot('closed-chain');

  // The same shape with a consumer, and a mixed use.
  await traceProp('revision');
  assert.equal((await verdict()).text, 'Forwarded only here');
  await traceProp('title');
  assert.equal((await verdict()).text, 'Used and forwarded');
  await traceProp('onResolve');
  assert.equal((await verdict()).text, 'Forwarded only here');
  assert((await section()).includes('To <TicketRow>, renamed to onDismiss.'));

  // Down the chain: one of the three mounted rows from this call site.
  await run(
    `document.querySelector('[aria-label="Select mounted TicketRow 2 of 3 and trace onDismiss"]').click()`,
  );
  await h.until(async () => (await heading()) === 'TicketRow', 'A mounted row was not selected');
  await h.until(
    () => run(`document.querySelector('.trace-key')?.textContent==='onDismiss'`),
    'The renamed prop was not traced on the row',
  );

  // Boundaries stay unknown.
  const unknowns: [string, string, string, string][] = [
    [
      'AssigneeChip',
      'tone',
      'Forwarded here, unknown beyond this point',
      'outside the analyzed files',
    ],
    [
      'AssigneeChip',
      'title',
      'Forwarded here, unknown beyond this point',
      'whose keys are not known from source',
    ],
    ['Summary', 'generatedAt', 'Unknown beyond this point', 'custom memo comparator'],
    ['AuditFooter', 'source', 'Unknown beyond this point', 'passed to useAuditTrail()'],
    [
      'Insights',
      'helpUrl',
      'Forwarded here, unknown beyond this point',
      'produced by withTracking',
    ],
  ];

  for (const [component, prop, text, detail] of unknowns) {
    await select(component);
    await h.until(async () => (await heading()) === component, `${component} was not selected`);
    await waitFor('Call site verified.');
    await traceProp(prop);
    assert.equal((await verdict()).text, text, `${component}.${prop}`);
    assert((await section()).includes(detail), `${component}.${prop} does not explain: ${detail}`);
  }

  await shot('unknown-boundary');

  // A component chosen at runtime has a stamp but no analyzed receiver.
  await select('CompactNote');
  await waitFor('Call site verified.');
  await traceProp('emphasis');
  assert.equal((await verdict()).text, 'Unknown beyond this point');
  assert((await section()).includes('The component is chosen by an expression'));

  // A receiver without analyzed source: the element is known, its use of the prop is not.
  await select('Tooltip');
  await h.until(async () => (await heading()) === 'Tooltip', 'Tooltip was not selected');
  await waitFor('Call site verified.');
  await traceProp('tone');
  assert.equal((await verdict()).text, 'Unknown beyond this point');

  const tooltip = await section();

  for (const text of [
    'AssigneeChip spreads its own props into <Tooltip>. tone passes through unchanged.',
    'Insights passes the literal "calm".',
    'Tooltip is implemented outside the analyzed files.',
  ]) {
    assert(tooltip.includes(text), `Missing in the Tooltip trace: ${text}`);
  }

  // A component that was handed another component's props object unchanged
  // does not inherit that component's call site.
  await select('Relay');
  await h.until(async () => (await heading()) === 'Relay', 'Relay was not selected');
  await waitFor('Call site verified.');
  await select('RelayTarget');
  await h.until(async () => (await heading()) === 'RelayTarget', 'RelayTarget was not selected');
  await waitFor('No call-site record for this instance.');
  assert.equal(await run(`document.querySelector('.trace-prop')`), null);

  // Two nested instances of one component. The label sits inside the inner
  // Frame but was created by the outer one, so its text comes from DeskApp.
  await select('FrameLabel');
  await h.until(async () => (await heading()) === 'FrameLabel', 'FrameLabel was not selected');
  await waitFor('Call site verified.');
  await traceProp('text');

  const framed = await section();

  assert(framed.includes('Frame passes its own prop label on under a new name, text.'));
  assert(
    framed.includes('DeskApp passes the literal "Outer frame".'),
    'The supplying Frame instance was not the one that created the label',
  );
  assert(!framed.includes('Inner frame'), 'The nearest Frame was taken for the creator');
  assert.equal(await page.locator('.frame-label').textContent(), 'Outer frame');

  // The page still works, and the trace read no prop values from it.
  const evidence = await page.evaluate<Record<string, unknown>>(
    `(()=>{${pageAgent.toString()};const capture=pageAgent({action:'capture'});const node=capture.nodes.find(n=>n.name==='TicketRow');return JSON.parse(JSON.stringify(pageAgent({action:'source-evidence',id:node.id})));})()`,
  );

  assert.deepEqual(Object.keys(evidence).sort(), [
    'ancestors',
    'ancestorsLimited',
    'creators',
    'descendants',
    'files',
    'limited',
    'metadata',
    'name',
    'ok',
    'propNames',
    'propNamesLimited',
    'self',
  ]);
  assert.deepEqual(evidence.propNames, [
    'ticket',
    'onDismiss',
    'density',
    'auditTag',
    'dueLabel',
    'ownerName',
  ]);
  assert(!JSON.stringify(evidence).includes('Export to CSV'), 'A prop value left the page');
  assert.equal(evidence.limited, false);
  assert.equal(evidence.ancestorsLimited, false);
  assert.equal(evidence.propNamesLimited, false);
  // React's development owner record: Queue created the row, DeskApp created the Queue.
  assert.deepEqual(evidence.creators, [0, 1]);
  await page.getByRole('button', { name: 'Resolve' }).first().click();
  await page.getByText('Resolved').first().waitFor();

  // Stale: the file that creates the rows was edited after the page was built.
  await loadFile('dist/source-trace-report-edited.json');
  await waitFor('(Queue.tsx edited)');
  await select('TicketRow');
  await waitFor('Out of date.');
  assert((await section()).includes('a different version of Queue.tsx'));
  assert.equal(
    await run(`document.querySelector('.trace-result')`),
    null,
    'A stale join was traced',
  );
  assert.equal(await run(`document.querySelector('.trace-prop')`), null);
  // The developer can still read the source trace by choosing the element.
  assert.equal(await run(`document.querySelectorAll('.trace-candidate').length`), 1);
  await run(`document.querySelector('.trace-candidate').click()`);
  await waitFor('Chosen by you.');
  await traceProp('auditTag');
  assert.deepEqual(await verdict(), {
    text: 'Received, unused here',
    scope: 'source',
    verdict: 'unused',
  });
  assert((await section()).includes('The only element in the analyzed source that renders Queue.'));
  await shot('stale');

  // A changed leaf below a parent whose own stamp is still current.
  await loadFile('dist/source-trace-report-edited-leaf.json');
  await waitFor('(QueueFooter.tsx edited)');
  await select('Queue');
  await waitFor('Call site verified.');
  await traceProp('density');
  await waitFor('Not verified against this build.');
  assert((await section()).includes('QueueFooter.tsx (changed since the analysis)'));
  assert.deepEqual(await verdict(), {
    text: 'Forwarded only here',
    scope: 'source',
    verdict: 'forwarded',
  });
  // A prop whose trace never reads the changed file is still checked against the build.
  await traceProp('title');
  assert.equal((await verdict()).scope, 'build');
  await shot('changed-leaf');

  // Replacing a report can still be reading the file when the user removes it.
  await run(`(() => {
    const read = File.prototype.text;
    File.prototype.text = async function () {
      File.prototype.text = read;
      const contents = await read.call(this);
      return new Promise(resolve => { globalThis.finishReportRead = () => resolve(contents); });
    };
  })()`);
  await loadFile('dist/source-trace-report.json');
  await h.until(
    () => run(`typeof globalThis.finishReportRead === 'function'`),
    'File read did not start',
  );
  await run(
    `Array.from(document.querySelectorAll('.source-trace button')).find(el=>el.textContent==='Remove').click()`,
  );
  await waitFor('Load a local source analysis to find where');

  await run(`globalThis.finishReportRead()`);
  await run(
    `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`,
  );
  assert(
    (await section()).includes('Load a local source analysis to find where'),
    'A removed analysis was restored by an older file read',
  );

  // The same app without build metadata: no instance claim from a name.
  await page.goto(fixture.url + '/source-trace-plain');
  await page.getByRole('button', { name: 'Refresh queue' }).waitFor();
  await h.until(
    () =>
      run(
        `Array.from(document.querySelectorAll('.node-name')).some(n=>n.textContent==='TicketRow')&&!document.querySelector('[aria-label="Capture"]').disabled`,
      ),
    'The plain fixture was not captured',
  );
  await select('TicketRow');
  await h.until(async () => (await heading()) === 'TicketRow', 'TicketRow was not selected');
  await loadFile('dist/source-trace-report.json');
  await waitFor('No source metadata on this page.');
  assert((await section()).includes('A name does not identify an instance.'));
  assert.equal(await run(`document.querySelector('.trace-result')`), null);
  assert.equal(await run(`document.querySelector('.trace-prop')`), null);
  await run(`document.querySelector('.trace-candidate').click()`);
  await waitFor('Chosen by you.');
  await traceProp('onDismiss');
  assert.deepEqual(await verdict(), {
    text: 'Used here, only in a deferred event handler',
    scope: 'source',
    verdict: 'used',
  });
  await shot('no-metadata');
  assert.equal(
    await page.evaluate(`'${SOURCE_REGISTRY_KEY}' in window`),
    false,
    'The inspector created the metadata global itself',
  );
  assert.deepEqual(errors, []);
  console.log(
    'Passed: opt-in loading, refused files, verified call site, prop click entry point, rename, deferred handler, projections, mixed use, unused receiver, closed chain, live ancestor and descendant selection, unknown boundaries, value-free evidence, stale build, changed leaf, and no-metadata manual match.',
  );
} finally {
  await h.close();
  await fixture.close();
}

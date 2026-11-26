import type { ReportSite, SourceReport } from '../src/source-trace/report.ts';
import type { TraceNode } from '../src/source-trace/trace.ts';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import ts from 'typescript';
import { build, type Plugin } from 'esbuild';
import { anatomySourcePlugin } from './source-trace/esbuild-plugin.ts';
import { parseReport, siteId, SOURCE_REGISTRY_KEY } from '../src/source-trace/report.ts';
import {
  associate,
  candidateSites,
  checkBuild,
  indexReport,
  liveOwners,
  propNames,
  staticOwners,
  traceProp,
} from '../src/source-trace/trace.ts';
import { analyzeSources } from './source-trace/analyze.ts';
import { fixtureFiles, fixtureRoot } from './source-trace/build-fixture.ts';
import { instrumentSource } from './source-trace/instrument.ts';
import { fileHash } from './source-trace/shared.ts';

// The analysis under test is produced here, from source, by the same analyzer
// a developer runs. Expected answers come from reading the fixture files.

const root = fixtureRoot;
const analyzed = fixtureFiles;
const report = analyzeSources({ root, files: analyzed.map((file) => `${root}/${file}`) });
const index = indexReport(report);

function only(source: SourceReport, tag: string, owner?: string) {
  const sites = source.sites.filter(
    (site) => site.tag === tag && (!owner || site.owner?.endsWith('#' + owner)),
  );

  assert.equal(sites.length, 1, `Expected one <${tag}> element, found ${sites.length}`);

  return sites[0];
}

const trace = (tag: string, key: string) =>
  traceProp(index, only(report, tag), key, staticOwners(index));

function chain(node: TraceNode | null): string[] {
  return node
    ? [
        `${node.component.name}.${node.key}:${node.verdict}`,
        ...node.forwards.flatMap((edge) => chain(edge.node)),
      ]
    : ['?'];
}

// The report survives the same validation the panel applies to a chosen file.
const parsed = parseReport(JSON.stringify(report));

assert(parsed.ok, 'The analyzer wrote a report the panel rejects');
assert.equal(parseReport('{"format":"something-else"}').ok, false);
assert.equal(parseReport('not json').ok, false);
assert.equal(parseReport(JSON.stringify({ ...report, version: 99 })).ok, false);
assert.equal(
  parseReport(JSON.stringify({ ...report, sites: [{ ...report.sites[0], attributes: [{}] }] })).ok,
  false,
  'A damaged site was accepted',
);
assert(!JSON.stringify(report).includes(process.cwd()), 'The report contains an absolute path');

// Explicit forwarding with a rename, ending in a deferred event handler.
const dismiss = trace('TicketRow', 'onDismiss');

assert.equal(dismiss.headline, 'Used here, only in a deferred event handler');
assert.deepEqual(
  dismiss.supply.steps.map((step) => [step.site.tag, step.key, step.supplied, step.found]),
  [
    ['TicketRow', 'onDismiss', 'attribute', 'start'],
    ['Queue', 'onResolve', 'attribute', 'only-site'],
  ],
);
assert.deepEqual(dismiss.supply.steps[0].origin, { type: 'prop', key: 'onResolve' });
assert.equal(dismiss.supply.end.kind, 'origin');
assert(
  dismiss.supply.end.kind === 'origin' &&
    dismiss.supply.end.origin.what === 'function' &&
    dismiss.supply.end.origin.span?.text.startsWith('const resolveTicket = useCallback('),
  'The origin of onDismiss is not the resolveTicket declaration',
);
assert.deepEqual(
  dismiss.flow!.uses.map((use) => [use.how, use.phase, use.span.text.slice(...use.span.mark)]),
  [['call', 'event', 'onDismiss(ticket.id)']],
);

// The relay: forwarded only, under a new name, and consumed downstream.
const resolve = trace('Queue', 'onResolve');

assert.equal(resolve.headline, 'Forwarded only here');
assert.deepEqual(chain(resolve.flow), ['Queue.onResolve:forwarded', 'TicketRow.onDismiss:used']);
assert.equal(
  resolve.flow!.forwards[0].flow.span.text.slice(...resolve.flow!.forwards[0].flow.span.mark),
  'onDismiss={onResolve}',
);

// Mixed use: read here and forwarded.
const title = trace('Queue', 'title');

assert.equal(title.headline, 'Used and forwarded');
assert.deepEqual(
  title.flow!.uses.map((use) => use.detail),
  ['sets aria-label on <section>'],
);
assert.deepEqual(chain(title.flow), ['Queue.title:used-forwarded', 'QueueHeader.title:used']);

// Projected and transformed values are not unchanged forwarding.
const tickets = trace('Queue', 'tickets');

assert.equal(tickets.flow!.verdict, 'used');
assert.equal(tickets.flow!.forwards.length, 0, 'A derived value was reported as forwarded');
assert.deepEqual(
  tickets.flow!.derives.map(({ flow, site }) => [site?.tag, flow.attr, flow.how]),
  [
    ['QueueHeader', 'count', 'projection'],
    ['TicketRow', 'ticket', 'item'],
    ['TicketRow', 'dueLabel', 'transform'],
    ['TicketRow', 'ownerName', 'projection'],
  ],
);

const ticket = trace('TicketRow', 'ticket');

assert.deepEqual(ticket.supply.steps[0].origin, {
  type: 'derived',
  keys: ['tickets'],
  how: 'item',
});
assert.deepEqual(
  ticket.flow!.uses.map((use) => [use.how, use.phase]),
  [
    ['condition', 'render'],
    ['render', 'render'],
    ['host-prop', 'render'],
    ['call-argument', 'event'],
  ],
);
assert.deepEqual(
  ticket.flow!.derives.map(({ flow, site }) => [site?.tag, flow.attr, flow.how]),
  [
    ['PriorityBadge', 'level', 'projection'],
    ['TicketMeta', 'updated', 'projection'],
  ],
);

// A receiver that is supplied a prop and never reads it.
const legacy = trace('PriorityBadge', 'legacyColor');

assert.equal(legacy.headline, 'Received, unused here');
assert.equal(legacy.supply.steps[0].supplied, 'attribute');
assert.equal(legacy.caveat, undefined);

const audit = trace('TicketRow', 'auditTag');

assert.equal(audit.headline, 'Received, unused here');
assert.deepEqual(
  audit.supply.steps.map((step) => step.site.tag),
  ['TicketRow', 'Queue'],
);

// A forwarded chain with two branches, both closed, and no consumer.
const density = trace('Queue', 'density');

assert.equal(density.headline, 'Forwarded, no consumer found in analyzed code');
assert.deepEqual(chain(density.flow), [
  'Queue.density:forwarded',
  'TicketRow.density:forwarded',
  'TicketMeta.density:unused',
  'QueueFooter.density:unused',
]);
assert.equal(density.flow!.consumer, 'none');
assert.equal(
  trace('TicketRow', 'density').headline,
  'Forwarded, no consumer found in analyzed code',
);
// The same shape with a consumer at the end is not a dead chain.
assert.equal(trace('Queue', 'revision').headline, 'Forwarded only here');

// Boundaries stay unknown.
const chipTone = trace('AssigneeChip', 'tone');

assert.equal(chipTone.headline, 'Forwarded here, unknown beyond this point');
assert.equal(chipTone.flow!.boundaries[0].reason, 'no-source');
assert.equal(chipTone.supply.steps[0].supplied, 'attribute');

const chipTitle = trace('AssigneeChip', 'title');

assert.equal(chipTitle.supply.steps[0].supplied, 'unlisted-spread');
assert.equal(chipTitle.supply.end.kind, 'unknown');
assert.notEqual(chipTitle.headline, 'Received, unused here');

const note = trace('Note', 'emphasis');

assert.equal(note.headline, 'Unknown beyond this point');
assert.equal(note.boundary?.reason, 'dynamic-component');
assert.equal(trace('TrackedHelpLink', 'campaign').boundary?.reason, 'wrapper');

const generatedAt = trace('StableSummary', 'generatedAt');

assert.equal(generatedAt.headline, 'Unknown beyond this point');
assert.equal(generatedAt.flow!.boundaries[0].reason, 'custom-comparator');

const source = trace('AuditFooter', 'source');

assert.equal(source.headline, 'Unknown beyond this point');
assert.equal(source.flow!.boundaries[0].reason, 'props-escape');
assert.equal(
  trace('AuditFooter', 'revision').caveat,
  'Some paths from here could not be analyzed.',
);

// One open branch keeps the whole chain open.
const helpUrl = trace('Insights', 'helpUrl');

assert.equal(helpUrl.headline, 'Forwarded here, unknown beyond this point');
assert.equal(helpUrl.flow!.consumer, 'unknown');
// A consumer on one branch is reported even when another branch is unknown.
assert.equal(trace('Insights', 'revision').headline, 'Forwarded only here');
assert.deepEqual(propNames(index, only(report, 'TicketRow')), [
  'ticket',
  'onDismiss',
  'density',
  'auditTag',
  'dueLabel',
  'ownerName',
]);

// The developer path: the command writes the same analysis to a file.
const out = join(await mkdtemp(join(tmpdir(), 'react-anatomy-trace-')), 'trace.json');
const cli = spawnSync(
  process.execPath,
  [
    'scripts/source-trace/cli.ts',
    '--root',
    root,
    '--out',
    out,
    ...analyzed.map((file) => `${root}/${file}`),
  ],
  { encoding: 'utf8' },
);

assert.equal(cli.status, 0, cli.stderr);
assert.match(
  cli.stdout,
  /Analyzed 9 files: 16 components, \d+ component elements \(5 unresolved\)/,
);

const written = parseReport(await readFile(out, 'utf8'));

assert(written.ok);
// The command sorts its input, so only the order of files may differ.
const byPath = (source: SourceReport) => source.files.map((file) => file.path + file.hash).sort();
const writtenIndex = indexReport(written.report);

assert.deepEqual(byPath(written.report), byPath(report));
assert.deepEqual(
  written.report.sites.map((site) => site.id).sort(),
  report.sites.map((site) => site.id).sort(),
);
assert.equal(
  traceProp(writtenIndex, only(written.report, 'Queue'), 'density', staticOwners(writtenIndex))
    .headline,
  'Forwarded, no consumer found in analyzed code',
);
await rm(out);
// A directory is searched, and files outside --root are refused.
assert.equal(
  spawnSync(
    process.execPath,
    ['scripts/source-trace/cli.ts', '--root', root, '--out', out, 'src'],
    {
      encoding: 'utf8',
    },
  ).status,
  1,
);
assert.equal(spawnSync(process.execPath, ['scripts/source-trace/cli.ts']).status, 1);

const aliasRoot = await mkdtemp(join(tmpdir(), 'anatomy-alias-'));
try {
  const leaf = join(aliasRoot, 'Button.tsx');
  const app = join(aliasRoot, 'App.tsx');
  await writeFile(leaf, 'export function Button() { return <button /> }');
  await writeFile(
    app,
    "import { Button } from '@/Button'; export function App() { return <Button /> }",
  );
  await writeFile(
    join(aliasRoot, 'paths.json'),
    JSON.stringify({ compilerOptions: { lib: ['es2025', 'dom'], paths: { '@/*': ['./*'] } } }),
  );
  const tsconfig = join(aliasRoot, 'tsconfig.json');
  // Import resolution can use inherited paths even when this compiler predates the app's options.
  await writeFile(
    tsconfig,
    JSON.stringify({
      extends: './paths.json',
      compilerOptions: { target: 'es2025', someNewerOption: true },
    }),
  );
  const aliases = analyzeSources({ root: aliasRoot, files: [app, leaf] });
  assert.equal(only(aliases, 'Button').target, 'Button.tsx#Button');
  assert.equal(only(analyzeSources({ root: aliasRoot, files: [app] }), 'Button').target, null);

  await writeFile(tsconfig, JSON.stringify({ extends: './missing-base.json' }));
  assert.throws(
    () => analyzeSources({ root: aliasRoot, files: [app, leaf] }),
    /missing-base\.json/,
  );
  assert.throws(
    () =>
      analyzeSources({ root: aliasRoot, files: [app], tsconfig: join(aliasRoot, 'absent.json') }),
    /absent\.json/,
  );
  await writeFile(tsconfig, JSON.stringify({ compilerOptions: { paths: 42 } }));
  assert.throws(() => analyzeSources({ root: aliasRoot, files: [app] }), /paths/);

  const virtual: Plugin = {
    name: 'virtual',
    setup(builder) {
      builder.onResolve({ filter: /^virtual:/ }, () => ({
        path: join(aliasRoot, 'routes.tsx'),
        namespace: 'routes',
      }));
      builder.onLoad({ filter: /.*/, namespace: 'routes' }, () => ({
        contents: 'export default 42;',
        loader: 'tsx',
      }));
    },
  };
  const anatomy = anatomySourcePlugin({ root: aliasRoot });
  for (const plugins of [
    [anatomy, virtual],
    [virtual, anatomy],
  ]) {
    const result = await build({
      stdin: { contents: "export {default} from 'virtual:routes.tsx'" },
      bundle: true,
      write: false,
      plugins,
    });
    assert.match(result.outputFiles[0].text, /42/);
  }
} finally {
  await rm(aliasRoot, { recursive: true, force: true });
}

// ---- Controls: no false "unused" -------------------------------------------

const controlsRoot = 'scripts/fixtures/source-trace-controls';
const controls = analyzeSources({ root: controlsRoot, files: [`${controlsRoot}/controls.tsx`] });
const controlIndex = indexReport(controls);
const control = (tag: string, key: string) =>
  traceProp(controlIndex, only(controls, tag, 'Controls'), key, staticOwners(controlIndex));
for (const tag of ['WrappedInput', 'InlineRef']) {
  const ref = control(tag, 'ref').flow!;
  assert.equal(ref.verdict, 'unknown');
  assert.match(ref.boundaries[0].detail, /second argument/);
}
assert.equal(control('WrappedInput', 'label').flow!.verdict, 'used');
const [inlineSpread, namedSpread] = controls.sites.filter(
  (site) => site.tag === 'Leaf' && site.owner?.endsWith('#LiteralSpread'),
);
for (const [site, key, expected, kind] of [
  [inlineSpread, 'value', 'value', 'prop'],
  [inlineSpread, 'extra', 'item', 'prop'],
  [namedSpread, 'value', 'item', 'prop'],
  [namedSpread, 'extra', 'item', 'derived'],
] as const) {
  const { supply } = traceProp(controlIndex, site, key, staticOwners(controlIndex));
  assert.equal(supply.steps[0].origin?.type, kind);
  assert.equal(supply.steps[1]?.key, expected);
  assert.equal(supply.end.kind, 'origin');
}
const oldReport = structuredClone(controls);
const oldSite = oldReport.sites.find((site) => site.id === inlineSpread.id)!;
const spread = oldSite.attributes[0];
assert(spread.kind === 'spread' && spread.source.type === 'object');
delete spread.source.origins;
delete oldReport.tracksForwardRefSites;
const oldWrapped = only(oldReport, 'WrappedInput');
delete oldWrapped.forwardedRef;
assert.equal(
  traceProp(indexReport(oldReport), oldWrapped, 'ref', staticOwners(controlIndex)).flow?.verdict,
  'unknown',
);
assert(parseReport(JSON.stringify(oldReport)).ok);
assert.equal(
  traceProp(indexReport(oldReport), oldSite, 'value', staticOwners(controlIndex)).supply.end.kind,
  'unknown',
);

const recursive = only(controls, 'Tree', 'Tree');
const rootTree = only(controls, 'Tree', 'Controls');
const repeated = traceProp(
  controlIndex,
  recursive,
  'tag',
  (_owner, cursor = 0) => ({
    site: cursor < 2 ? recursive : rootTree,
    instance: 'parent' + cursor,
    cursor: cursor + 1,
    found: 'page',
  }),
  'selected',
);
assert.equal(repeated.supply.end.kind, 'origin');
assert.equal(repeated.supply.steps.length, 4);
const cycle = traceProp(controlIndex, recursive, 'tag', () => ({
  site: recursive,
  found: 'only-site',
}));
assert.equal(cycle.supply.steps.length, 1);
assert(cycle.supply.end.kind === 'unknown' && cycle.supply.end.detail.includes('recursive'));

const expected: Record<string, string> = {
  'Aliased.a': 'Forwarded only here',
  'Aliased.b': 'Received, unused here',
  'Branchy.flag': 'Used here',
  'Branchy.x': 'Forwarded only here',
  'SpreadFirst.value': 'Received, unused here',
  'SpreadFirst.extra': 'Forwarded, no consumer found in analyzed code',
  'SpreadLast.value': 'Forwarded only here',
  'HostRest.label': 'Used here',
  'HostRest.title': 'Used here',
  'Nested.user': 'Unknown beyond this point',
  'Dynamic.a': 'Unknown beyond this point',
  'Effecty.onReady': 'Used here',
  'Effecty.id': 'Used here',
  'NamedHandler.onSave': 'Used here, only in a deferred event handler',
  'NamedHandler.doc': 'Used here, only in a deferred event handler',
  'Composed.item': 'Forwarded only here',
  'Tree.tag': 'Forwarded here, unknown beyond this point',
  'Tree.depth': 'Used here',
  'UsesExternal.v': 'Forwarded here, unknown beyond this point',
  'Slot.Icon': 'Used here',
  'DirectHandler.onClick': 'Used here, only in a deferred event handler',
  'UsesClass.v': 'Forwarded here, unknown beyond this point',
  'Conditional.a': 'Forwarded only here',
  'Conditional.on': 'Used here',
  'Fallback.a': 'Derived from this prop',
  'Provides.a': 'Derived from this prop',
  'PlainMemo.shown': 'Used here',
  'PlainMemo.ignored': 'Received, unused here',
  'Compared.shown': 'Used here',
  'Compared.ignored': 'Unknown beyond this point',
  'Hooked.seed': 'Used here',
  'Hooked.unused': 'Received, unused here',
  'Reassigned.label': 'Used here',
  'ArgumentsReader.label': 'Unknown beyond this point',
  'EvalReader.label': 'Unknown beyond this point',
  'NestedArguments.label': 'Used here',
  'NestedArguments.unused': 'Received, unused here',
  'ListedAlias.ignored': 'Unknown beyond this point',
  'Listed.ignored': 'Received, unused here',
  'Tab.label': 'Unknown beyond this point',
  'Tab.title': 'Used here',
  'Defaults.old': 'Unknown beyond this point',
  'Defaults.plain': 'Received, unused here',
  'Held.item': 'Forwarded here, unknown beyond this point',
  'Swapped.caption': 'Unknown beyond this point',
  'LetBound.caption': 'Unknown beyond this point',
  'Replaced.caption': 'Unknown beyond this point',
  'RestReader.caption': 'Unknown beyond this point',
  'Rebound.label': 'Unknown beyond this point',
  'Rebound.other': 'Used here',
};

for (const [name, headline] of Object.entries(expected)) {
  const [tag, key] = name.split('.');

  assert.equal(control(tag, key).headline, headline, name);
}

assert.deepEqual(
  control('Effecty', 'onReady').flow!.uses.map((use) => [use.how, use.phase]),
  [
    ['call', 'effect'],
    ['hook-dependency', 'render'],
  ],
);
assert.equal(control('Conditional', 'a').flow!.forwards[0].flow.conditional, true);
assert.equal(control('Tab', 'label').flow!.boundaries[0].reason, 'element-escape');
assert.deepEqual(only(controls, 'Tab').placement, {
  kind: 'component',
  site: only(controls, 'Tabs').id,
  attr: 'children',
});
// Composed children that the receiver only renders are not a boundary.
assert.equal(control('Composed', 'item').flow!.forwards[0].node!.boundaries.length, 0);
assert.equal(only(controls, 'Leaf', 'Held').placement?.kind, 'value');
assert.equal(control('Defaults', 'old').flow!.boundaries[0].reason, 'effectful-default');
assert.deepEqual(
  Object.entries(
    controls.components.find((component) => component.name === 'Defaults')!.defaults!,
  ).map(([name, entry]) => [name, entry.effectful]),
  [
    ['old', true],
    ['plain', false],
  ],
);
assert.equal(only(controls, 'Swapped').unresolved?.reason, 'dynamic-component');
assert.equal(only(controls, 'LetBound').unresolved?.reason, 'dynamic-component');
assert.equal(only(controls, 'Replaced').unresolved?.reason, 'dynamic-component');
assert.equal(control('RestReader', 'caption').flow!.boundaries[0].reason, 'props-escape');
const literalSite = only(controls, 'WithThis', 'Controls');
const status = traceProp(controlIndex, literalSite, 'status', staticOwners(controlIndex));
assert.equal(status.headline, 'Used here');
assert.equal(
  literalSite.attributes[0].kind === 'spread' && literalSite.attributes[0].source.type,
  'object',
);
assert.equal(
  traceProp(controlIndex, literalSite, 'ignored', staticOwners(controlIndex)).headline,
  'Received, unused here',
);
const heldByRenderer = only(controls, 'WithThis', 'ViaUserRenderer');
assert.equal(heldByRenderer.placement?.kind, 'value');
assert.equal(only(controls, 'WithThis', 'ViaPortal').placement, undefined);
assert.equal(only(controls, 'WithThis', 'ViaLocalRoot').placement, undefined);
assert.equal(only(controls, 'WithThis', 'ViaReplacedMethod').placement?.kind, 'value');
const helperElement = controls.sites.find(
  (site) => site.tag === 'WithThis' && site.span.text.includes('from helper'),
);
assert.equal(helperElement?.placement?.kind, 'value');
assert.equal(control('Rebound', 'label').flow!.boundaries[0].reason, 'reassigned');

// ---- Every file on a resolution path is part of the claim ------------------

const modulesRoot = 'scripts/fixtures/source-trace-controls/modules';
const moduleFiles = ['App.tsx', 'Slot.tsx', 'barrel.ts', 'both.tsx', 'star.ts'];
const modules = analyzeSources({
  root: modulesRoot,
  files: moduleFiles.map((file) => `${modulesRoot}/${file}`),
});
const moduleIndex = indexReport(modules);
const moduleHashes = Object.fromEntries(modules.files.map((file) => [file.path, file.hash]));
const card = traceProp(moduleIndex, only(modules, 'Card'), 'caption', staticOwners(moduleIndex));

// `Card` is Ignored only as long as two re-exporting modules say so.
assert.equal(card.headline, 'Received, unused here');
assert.deepEqual(
  only(modules, 'Card')
    .via!.map((file) => modules.files[file].path)
    .sort(),
  ['barrel.ts', 'both.tsx', 'star.ts'],
);
assert.deepEqual(checkBuild(moduleIndex, card, moduleHashes), []);
assert.deepEqual(checkBuild(moduleIndex, card, { ...moduleHashes, 'barrel.ts': 'now-reads' }), [
  { path: 'barrel.ts', status: 'changed' },
]);

const { 'star.ts': _star, ...withoutStar } = moduleHashes;

assert.deepEqual(checkBuild(moduleIndex, card, withoutStar), [
  { path: 'star.ts', status: 'missing' },
]);

// A hop through a module that was not analyzed is not followed at all.
const partial = analyzeSources({
  root: modulesRoot,
  files: ['App.tsx', 'Slot.tsx', 'both.tsx', 'star.ts'].map((file) => `${modulesRoot}/${file}`),
});

assert.equal(only(partial, 'Card').target, null);
assert.match(only(partial, 'Card').unresolved!.detail, /imported through barrel\.ts/);

// An element handed to a wrapper is "unused" only while the wrapper just renders it.
const slotted = traceProp(
  moduleIndex,
  only(modules, 'Ignored'),
  'caption',
  staticOwners(moduleIndex),
);

assert.equal(slotted.headline, 'Received, unused here');
assert.deepEqual(checkBuild(moduleIndex, slotted, moduleHashes), []);
assert.deepEqual(
  checkBuild(moduleIndex, slotted, { ...moduleHashes, 'Slot.tsx': 'reads-children' }),
  [{ path: 'Slot.tsx', status: 'changed' }],
);

// The root renders its child. A tracked component returned by an opaque HOC
// and a child held by a wrapper both remain boundaries.
assert.equal(only(report, 'DeskApp').placement, undefined);
assert.deepEqual(
  report.sites.filter((site) => site.placement).map((site) => site.tag),
  ['FrameLabel', 'Inner'],
);
assert.equal(control('Tree', 'tag').flow!.boundaries[0].reason, 'recursive');
assert.equal(control('UsesClass', 'v').flow!.boundaries[0].reason, 'class-component');
assert.equal(control('Composed', 'item').flow!.forwards[0].site.tag, 'Leaf');
assert.deepEqual(
  control('Reassigned', 'label').flow!.derives.map(({ flow }) => flow.how),
  ['transform'],
);

// The repository's own demo relay and ignored fixture prop, unchanged.
const repository = analyzeSources({
  root: '.',
  files: ['scripts/demo/app.tsx', 'scripts/fixtures/app.tsx'],
});
const repositoryIndex = indexReport(repository);
const relay = traceProp(
  repositoryIndex,
  only(repository, 'ProjectCard'),
  'onCompleteTask',
  staticOwners(repositoryIndex),
);

assert.equal(relay.headline, 'Used here, only in a deferred event handler');
assert.deepEqual(
  relay.supply.steps.map((step) => step.site.tag),
  ['ProjectCard', 'ProjectList', 'MainContent'],
);
assert(
  relay.supply.end.kind === 'origin' && relay.supply.end.origin.detail.includes('completeTask'),
);

const version = traceProp(
  repositoryIndex,
  only(repository, 'PropsFixture'),
  'version',
  staticOwners(repositoryIndex),
);

assert.equal(version.headline, 'Received, unused here');
assert.equal(version.supply.steps[0].supplied, 'attribute');
// WorkspaceApp is imported from a file that was not listed: a partial input.
assert.equal(only(repository, 'WorkspaceApp', 'TestApp').unresolved?.reason, 'no-source');

// ---- Joining a running element to its source -------------------------------

const queueText = await readFile(`${root}/Queue.tsx`, 'utf8');
const instrumented = instrumentSource(queueText, { fileName: 'Queue.tsx', path: 'Queue.tsx' });
const stamped = [...instrumented.code.matchAll(/,(\d+)\)/g)].map((match) => Number(match[1]));
const queueSites = report.sites.filter((site) => site.id.startsWith('Queue.tsx@'));

assert.equal(instrumented.sites, 3);
assert.equal(queueSites.length, 3);
assert.equal(instrumented.code.split('\n').length, queueText.split('\n').length);
assert(instrumented.code.includes(SOURCE_REGISTRY_KEY));
assert(instrumented.code.includes(JSON.stringify(fileHash(queueText))));

for (const site of queueSites) {
  assert(stamped.includes(Number(site.id.split('@')[1])), `${site.id} is not stamped by the build`);
}

assert.deepEqual(
  ts.transpileModule(instrumented.code, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext },
    reportDiagnostics: true,
    fileName: 'Queue.tsx',
  }).diagnostics,
  [],
  'Instrumented source no longer parses',
);
// A file with no component element still records which text was built.
const leaf = instrumentSource("'use client';\nexport const a = <b />;", {
  fileName: 'a.tsx',
  path: 'a.tsx',
});

assert.equal(leaf.sites, 0);
assert(leaf.code.startsWith("'use client';\n;(()=>{"), 'The directive did not stay first');
assert(leaf.code.includes(fileHash("'use client';\nexport const a = <b />;")));
assert(leaf.code.endsWith('export const a = <b />;'));
assert(
  instrumentSource("'use client';\nexport const a = <B />;", {
    fileName: 'a.tsx',
    path: 'a.tsx',
  }).code.startsWith("'use client';\n;const __reactAnatomySite="),
);
// A directive written without a semicolon must not become the callee of the prelude.
for (const source of [
  "'use client'\nexport function Host() { return <b /> }",
  "'use client'\nexport function Host() { return <B /> }\nfunction B() { return null }",
]) {
  const { code } = instrumentSource(source, { fileName: 'host.tsx', path: 'host.tsx' });
  const script = ts.transpileModule(code, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const sandbox: Record<string, unknown> = { exports: {}, React: { createElement: () => ({}) } };

  sandbox.globalThis = sandbox;
  runInNewContext(script, sandbox);
  assert.equal(
    (sandbox[SOURCE_REGISTRY_KEY] as { files: Record<string, string> }).files['host.tsx'],
    fileHash(source),
    'The build did not record the file',
  );
  assert(ts.createSourceFile('host.tsx', code, ts.ScriptTarget.ESNext).statements[0]);
  assert(code.startsWith("'use client'\n;"), 'The directive is no longer a directive');
}

// A source file that already uses the helper's name gets another one.
assert(
  instrumentSource('const __reactAnatomySite = 1;\nexport const a = <B />;', {
    fileName: 'a.tsx',
    path: 'a.tsx',
  }).code.includes('const __reactAnatomySite_1=(()=>'),
  'The helper collides with a binding in the source',
);

const rowSite = only(report, 'TicketRow');
const stamp = (site: ReportSite) => {
  const [file, at] = site.id.split('@');

  return { file, hash: index.files.get(file)!.hash, at: Number(at) };
};

assert.deepEqual(associate(index, stamp(rowSite)), { status: 'verified', site: rowSite });
assert.deepEqual(associate(index, null), { status: 'none' });
assert.deepEqual(associate(index, { ...stamp(rowSite), hash: 'different' }), {
  status: 'stale',
  file: 'Queue.tsx',
});
assert.deepEqual(associate(index, { file: 'vendor/Tooltip.tsx', hash: 'x', at: 1 }), {
  status: 'unlisted',
  file: 'vendor/Tooltip.tsx',
});
assert.equal(associate(index, { ...stamp(rowSite), at: 1 }).status, 'mismatch');
assert.equal(siteId('Queue.tsx', 5), 'Queue.tsx@5');
// A name alone never selects a call site: it only lists candidates.
assert.deepEqual(
  candidateSites(index, 'Summary').map((site) => site.tag),
  ['StableSummary'],
);

// A trace is only as current as every file it reads, not just the selected element's.
const built = Object.fromEntries(report.files.map((file) => [file.path, file.hash]));

assert.deepEqual(checkBuild(index, density, built), []);
assert.deepEqual(checkBuild(index, density, { ...built, 'TicketRow.tsx': 'edited' }), [
  { path: 'TicketRow.tsx', status: 'changed' },
]);
assert.deepEqual(
  checkBuild(index, density, {
    'Queue.tsx': built['Queue.tsx'],
    'DeskApp.tsx': built['DeskApp.tsx'],
    'TicketRow.tsx': built['TicketRow.tsx'],
  }),
  [{ path: 'QueueFooter.tsx', status: 'missing' }],
);
// QueueFooter.tsx has no component element, so no element stamp covers it.
assert.equal(
  instrumentSource(await readFile(`${root}/QueueFooter.tsx`, 'utf8'), {
    fileName: 'QueueFooter.tsx',
    path: 'QueueFooter.tsx',
  }).sites,
  0,
);
assert.deepEqual(checkBuild(index, density, { ...built, 'QueueFooter.tsx': 'edited-leaf' }), [
  { path: 'QueueFooter.tsx', status: 'changed' },
]);
assert.deepEqual(checkBuild(index, legacy, { ...built, 'Queue.tsx': 'edited-elsewhere' }), []);

// With evidence from the page, each upstream step is the mounted ancestor's own element.
const live = traceProp(
  index,
  rowSite,
  'onDismiss',
  liveOwners(index, [
    { id: 'f2', stamp: stamp(only(report, 'Queue')) },
    { id: 'f1', stamp: stamp(only(report, 'DeskApp')) },
  ]),
  'f3',
);

assert.deepEqual(
  live.supply.steps.map((step) => [step.found, step.instance]),
  [
    ['start', 'f3'],
    ['page', 'f2'],
  ],
);

// Two enclosing instances of the owning component cannot be told apart by
// position. React's development owner record decides; without it the chain stops.
const nested = [
  { id: 'inner', stamp: stamp(only(report, 'Queue')) },
  { id: 'outer', stamp: stamp(only(report, 'Queue')) },
  { id: 'root', stamp: stamp(only(report, 'DeskApp')) },
];
for (const ambiguous of [
  liveOwners(index, [nested[0], { id: 'outer', stamp: null }]),
  liveOwners(index, [nested[0], { id: 'outer', stamp: { ...nested[1].stamp, hash: 'stale' } }]),
  liveOwners(index, [nested[0]], null, true),
]) {
  const unresolved = traceProp(index, rowSite, 'onDismiss', ambiguous);
  assert.equal(unresolved.supply.steps.length, 1);
  assert.equal(unresolved.supply.end.kind, 'unknown');
}
const guessed = traceProp(index, rowSite, 'onDismiss', liveOwners(index, nested));

assert.equal(guessed.supply.steps.length, 1);
assert(
  guessed.supply.end.kind === 'unknown' &&
    guessed.supply.end.detail.startsWith('2 mounted Queue components enclose this element'),
);
assert.deepEqual(
  traceProp(index, rowSite, 'onDismiss', liveOwners(index, nested, [1, 2])).supply.steps.map(
    (step) => step.instance,
  ),
  [undefined, 'outer'],
);
// A creator that is not an enclosing component ends the chain.
assert.equal(
  traceProp(index, rowSite, 'onDismiss', liveOwners(index, nested, [-1])).supply.end.kind,
  'unknown',
);

// Without a verified ancestor the chain stops instead of guessing by name.
const unverified = traceProp(
  index,
  rowSite,
  'onDismiss',
  liveOwners(index, [{ id: 'f2', stamp: { ...stamp(only(report, 'Queue')), hash: 'stale' } }]),
);

assert.equal(unverified.supply.steps.length, 1);
assert.equal(unverified.supply.end.kind, 'unknown');

console.log(
  `Passed: source trace analysis (${report.components.length} fixture components, ${Object.keys(expected).length} control props), rename, deferred handler, projections, mixed use, unused receiver, closed chain, unknown boundaries, partial input, report validation, build stamps, stale and unverified joins.`,
);

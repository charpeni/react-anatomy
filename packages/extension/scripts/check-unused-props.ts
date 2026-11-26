import type { SourceReport } from '../src/source-trace/report.ts';
import type { AuditTier } from '../src/source-trace/unused-props.ts';
import assert from 'node:assert/strict';
import { parseReport } from '../src/source-trace/report.ts';
import { associate, indexReport } from '../src/source-trace/trace.ts';
import { auditSelection, auditSite } from '../src/source-trace/unused-props.ts';
import { analyzeSources } from './source-trace/analyze.ts';
import { fileHash } from './source-trace/shared.ts';
import { UNUSED_PROPS_ROOT, analyzeUnusedPropsFixture } from './unused-props/build-fixture.ts';

// Every expectation below comes from reading the fixture source. The analysis
// is produced here by the shared analyzer; no audit result is written by hand.
//
// The check is mostly about what must NOT be reported. A prop is a candidate
// only when delivery, an analyzed receiver, and a closed set of paths are all
// established from source.

const UNUSED: AuditTier[] = ['candidate', 'dead-end'];

function suite(report: SourceReport) {
  const parsed = parseReport(JSON.stringify(report));

  assert.ok(parsed.ok, 'The analysis must pass the validation the panel applies');

  const index = indexReport(parsed.report);

  function site(tag: string, nth = 0) {
    const sites = report.sites.filter((candidate) => candidate.tag === tag);

    assert.ok(sites[nth], `Expected a <${tag}> element at position ${nth}`);

    return sites[nth];
  }

  function audit(
    tag: string,
    options: { nth?: number; propNames?: string[] | null; propNamesLimited?: boolean } = {},
  ) {
    const result = auditSite(index, site(tag, options.nth), {
      propNames: options.propNames ?? null,
      propNamesLimited: options.propNamesLimited,
      verified: true,
    });

    assert.equal(result.status, 'ready', `<${tag}> should be auditable`);

    if (result.status !== 'ready') {
      throw new Error('unreachable');
    }

    return {
      result,
      tiers: Object.fromEntries(result.rows.map((row) => [row.key, row.tier])),
      row: (key: string) => {
        const row = result.rows.find((candidate) => candidate.key === key);

        assert.ok(row, `<${tag}> should list ${key}`);

        return row;
      },
    };
  }

  function unavailable(tag: string) {
    const result = auditSite(index, site(tag), { propNames: null, verified: true });

    assert.equal(result.status, 'unavailable', `<${tag}> must not be audited`);

    if (result.status !== 'unavailable') {
      throw new Error('unreachable');
    }

    return result;
  }

  return { index, site, audit, unavailable };
}

function lines(
  report: SourceReport,
  evidence: { label: string; span: { file: number; line: number } }[],
) {
  return evidence.map((item) => `${report.files[item.span.file].path}:${item.span.line}`);
}

// ---- The billing fixture: what a developer sees in the panel ----------------

const billingReport = analyzeUnusedPropsFixture();
const billing = suite(billingReport);

{
  // The positive: written at the element, not named by the component, no rest.
  const card = billing.audit('PlanCard');
  const legacy = card.row('legacyTheme');

  assert.equal(legacy.tier, 'candidate');
  assert.equal(legacy.delivery, 'written');
  assert.match(legacy.explanation, /parameter list does not name legacyTheme.*no rest element/);
  // Evidence names the caller's line and the receiving component.
  assert.deepEqual(lines(billingReport, legacy.evidence), ['BillingApp.tsx:38', 'PlanCard.tsx:15']);
  assert.match(legacy.evidence[0].span.text, /^legacyTheme="dark"$/);
  assert.deepEqual(legacy.caveats, []);

  // The near miss: read only when the button is clicked.
  const tracking = card.row('trackingId');

  assert.equal(tracking.tier, 'indirect');
  assert.equal(tracking.label, 'Read only in an event handler');
  assert.ok(lines(billingReport, tracking.evidence).includes('PlanCard.tsx:18'));

  // Read in a branch this render does not take: source finds it anyway.
  assert.equal(card.tiers.compareTo, 'used');
  // Callback props are used, and are not presented as surprising.
  assert.equal(card.tiers.onSelect, 'used');
  assert.equal(card.row('onSelect').label, 'Called in a handler');
  // `key` never reaches the component and is not a row.
  assert.equal(card.tiers.key, undefined);
  // Without page evidence, a prop that only a spread can deliver is not listed.
  assert.equal(card.tiers.trialDays, undefined);
  assert.equal(card.result.notes.length, 1);

  assert.deepEqual(
    card.result.rows.filter((row) => UNUSED.includes(row.tier)).map((row) => row.key),
    ['legacyTheme'],
  );
}

{
  // Present in only one render: the Team plan is on trial, Business is not.
  const names = ['plan', 'selected', 'onSelect', 'legacyTheme', 'trackingId', 'compareTo'];
  const trial = billing.audit('PlanCard', { propNames: [...names, 'trialDays'] }).row('trialDays');

  assert.equal(trial.tier, 'this-render', 'A spread-delivered prop is never a verified candidate');
  assert.equal(trial.delivery, 'spread');
  assert.match(trial.explanation, /may be absent on other renders/);
  assert.equal(billing.audit('PlanCard', { propNames: names }).tiers.trialDays, undefined);
}

{
  // A props object read by fixed names only.
  const price = billing.audit('PriceTag');

  assert.deepEqual(price.tiers, { amount: 'used', period: 'candidate', locale: 'candidate' });
  assert.match(price.row('period').explanation, /only by fixed names/);
}

{
  // Forwarded through a rest spread.
  const toolbar = billing.audit('Toolbar');

  assert.equal(toolbar.tiers.title, 'used');
  assert.equal(toolbar.tiers.onExport, 'indirect');
  assert.equal(toolbar.row('onExport').label, 'Passed down by a spread');

  const print = toolbar.row('onPrint');

  assert.equal(print.tier, 'dead-end', 'Passed down but read nowhere is its own tier');
  assert.deepEqual(lines(billingReport, print.evidence), [
    'BillingApp.tsx:25',
    'Toolbar.tsx:8',
    'Toolbar.tsx:12',
    'Toolbar.tsx:18',
  ]);

  // The same props seen from the receiving element arrive only by a spread.
  const actions = billing.audit('ToolbarActions', { propNames: ['onExport', 'onPrint'] });

  assert.deepEqual(actions.tiers, { onExport: 'used', onPrint: 'this-render' });
}

{
  // Named only to keep it off the DOM element.
  const field = billing.audit('CouponField');

  assert.equal(field.tiers.dense, 'candidate');
  assert.match(field.row('dense').explanation, /keeps it out of the rest object/);
  assert.match(field.row('dense').explanation, /Do not remove the destructuring/);
  assert.equal(field.tiers.placeholder, 'indirect');
  assert.equal(field.row('placeholder').label, 'Spread onto a DOM element');
}

{
  // Never read, but it re-runs an effect.
  const bar = billing.audit('SaveBar');

  assert.equal(bar.tiers.revision, 'indirect');
  assert.equal(bar.row('revision').label, 'Only a hook dependency');
  assert.equal(bar.tiers.onReset, 'used');
}

for (const tag of ['SeatMeter', 'StableMeter']) {
  // A comparator, written inline or reached through a name and an alias.
  const meter = billing.audit(tag);

  assert.deepEqual(meter.tiers, { used: 'used', limit: 'used', version: 'unknown' }, tag);
  assert.equal(meter.row('version').label, 'A memo comparator may read it');
}

{
  const empty = billing.audit('EmptyState');

  assert.equal(empty.tiers.children, 'candidate', 'Children that are never rendered');
  assert.equal(billing.audit('Notice').tiers.details, 'used');
}

for (const tag of ['InvoiceSummary', 'LegacyTotal']) {
  // The props object goes to a hook, or is read through `arguments`.
  assert.deepEqual(billing.audit(tag).tiers, { amount: 'unknown', currency: 'unknown' }, tag);
}

{
  const chip = billing.audit('MemberChip');

  assert.equal(chip.tiers.member, 'unknown', 'A nested pattern is a boundary, not a miss');
  assert.equal(chip.tiers.size, 'candidate');
}

assert.equal(billing.unavailable('TrackedFooter').reason, 'wrapper');
assert.equal(billing.unavailable('Tooltip').reason, 'no-source');
assert.equal(billing.unavailable('TrackedFooter').why, 'unsupported');

{
  // The page reports at most 200 prop names. UsageHistory holds 242: the 240
  // spread ones come first, so the two written props are past the cut.
  const spread = Array.from({ length: 240 }, (_, day) => `day${day}`);
  const reported = spread.slice(0, 200);
  const wide = billing.audit('UsageHistory', { propNames: reported, propNamesLimited: true });

  assert.equal(wide.result.partial, true);
  // Written props are listed from source whether or not the page reported them,
  // and their absence from a partial list is not evidence of anything.
  assert.equal(wide.tiers.label, 'used');
  assert.equal(wide.tiers.legacyScale, 'candidate');
  assert.deepEqual(wide.row('legacyScale').caveats, []);
  assert.deepEqual(wide.row('label').caveats, []);
  assert.equal(wide.tiers.day0, 'used');
  assert.equal(wide.tiers.day1, 'this-render');
  // Spread props past the cut are missing, and the audit says so.
  assert.equal(wide.tiers.day239, undefined);
  assert.match(
    wide.result.notes.join(' '),
    /more props than Anatomy reads.*200 names.*not complete/,
  );

  // The same names from a complete list do mean the written prop is missing.
  const complete = billing.audit('UsageHistory', { propNames: reported });

  assert.equal(complete.result.partial, false);
  assert.match(complete.row('legacyScale').caveats.join(' '), /was not on the instance/);
  assert.doesNotMatch(complete.result.notes.join(' '), /more props than Anatomy reads/);
}

// ---- Selection states: what the page can and cannot establish ---------------

{
  const { index } = billing;
  const cardSite = billing.site('PlanCard');
  const [file, offset] = cardSite.id.split('@');
  const hash = index.files.get(file)!.hash;
  const stamp = { file, hash, at: Number(offset) };
  const select = (
    association: ReturnType<typeof associate> | null,
    extra: { metadata?: boolean; chosen?: typeof cardSite } = {},
  ) => auditSelection(index, { association, propNames: ['legacyTheme'], ...extra });

  const verified = select(associate(index, stamp));

  assert.ok(verified.status === 'ready' && verified.verified);

  // Everyday: a build without metadata, or an instance without a record.
  const plain = select(associate(index, null), { metadata: false });

  assert.ok(plain.status === 'unavailable' && plain.why === 'not-observed');
  assert.match(plain.detail, /built without React Anatomy source metadata/);

  const unstamped = select(associate(index, null), { metadata: true });

  assert.ok(unstamped.status === 'unavailable' && unstamped.why === 'not-observed');
  assert.match(unstamped.detail, /createElement or cloneElement/);
  // The fixture's createElement(PlanLink) has no element in source to join.
  assert.equal(billingReport.sites.filter((candidate) => candidate.tag === 'PlanLink').length, 0);

  const stale = select(associate(index, { ...stamp, hash: fileHash('edited') }));

  assert.ok(stale.status === 'unavailable' && stale.why === 'out-of-date');

  const unlisted = select(associate(index, { ...stamp, file: 'vendor/Tooltip.tsx' }));

  assert.ok(unlisted.status === 'unavailable' && unlisted.why === 'not-analyzed');

  const mismatch = select(associate(index, { ...stamp, at: stamp.at + 1 }));

  assert.ok(mismatch.status === 'unavailable' && mismatch.why === 'not-analyzed');

  // The element's file is current, but the component's file changed after the
  // analysis: the element is in BillingApp.tsx, PlanCard in PlanCard.tsx.
  const built = Object.fromEntries(billingReport.files.map((entry) => [entry.path, entry.hash]));
  const current = auditSelection(index, {
    association: associate(index, stamp),
    propNames: null,
    built,
  });

  assert.ok(current.status === 'ready');
  assert.equal(current.rows.find((row) => row.key === 'legacyTheme')?.tier, 'candidate');

  const edited = auditSelection(index, {
    association: associate(index, stamp),
    propNames: null,
    built: { ...built, 'PlanCard.tsx': fileHash('edited') },
  });

  assert.ok(edited.status === 'ready');

  const outdated = edited.rows.find((row) => row.key === 'legacyTheme')!;

  assert.equal(outdated.tier, 'unknown', 'A changed receiver file withdraws the candidate');
  assert.match(outdated.explanation, /PlanCard\.tsx was built from different text/);
  assert.match(
    edited.rows.find((row) => row.key === 'plan')!.caveats.join(' '),
    /may be out of date/,
  );

  // A call site chosen by hand is audited, and says it was not verified.
  const manual = select(associate(index, null), { chosen: cardSite });

  assert.ok(manual.status === 'ready' && !manual.verified);
  assert.match(manual.notes.join(' '), /chosen by hand/);

  // Before the page has answered there is no association at all.
  assert.equal(select(null).status, 'unavailable');
}

// ---- Regressions: ways a prop looks unused without being unused -------------

const regressionReport = analyzeSources({
  root: UNUSED_PROPS_ROOT,
  files: [`${UNUSED_PROPS_ROOT}/Regressions.tsx`],
});
const regress = suite(regressionReport);
const plain = (text: string) => {
  const nth = regressionReport.sites
    .filter((candidate) => candidate.tag === 'Plain')
    .findIndex((candidate) => candidate.span.text.includes(text));

  assert.notEqual(nth, -1, `Expected a <Plain> element containing ${text}`);

  return regress.audit('Plain', { nth });
};

const fanOut = regress.audit('FanOut').row('tone');
assert.equal(fanOut.tier, 'dead-end');
assert.deepEqual(
  fanOut.evidence
    .filter((item) => item.label.includes('without reading'))
    .map((item) => item.label),
  ['FirstLeaf receives tone without reading it', 'OtherLeaf receives tone without reading it'],
);
const comparedRelay = regress.audit('ComparedRelay').row('tone');
assert.equal(comparedRelay.tier, 'unknown');
assert.equal(comparedRelay.label, 'A memo comparator may read it');
assert.match(comparedRelay.evidence.at(-1)!.span.text, /a.label === b.label/);

// Implicit readers: `arguments`, with and without a parameter, and eval.
assert.equal(regress.audit('ArgumentsWithPattern').tiers.size, 'unknown');
assert.equal(regress.audit('EvalReader').tiers.tone, 'unknown');
// Reads that are easy to miss.
assert.equal(regress.audit('DefaultReader').tiers.size, 'used', 'Read as another default');
assert.deepEqual(regress.audit('BodyDestructure').tiers, { tone: 'used', size: 'candidate' });
assert.equal(regress.audit('Memoized').tiers.size, 'used');
assert.equal(regress.audit('RenderProp').tiers.children, 'used', 'Children called as a function');
assert.deepEqual(regress.audit('Clones').tiers, { tone: 'used', children: 'used' });
// Not reads, although the name appears.
assert.equal(regress.audit('DeadAlias').tiers.tone, 'candidate', 'An unread alias is not a read');
assert.equal(regress.audit('Shadowed').tiers.tone, 'candidate', 'A shadowing parameter');
// Boundaries.
assert.equal(regress.audit('Provides').tiers.tone, 'used', 'Handed to a context provider');
const direct = regress.audit('WithThis', { propNames: ['status', 'legacy'] });
assert.equal(direct.tiers.status, 'used');
assert.equal(direct.tiers.legacy, 'candidate');
assert.equal(regress.audit('WithThis', { nth: 1 }).tiers.legacy, 'unknown');
assert.equal(regress.audit('Reflects').tiers.tone, 'unknown', 'Props passed to createElement');
assert.equal(regress.audit('Dynamic').tiers.tone, 'unknown', 'Computed prop name');
assert.equal(regress.unavailable('ToneContext.Provider').why, 'unsupported');
// `ref` belongs to React.
assert.equal(regress.audit('WithRef').tiers.ref, 'reserved');
assert.equal(plain('ref={null}').tiers.ref, 'reserved');

{
  // Compound components: the parent reads the child element's props.
  const tab = regress.audit('Tab').row('label');

  assert.equal(tab.tier, 'unknown', '<Tabs> reads label from its <Tab> children');
  assert.equal(tab.label, 'Other code may read it from the element');
  // A parent that only renders its children leaves the candidate standing.
  assert.equal(plain('"framed"').tiers.tone, 'candidate');
  assert.equal(plain('"aside"').tiers.tone, 'candidate');
  // An element held in a variable may be read by whatever holds it.
  assert.equal(plain('"held"').tiers.tone, 'unknown');
  // An array written directly in JSX children is still rendered.
  assert.equal(plain('"listed"').tiers.tone, 'candidate');
}

{
  // A default that runs code is skipped when the prop is passed.
  const skipped = regress.audit('EffectfulDefault').row('old');

  assert.equal(skipped.tier, 'unknown');
  assert.equal(skipped.label, 'Passing it skips a default that runs code');

  const literal = regress.audit('LiteralDefault').row('tone');

  assert.equal(literal.tier, 'candidate');
  assert.match(literal.caveats.join(' '), /default value that is also never read/);

  // The receiver ignores the value; the caller still computes it.
  const metric = plain('recordMetric()').row('size');

  assert.equal(metric.tier, 'candidate');
  assert.match(metric.caveats.join(' '), /still evaluates the expression recordMetric\(\)/);
}

{
  // Keys of an object literal can be listed, so delivery is written in source.
  const shared = plain('{...shared}');

  assert.deepEqual(shared.tiers, { tone: 'candidate', size: 'candidate', label: 'used' });
  assert.equal(shared.row('tone').delivery, 'written');

  // An attribute followed by an unlisted spread keeps its tier and says so.
  const extra = plain('{...extra}');

  assert.equal(extra.tiers.tone, 'candidate');
  assert.match(extra.row('tone').caveats.join(' '), /may replace its value/);

  // A key seen on the page that this element does not write at all.
  const injected = regress.audit('Shadowed', { propNames: ['tone', 'label', 'injected'] });

  assert.equal(injected.row('injected').tier, 'this-render');
  assert.equal(injected.row('injected').delivery, 'unwritten');
}

// No tier other than these two may ever be presented as unused.
for (const report of [billingReport, regressionReport]) {
  const index = indexReport(report);

  for (const candidate of report.sites) {
    const result = auditSite(index, candidate, { propNames: null, verified: true });

    if (result.status !== 'ready') {
      continue;
    }

    for (const row of result.rows) {
      if (UNUSED.includes(row.tier)) {
        assert.equal(row.delivery, 'written', `${candidate.tag}.${row.key}`);
        assert.equal(row.trace.flow?.boundaries.length, 0, `${candidate.tag}.${row.key}`);
        assert.equal(row.trace.flow?.uses.length, 0, `${candidate.tag}.${row.key}`);
        assert.ok(row.evidence.length >= 2, `${candidate.tag}.${row.key} needs source evidence`);
      }
    }
  }
}

console.log('Unused props audit: candidates, near misses and abstentions are as expected');

import type { ReportComponent, ReportSite, Span, UnknownReason } from './report.ts';
import type { Association, Boundary, PropSupply, ReportIndex, TraceNode } from './trace.ts';
import { checkBuild, supplyAt, traceFlow } from './trace.ts';

// Check one JSX call site. A candidate needs a known prop and an analyzed
// receiver. The trace must show that the receiver ignores the prop or only
// forwards it to components that ignore it. The audit reads no runtime values.

export type AuditTier =
  /** Written at this element; the receiver neither reads it nor passes it on. */
  | 'candidate'
  /** Passed down, and no analyzed receiver below reads it either. */
  | 'dead-end'
  /** No reader was found, but source does not show this element always passing it. */
  | 'this-render'
  /** An analysis boundary: the prop may be read where the trace cannot follow. */
  | 'unknown'
  /** Read or passed on, in a way a simpler check would miss. */
  | 'indirect'
  /** Read or passed on in plain sight. */
  | 'used'
  /** Handled by React, not by the component. */
  | 'reserved';

export type Delivery =
  /** Written as an attribute, or as a key of a spread object literal. */
  | 'written'
  /** Arrived through a spread whose keys source cannot list. */
  | 'spread'
  /** On the instance, but not written at this element at all. */
  | 'unwritten';

export interface AuditEvidence {
  label: string;
  span: Span;
}

interface ReceiverAnalysis {
  site: ReportSite;
  input: PropSupply;
  flow: TraceNode;
}

export interface AuditRow {
  key: string;
  tier: AuditTier;
  /** A few words, shown next to the prop name. */
  label: string;
  /** Why the prop is in this tier, written for someone learning the codebase. */
  explanation: string;
  delivery: Delivery;
  evidence: AuditEvidence[];
  caveats: string[];
  trace: ReceiverAnalysis;
}

export type Unavailable =
  /** The build or instance has no call-site record. */
  | 'not-observed'
  /** The page and the analysis were made from different source text. */
  | 'out-of-date'
  /** The element is outside the analyzed files. */
  | 'not-analyzed'
  /** The component cannot be analyzed from source: a wrapper, a class, a package. */
  | 'unsupported';

export type PropAudit =
  | {
      status: 'ready';
      site: ReportSite;
      component: ReportComponent;
      /** Whether the page proved this instance came from `site`. */
      verified: boolean;
      /**
       * The page reported only some of the instance's prop names. Props that
       * arrive only through a spread may be missing from `rows`.
       */
      partial: boolean;
      rows: AuditRow[];
      notes: string[];
    }
  | {
      status: 'unavailable';
      why: Unavailable;
      title: string;
      detail: string;
      reason?: UnknownReason;
      span?: Span;
    };

const BOUNDARY_LABELS: Partial<Record<UnknownReason, string>> = {
  'custom-comparator': 'A memo comparator may read it',
  'element-escape': 'Other code may read it from the element',
  'effectful-default': 'Passing it skips a default that runs code',
  'props-escape': 'The props object leaves the component',
  'dynamic-key': 'Props are read by computed name',
  'nested-pattern': 'Destructured where it is received',
  recursive: 'Passed into a recursive path',
  limit: 'Passed further than the trace follows',
};

function receiverOf(boundary: Boundary) {
  return BOUNDARY_LABELS[boundary.reason] ?? 'Passed to code that was not analyzed';
}

function nodes(root: TraceNode) {
  const all: TraceNode[] = [];
  const visit = (node: TraceNode) => {
    all.push(node);
    node.forwards.forEach((edge) => edge.node && visit(edge.node));
  };

  visit(root);

  return all;
}

function absence(component: ReportComponent, key: string) {
  const name = component.name;

  if (component.params === 'none') {
    return `${name} declares no props parameter, so it cannot read ${key} or any other prop by name.`;
  }

  if (Object.hasOwn(component.props, key)) {
    return component.objects.some((entry) => entry.exclude.includes(key))
      ? `${name} names ${key} next to a rest element and never reads the binding. Naming it keeps it out of the rest object, which is a common way to stop a prop from reaching a DOM element. The value passed here is still unused. Do not remove the destructuring while any caller passes ${key}.`
      : `${name} destructures ${key} and no code reads the binding.`;
  }

  return component.params === 'destructured'
    ? `${name}'s parameter list does not name ${key}, and it has no rest element that could carry it.`
    : `${name} reads its props object only by fixed names, and ${key} is not one of them. The object itself is never passed on.`;
}

/** A note about what the caller evaluates to produce the value, when it is more than a name or a literal. */
function computedHere(trace: ReceiverAnalysis) {
  const origin = trace.input.origin;

  if (!origin) {
    return null;
  }

  if (origin.type === 'local' && origin.what === 'expression') {
    return `The caller still evaluates ${origin.detail} on every render. That evaluation is separate from whether the result is read, and it may have effects of its own.`;
  }

  if (origin.type === 'derived' && origin.how === 'transform') {
    return 'The caller computes this value from its own props on every render. That computation is separate from whether the result is read.';
  }

  return null;
}

function classify(
  trace: ReceiverAnalysis,
  delivery: Delivery,
): Pick<AuditRow, 'tier' | 'label' | 'explanation' | 'evidence'> {
  const flow = trace.flow;
  const { component, key } = flow;
  const supplied: AuditEvidence[] =
    delivery === 'unwritten'
      ? []
      : [
          {
            label: delivery === 'written' ? 'Passed here' : 'Can only arrive through this spread',
            span: trace.input.span,
          },
        ];
  const receiver: AuditEvidence = {
    label: `${component.name} receives it here`,
    span: component.span,
  };

  const receiverBoundaries =
    flow.verdict === 'unknown'
      ? flow.boundaries
      : flow.verdict === 'forwarded' && flow.consumer === 'unknown'
        ? nodes(flow).flatMap((node) => node.boundaries.filter((boundary) => !boundary.outgoing))
        : [];

  if (receiverBoundaries.length) {
    const first = receiverBoundaries[0];

    return {
      tier: 'unknown',
      label: receiverOf(first),
      explanation: [
        flow.verdict === 'forwarded'
          ? `${component.name} passes ${key} down. The analysis could not rule out a reader.`
          : `No read of ${key} was found in ${component.name}.`,
        ...receiverBoundaries.map((boundary) => boundary.detail),
      ].join(' '),
      evidence: [
        ...supplied,
        ...receiverBoundaries.map((boundary) => ({
          label: receiverOf(boundary),
          span: boundary.span,
        })),
      ],
    };
  }

  if (flow.verdict === 'unused' || (flow.verdict === 'forwarded' && flow.consumer === 'none')) {
    const deadEnd = flow.verdict === 'forwarded';
    const endpoints = new Map<string, TraceNode>();
    if (deadEnd) {
      for (const node of nodes(flow)) {
        if (!node.forwards.length) {
          endpoints.set(JSON.stringify([node.component.id, node.key]), node);
        }
      }
    }
    const leaves = [...endpoints.values()];
    const closed = deadEnd
      ? `${component.name} only passes ${key} down, and no component that receives it reads it. ${leaves.map((node) => absence(node.component, node.key)).join(' ')}`
      : absence(component, key);
    const hops: AuditEvidence[] = flow.forwards.map((edge) => ({
      label: `Passed to <${edge.site.tag}>${edge.flow.via === 'spread' ? ' by a spread' : ''}`,
      span: edge.flow.span,
    }));

    const evidence = [
      ...supplied,
      receiver,
      ...hops,
      ...leaves.map((node) => ({
        label: `${node.component.name} receives ${node.key} without reading it`,
        span: node.component.span,
      })),
    ];

    if (delivery !== 'written') {
      return {
        tier: 'this-render',
        label: delivery === 'spread' ? 'Arrived by a spread' : 'Not written here',
        explanation:
          (delivery === 'spread'
            ? `${key} is on this instance, but the element does not write it: it arrived through a spread whose keys cannot be listed from source, so it may be absent on other renders. `
            : `${key} is on this instance, but this element does not write it. It was added somewhere the analysis cannot see. `) +
          closed,
        evidence,
      };
    }

    return {
      tier: deadEnd ? 'dead-end' : 'candidate',
      label: deadEnd ? 'Passed down, never read' : 'Never read or passed down',
      explanation: closed,
      evidence,
    };
  }

  const uses = flow.uses;
  const flows: AuditEvidence[] = [
    ...uses.map((use) => ({ label: use.detail, span: use.span })),
    ...flow.derives.map((derive) => ({
      label: `Used to compute ${derive.flow.attr === '*' ? 'a spread' : derive.flow.attr} for <${derive.site?.tag ?? 'a component'}>`,
      span: derive.flow.span,
    })),
    ...flow.forwards.map((edge) => ({
      label: `Passed to <${edge.site.tag}>${edge.flow.via === 'spread' ? ' by a spread' : ` as ${edge.key}`}`,
      span: edge.flow.span,
    })),
  ];
  const indirect = (label: string, explanation: string) => ({
    tier: 'indirect' as const,
    label,
    explanation,
    evidence: [...supplied, ...flows],
  });

  if (uses.length && !flow.derives.length && !flow.forwards.length) {
    if (uses.every((use) => use.how === 'hook-dependency')) {
      return indirect(
        'Only a hook dependency',
        `${component.name} never reads the value of ${key}, but lists it as a hook dependency. A change to it re-runs that hook, so the prop does work even though nothing displays it.`,
      );
    }

    if (uses.every((use) => use.how === 'key')) {
      return indirect(
        'Only a React key',
        `${component.name} uses ${key} only as a key. It decides which child keeps its state between renders.`,
      );
    }

    // A callback prop is meant to run later. Only a value that is read later
    // is the surprising case.
    if (uses.every((use) => use.how === 'call' || use.how === 'host-handler')) {
      return {
        tier: 'used',
        label: uses.every((use) => use.phase === 'render') ? 'Called' : 'Called in a handler',
        explanation: `${component.name} calls ${key} or attaches it as a handler.`,
        evidence: [...supplied, ...flows],
      };
    }

    if (uses.every((use) => use.phase === 'event')) {
      return indirect(
        'Read only in an event handler',
        `Nothing reads ${key} while ${component.name} renders. The read is inside a handler, so it happens only when the event fires. A check that watches which props a render touches would report this prop as unused.`,
      );
    }

    if (uses.every((use) => use.phase === 'effect')) {
      return indirect(
        'Read only in an effect',
        `Nothing reads ${key} while ${component.name} renders. The read is inside an effect, which runs after the render is committed.`,
      );
    }

    if (uses.every((use) => use.phase !== 'render')) {
      return indirect(
        'Read only in a callback',
        `Nothing reads ${key} while ${component.name} renders. The read is inside a function that runs later, if it runs at all.`,
      );
    }

    if (uses.every((use) => use.how === 'host-prop' && use.detail.startsWith('spread onto'))) {
      return indirect(
        'Spread onto a DOM element',
        `${component.name} never names ${key}. It reaches the DOM through a spread of the remaining props.`,
      );
    }
  }

  if (!uses.length && !flow.derives.length) {
    const bySpread = flow.forwards.every((edge) => edge.flow.via === 'spread');
    const targets = [...new Set(flow.forwards.map((edge) => `<${edge.site.tag}>`))].join(', ');

    if (flow.consumer === 'found' && bySpread) {
      return indirect(
        'Passed down by a spread',
        `${component.name} never names ${key}. It travels to ${targets} inside a spread, and a component below reads it.`,
      );
    }

    return {
      tier: 'used',
      label: flow.consumer === 'found' ? 'Passed down and read below' : 'Passed down',
      explanation:
        flow.consumer === 'found'
          ? `${component.name} passes ${key} to ${targets}, where it is read.`
          : `${component.name} passes ${key} to ${targets}. What happens to it there is outside the analysis.`,
      evidence: [...supplied, ...flows],
    };
  }

  return {
    tier: 'used',
    label: flow.forwards.length
      ? 'Read and passed down'
      : uses.length
        ? 'Read'
        : 'Used to compute another prop',
    explanation: `${component.name} uses ${key}.`,
    evidence: [...supplied, ...flows],
  };
}

function writtenNames(site: ReportSite) {
  const names: string[] = [];

  for (const attribute of site.attributes) {
    if (attribute.kind === 'attr') {
      names.push(attribute.name);
    } else if (attribute.source.type === 'object') {
      names.push(...Object.keys(attribute.source.keys));
    }
  }

  return names;
}

/**
 * Audits the props one element passes to its component.
 *
 * `propNames` are the keys on the mounted instance for the current render, as
 * read from the page. They add the props that arrive through a spread. Pass
 * null when the page was not read; such props are then not listed.
 */
export function auditSite(
  index: ReportIndex,
  site: ReportSite,
  options: {
    propNames: string[] | null;
    /** The page could not report every prop name: `propNames` is a subset. */
    propNamesLimited?: boolean;
    verified: boolean;
    /**
     * The text hash the running build recorded for each file. The element's
     * own stamp covers only the file it is written in; the component it
     * renders may live in another file that changed since the analysis.
     */
    built?: Record<string, string> | null;
  },
): PropAudit {
  const component = site.target ? index.components.get(site.target) : undefined;

  if (!component) {
    return {
      status: 'unavailable',
      why: 'unsupported',
      title: `<${site.tag}> cannot be analyzed from source`,
      detail:
        (site.unresolved?.detail ?? `${site.tag} is not part of the analysis.`) +
        ' Props it receives may be read there, so none are reported as unused.',
      reason: site.unresolved?.reason ?? 'no-source',
      span: site.span,
    };
  }

  const written = new Set(writtenNames(site));
  const live = options.propNames ? new Set(options.propNames) : null;
  // With a partial list, a name that is missing from it says nothing.
  const partial = !!live && !!options.propNamesLimited;
  const keys = [...new Set([...written, ...(options.propNames ?? [])])].filter(
    (key) => key !== 'key',
  );
  const rows: AuditRow[] = [];

  for (const key of keys) {
    const trace = {
      site,
      input: supplyAt(site, key),
      flow: traceFlow(index, component, key, site),
    };
    const first = trace.input;
    const delivery: Delivery =
      first.supplied === 'attribute' || first.supplied === 'object-spread'
        ? 'written'
        : first.supplied === 'absent'
          ? 'unwritten'
          : 'spread';
    const caveats: string[] = [];

    if (key === 'ref' && !trace.flow.uses.length && !trace.flow.forwards.length) {
      rows.push({
        key,
        tier: 'reserved',
        label: 'Handled by React',
        explanation: component.wrappers.includes('forwardRef')
          ? `${component.name} is wrapped in forwardRef, which receives ref as a second argument instead of a prop.`
          : 'Before React 19, React takes ref off the element and never passes it as a prop. Whether it is unused depends on the React version, so it is not judged here.',
        delivery,
        evidence: delivery === 'unwritten' ? [] : [{ label: 'Passed here', span: first.span }],
        caveats,
        trace,
      });
      continue;
    }

    if (first.uncertain) {
      caveats.push(
        `A spread written after ${key} on this element may replace its value. The verdict is about whichever value arrives.`,
      );
    }

    if (delivery === 'written' && live && !partial && !live.has(key)) {
      caveats.push(
        options.verified
          ? `${key} is written in source but was not on the instance when the page was read.`
          : `${key} is not on the selected instance. The call site was chosen by hand and may be a different one.`,
      );
    }

    let verdict = classify(trace, delivery);
    // Only the element and what lies below it matter here, not who supplied
    // the value further up.
    const outdated =
      options.verified && options.built ? checkBuild(index, trace, options.built) : [];

    if (outdated.length) {
      const files = outdated.map((file) => file.path).join(', ');
      const reason = outdated.some((file) => file.status === 'changed')
        ? `${files} was built from different text than the analysis read`
        : `this build has no record of ${files}`;

      if (
        verdict.tier === 'candidate' ||
        verdict.tier === 'dead-end' ||
        verdict.tier === 'this-render'
      ) {
        verdict = {
          tier: 'unknown',
          label: 'The analysis may be out of date',
          explanation: `No reader of ${key} was found, but ${reason}, so a read may have been added since. Run the analyzer again on the source this page was built from.`,
          evidence: verdict.evidence,
        };
      } else {
        caveats.push(`This may be out of date: ${reason}.`);
      }
    }

    if (
      verdict.tier === 'candidate' ||
      verdict.tier === 'dead-end' ||
      verdict.tier === 'this-render'
    ) {
      const computed = computedHere(trace);

      if (computed) {
        caveats.push(computed);
      }

      if (component.defaults?.[key]) {
        caveats.push(`${component.name} gives ${key} a default value that is also never read.`);
      }
    }

    rows.push({ key, ...verdict, delivery, caveats, trace });
  }

  const notes: string[] = [];
  const unlisted = site.attributes.filter(
    (attribute) => attribute.kind === 'spread' && attribute.source.type !== 'object',
  ).length;

  if (unlisted && !live) {
    notes.push(
      'This element also spreads props whose names cannot be listed from source. They are not shown.',
    );
  } else if (unlisted) {
    notes.push(
      'This element spreads props whose names cannot be listed from source. The names shown for them are the ones on this render.',
    );
  }

  if (partial) {
    notes.push(
      `This instance holds more props than Anatomy reads from the page (${live.size} names were read). Props that are written on the element are all listed. Props that arrive only through a spread may be missing, so this list is not complete.`,
    );
  }

  if (!options.verified) {
    notes.push(
      'This call site was chosen by hand. The page did not confirm that the selected instance came from it.',
    );
  }

  return { status: 'ready', site, component, verified: options.verified, partial, rows, notes };
}

/** The audit for a selection, including the reasons there may be none. */
export function auditSelection(
  index: ReportIndex,
  input: {
    association: Association | null;
    /** A call site the developer chose when the page offered no evidence. */
    chosen?: ReportSite | null;
    propNames: string[] | null;
    /** The page could not report every prop name. */
    propNamesLimited?: boolean;
    /** Whether the page was built with call-site metadata at all. */
    metadata?: boolean;
    /** The per-file text hashes the running build recorded. */
    built?: Record<string, string> | null;
  },
): PropAudit {
  const association = input.association ?? { status: 'none' };

  if (association.status === 'verified') {
    return auditSite(index, association.site, {
      propNames: input.propNames,
      propNamesLimited: input.propNamesLimited,
      verified: true,
      built: input.built,
    });
  }

  if (input.chosen) {
    return auditSite(index, input.chosen, {
      propNames: input.propNames,
      propNamesLimited: input.propNamesLimited,
      verified: false,
    });
  }

  if (association.status === 'stale') {
    return {
      status: 'unavailable',
      why: 'out-of-date',
      title: 'The analysis is out of date',
      detail: `${association.file} changed between the build on this page and the analysis. Positions in it no longer line up, so nothing is reported. Rebuild the page or run the analyzer again.`,
    };
  }

  if (association.status === 'unlisted' || association.status === 'mismatch') {
    return {
      status: 'unavailable',
      why: 'not-analyzed',
      title: 'This element is outside the analysis',
      detail:
        association.status === 'unlisted'
          ? `The element was written in ${association.file}, which was not given to the analyzer.`
          : `The analysis has no component element at the recorded position in ${association.file}. The build plugin and the analyzer may be different versions.`,
    };
  }

  return {
    status: 'unavailable',
    why: 'not-observed',
    title: 'No call site was recorded for this instance',
    detail:
      input.metadata === false
        ? 'This page was built without React Anatomy source metadata, so an instance cannot be matched to the element that created it. Without that, which props the caller passed is a guess.'
        : 'The page has source metadata, but not for this instance. That is normal for the root component and for elements made with createElement or cloneElement, or inside a package. Without a call site, which props the caller passed is a guess.',
  };
}

export const TIER_ORDER: AuditTier[] = [
  'candidate',
  'dead-end',
  'this-render',
  'unknown',
  'indirect',
  'used',
  'reserved',
];

export function countTiers(rows: AuditRow[]) {
  const counts = Object.fromEntries(TIER_ORDER.map((tier) => [tier, 0])) as Record<
    AuditTier,
    number
  >;

  rows.forEach((row) => counts[row.tier]++);

  return counts;
}

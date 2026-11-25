import type {
  Flow,
  Origin,
  ReportComponent,
  ReportFile,
  ReportSite,
  SiteStamp,
  SourceReport,
  Span,
  UnknownReason,
} from './report.ts';
import { siteId } from './report.ts';

// Turns a loaded analysis into the answer for one prop of one component:
// who supplied it, what the receiver does with it, and where it goes next.
// Everything here is a pure function of the report and the evidence read from
// the page, so the same code runs in the panel and in the Node checks.

export interface ReportIndex {
  report: SourceReport;
  components: Map<string, ReportComponent>;
  sites: Map<string, ReportSite>;
  files: Map<string, ReportFile>;
  sitesByTarget: Map<string, ReportSite[]>;
}

export function indexReport(report: SourceReport): ReportIndex {
  const sitesByTarget = new Map<string, ReportSite[]>();

  for (const site of report.sites) {
    if (site.target) {
      const list = sitesByTarget.get(site.target);

      list ? list.push(site) : sitesByTarget.set(site.target, [site]);
    }
  }

  return {
    report,
    components: new Map(report.components.map((component) => [component.id, component])),
    sites: new Map(report.sites.map((site) => [site.id, site])),
    files: new Map(report.files.map((file) => [file.path, file])),
    sitesByTarget,
  };
}

/** Whether the element a mounted component was created from is known in source. */
export type Association =
  | { status: 'verified'; site: ReportSite }
  /** The page was built from different text than the analysis read. */
  | { status: 'stale'; file: string }
  /** The element was written in a file the analysis does not cover. */
  | { status: 'unlisted'; file: string }
  /** Same text, but no component element at that position: mismatched tools. */
  | { status: 'mismatch'; file: string }
  /** No call-site evidence for this instance. */
  | { status: 'none' };

export function associate(index: ReportIndex, stamp: SiteStamp | null): Association {
  if (!stamp) {
    return { status: 'none' };
  }

  const file = index.files.get(stamp.file);

  if (!file) {
    return { status: 'unlisted', file: stamp.file };
  }

  if (file.hash !== stamp.hash) {
    return { status: 'stale', file: stamp.file };
  }

  const site = index.sites.get(siteId(stamp.file, stamp.at));

  return site ? { status: 'verified', site } : { status: 'mismatch', file: stamp.file };
}

/**
 * Call sites that could have produced a component with this name. A name is
 * not evidence about an instance, so these are only ever offered as choices.
 */
export function candidateSites(index: ReportIndex, name: string) {
  return index.report.sites.filter(
    (site) =>
      site.tag === name || (site.target && index.components.get(site.target)?.name === name),
  );
}

export function propNames(index: ReportIndex, site: ReportSite) {
  const names = new Set<string>();

  for (const attribute of site.attributes) {
    if (attribute.kind === 'attr' && attribute.name !== 'key') {
      names.add(attribute.name);
    } else if (attribute.kind === 'spread' && attribute.source.type === 'object') {
      Object.keys(attribute.source.keys).forEach((name) => names.add(name));
    }
  }

  const component = site.target ? index.components.get(site.target) : undefined;

  Object.keys(component?.props ?? {}).forEach((name) => names.add(name));

  return [...names];
}

// ---- Who supplied the value ------------------------------------------------

export interface PropSupply {
  supplied: 'attribute' | 'props-spread' | 'object-spread' | 'unlisted-spread' | 'absent';
  uncertain: boolean;
  span: Span;
  origin?: Origin;
}

export interface SupplyStep extends PropSupply {
  site: ReportSite;
  /** The prop name at this site. */
  key: string;
  owner: ReportComponent | null;
  /** How this element was identified: from the page, or as the only one in source. */
  found: 'start' | 'page' | 'only-site';
  /** The mounted component that received the value at this step, when known. */
  instance?: string;
}

export interface Supply {
  steps: SupplyStep[];
  end:
    | { kind: 'origin'; origin: Extract<Origin, { type: 'local' }> }
    | { kind: 'derived'; keys: string[] }
    | { kind: 'unknown'; detail: string }
    | { kind: 'branches'; component: ReportComponent; sites: ReportSite[] };
}

/**
 * Finds the element through which a component instance was rendered. `cursor`
 * is the value returned for the previous step of the same chain, so a resolver
 * holds no state between traces.
 */
export type OwnerResolver = (
  component: ReportComponent,
  cursor?: number,
) =>
  | { site: ReportSite; found: 'page' | 'only-site'; instance?: string; cursor?: number }
  | { sites: ReportSite[] }
  | { unknown: string }
  | null;

export function staticOwners(index: ReportIndex): OwnerResolver {
  return (component) => {
    const sites = index.sitesByTarget.get(component.id) ?? [];

    return sites.length === 1
      ? { site: sites[0], found: 'only-site' }
      : sites.length
        ? { sites }
        : null;
  };
}

/**
 * Resolves owners among the mounted ancestors of the selected instance,
 * nearest first. `creators` is React's development record of which ancestor
 * created which element. Without it, an ancestor is accepted only when it is
 * the single enclosing instance of the owning component: two nested instances
 * of the same component cannot be told apart by position.
 */
export function liveOwners(
  index: ReportIndex,
  ancestors: { id: string | null; stamp: SiteStamp | null }[],
  creators: number[] | null = null,
  ancestorsLimited = false,
): OwnerResolver {
  const verified = (position: number, component: ReportComponent) => {
    const association = associate(index, ancestors[position]?.stamp ?? null);

    return association.status === 'verified' && association.site.target === component.id
      ? association.site
      : null;
  };

  return (component, cursor = 0) => {
    if (creators) {
      const position = creators[cursor];
      const site = position >= 0 ? verified(position, component) : null;

      return site
        ? { site, found: 'page', instance: ancestors[position].id ?? undefined, cursor: cursor + 1 }
        : null;
    }

    const matches: number[] = [];
    let incomplete = ancestorsLimited;

    for (let position = cursor; position < ancestors.length; position++) {
      const association = associate(index, ancestors[position].stamp);
      if (association.status !== 'verified' || !association.site.target) {
        incomplete = true;
      } else if (association.site.target === component.id) {
        matches.push(position);
      }
    }

    if (matches.length > 1) {
      return {
        unknown: `${matches.length} mounted ${component.name} components enclose this element, and this build does not record which one created it.`,
      };
    }

    if (incomplete) {
      return {
        unknown:
          'The enclosing instances could not all be verified, and this build does not record which one created the element.',
      };
    }

    return matches.length
      ? {
          site: verified(matches[0], component)!,
          found: 'page',
          instance: ancestors[matches[0]].id ?? undefined,
          cursor: matches[0] + 1,
        }
      : null;
  };
}

export function supplyAt(site: ReportSite, key: string): PropSupply {
  let state: Omit<PropSupply, 'uncertain'> | null = null;
  let uncertain = false;

  for (const attribute of site.attributes) {
    if (attribute.kind === 'attr') {
      if (attribute.name === key) {
        state = { supplied: 'attribute', span: attribute.span, origin: attribute.origin };
        uncertain = false;
      }

      continue;
    }

    const source = attribute.source;

    if (source.type === 'object') {
      if (Object.hasOwn(source.keys, key)) {
        state = {
          supplied: 'object-spread',
          span: source.keys[key],
          origin:
            source.origins && Object.hasOwn(source.origins, key) ? source.origins[key] : undefined,
        };
        uncertain = false;
      }
    } else if (source.type === 'props' && source.exclude.includes(key)) {
      continue;
    } else if (state) {
      // An earlier attribute exists, and this spread may or may not carry the key.
      uncertain = true;
    } else {
      state =
        source.type === 'props'
          ? { supplied: 'props-spread', span: attribute.span }
          : { supplied: 'unlisted-spread', span: attribute.span };
    }
  }

  return { ...(state ?? { supplied: 'absent' as const, span: site.span }), uncertain };
}

export function traceSupply(
  index: ReportIndex,
  start: ReportSite,
  key: string,
  owners: OwnerResolver,
  instance?: string,
): Supply {
  const steps: SupplyStep[] = [];
  const seen = new Set<string>();
  let site = start;
  let name = key;
  let found: SupplyStep['found'] = 'start';
  let receiver = instance;
  let cursor: number | undefined;

  for (;;) {
    const identity = JSON.stringify([site.id, name, receiver ?? null]);
    if (seen.has(identity) || steps.length >= 32) {
      return {
        steps,
        end: {
          kind: 'unknown',
          detail: seen.has(identity)
            ? 'The supply chain is recursive and was not followed further.'
            : 'The supply chain reached the limit of 32 steps.',
        },
      };
    }
    seen.add(identity);
    const owner = site.owner ? (index.components.get(site.owner) ?? null) : null;
    const step: SupplyStep = {
      site,
      key: name,
      ...supplyAt(site, name),
      owner,
      found,
      instance: receiver,
    };

    steps.push(step);

    if (step.supplied === 'absent') {
      return {
        steps,
        end: { kind: 'unknown', detail: `This element does not pass ${name} in source.` },
      };
    }

    if (step.supplied === 'unlisted-spread') {
      return {
        steps,
        end: {
          kind: 'unknown',
          detail: `${name} can only come from a spread whose keys cannot be listed from source.`,
        },
      };
    }

    let next: string;

    if (step.supplied === 'props-spread') {
      next = name;
    } else if (step.origin?.type === 'prop') {
      next = step.origin.key;
    } else if (step.origin?.type === 'derived') {
      if (step.origin.keys.length !== 1 || step.origin.keys[0] === '*') {
        return { steps, end: { kind: 'derived', keys: step.origin.keys } };
      }

      next = step.origin.keys[0];
    } else {
      return {
        steps,
        end: step.origin
          ? { kind: 'origin', origin: step.origin }
          : { kind: 'unknown', detail: 'The supplying expression was not recorded.' },
      };
    }

    if (!owner) {
      return {
        steps,
        end: { kind: 'unknown', detail: site.ownerNote ?? 'The supplying component is unknown.' },
      };
    }

    const resolved = owners(owner, cursor);

    if (!resolved) {
      return {
        steps,
        end: {
          kind: 'unknown',
          detail: `${owner.name} receives it as its ${next} prop, but the element that rendered this ${owner.name} could not be identified.`,
        },
      };
    }

    if ('unknown' in resolved) {
      return { steps, end: { kind: 'unknown', detail: resolved.unknown } };
    }

    if ('sites' in resolved) {
      return { steps, end: { kind: 'branches', component: owner, sites: resolved.sites } };
    }

    site = resolved.site;
    found = resolved.found;
    receiver = resolved.instance;
    cursor = resolved.cursor;
    name = next;
  }
}

// ---- What the receiver does with it ---------------------------------------

export type Verdict = 'unused' | 'used' | 'derived' | 'used-forwarded' | 'forwarded' | 'unknown';

export interface Boundary {
  /** The trace stopped at a forwarded prop's destination. */
  outgoing?: true;
  reason: UnknownReason;
  detail: string;
  span: Span;
}

export interface ForwardEdge {
  flow: Extract<Flow, { kind: 'forward' }>;
  site: ReportSite;
  /** The prop name at the receiving element. */
  key: string;
  /** The receiver's own trace, or null where the path cannot be followed. */
  node: TraceNode | null;
}

export interface TraceNode {
  component: ReportComponent;
  key: string;
  uses: Extract<Flow, { kind: 'use' }>[];
  derives: { flow: Extract<Flow, { kind: 'derive' }>; site: ReportSite | undefined }[];
  forwards: ForwardEdge[];
  boundaries: Boundary[];
  verdict: Verdict;
  /** Whether any analyzed code on this path uses the value. */
  consumer: 'found' | 'none' | 'unknown';
  /** Files read to reach this result other than the component's own. */
  consulted: number[];
  headline: string;
}

/**
 * Whether code other than the element's own component can read the element's
 * props. `<Tabs><Tab label="…" /></Tabs>` hands the Tab element to Tabs, which
 * may read `label` from it even though Tab never does. Returns null when the
 * element is rendered directly, or only passes through components that render
 * what they are given.
 */
export function elementExposure(index: ReportIndex, site: ReportSite): Boundary | null {
  return exposure(index, site).boundary;
}

/** The exposure of an element, and every file that was read to decide it. */
function exposure(index: ReportIndex, site: ReportSite) {
  const seen = new Set<string>();
  const files = new Set<number>();
  let placement = site.placement;

  while (placement) {
    if (placement.kind === 'value') {
      return {
        files,
        boundary: {
          reason: 'element-escape',
          detail: `The <${site.tag}> element is ${placement.detail} before it is rendered. Code that holds an element can read its props.`,
          span: site.span,
        } satisfies Boundary,
      };
    }

    const container = index.sites.get(placement.site);
    const attr = placement.attr;
    const receiver = container?.target ? index.components.get(container.target) : undefined;
    const exposed = () => ({
      files,
      boundary: {
        reason: 'element-escape',
        detail: `The <${site.tag}> element is passed to <${container?.tag ?? 'a component'}> as ${attr}, which can read the element's props.`,
        span: container?.span ?? site.span,
      } satisfies Boundary,
    });

    if (container) {
      files.add(container.span.file);
      container.via?.forEach((file) => files.add(file));
    }

    if (!container || !receiver || seen.has(container.id) || container.comparator) {
      return exposed();
    }

    seen.add(container.id);
    // "It only renders what it is given" is a claim about the receiver's file.
    files.add(receiver.span.file);

    const flows = [
      ...(Object.hasOwn(receiver.props, attr) ? receiver.props[attr] : []),
      ...receiver.objects
        .filter((entry) => !entry.exclude.includes(attr))
        .map((entry) => entry.flow),
    ];
    const forwards: Extract<Flow, { kind: 'forward' }>[] = [];

    for (const flow of flows) {
      if (flow.kind === 'use' && flow.how === 'render' && !flow.through) {
        continue;
      }

      if (flow.kind !== 'forward' || !index.sites.has(flow.site)) {
        return exposed();
      }

      forwards.push(flow);
    }

    // The receiver renders the element, drops it, or hands it to one more component.
    if (forwards.length > 1) {
      return exposed();
    }

    if (!forwards.length) {
      break;
    }

    placement = {
      kind: 'component',
      site: forwards[0].site,
      attr: forwards[0].attr === '*' ? attr : forwards[0].attr,
    };
  }

  return { files, boundary: null };
}

const MAX_NODES = 400;
const MAX_DEPTH = 24;

function headline(node: Omit<TraceNode, 'headline'>) {
  if (node.verdict === 'unused') {
    return 'Received, unused here';
  }

  if (node.verdict === 'unknown') {
    return 'Unknown beyond this point';
  }

  if (node.verdict === 'used') {
    return node.uses.every((use) => use.phase === 'event')
      ? 'Used here, only in a deferred event handler'
      : node.uses.every((use) => use.phase === 'effect')
        ? 'Used here, only in an effect'
        : 'Used here';
  }

  if (node.verdict === 'derived') {
    return 'Derived from this prop';
  }

  if (node.verdict === 'used-forwarded') {
    return node.uses.length ? 'Used and forwarded' : 'Forwarded, and derived from';
  }

  return node.consumer === 'none'
    ? 'Forwarded, no consumer found in analyzed code'
    : node.consumer === 'found'
      ? 'Forwarded only here'
      : 'Forwarded here, unknown beyond this point';
}

export function traceFlow(
  index: ReportIndex,
  component: ReportComponent,
  key: string,
  via: ReportSite | null,
): TraceNode {
  let budget = MAX_NODES;

  const visit = (
    current: ReportComponent,
    name: string,
    through: ReportSite | null,
    path: string[],
  ): TraceNode => {
    const refParameter = name === 'ref' ? through?.forwardedRef : undefined;
    const legacyRef = name === 'ref' && index.report.tracksForwardRefSites !== true;
    const flows =
      refParameter || legacyRef
        ? []
        : [
            ...(Object.hasOwn(current.props, name) ? current.props[name] : []),
            ...current.objects
              .filter((entry) => !entry.exclude.includes(name))
              .map((entry) => entry.flow),
          ];
    const node: Omit<TraceNode, 'headline'> = {
      component: current,
      key: name,
      uses: [],
      derives: [],
      forwards: [],
      boundaries: [],
      verdict: 'unknown',
      consumer: 'unknown',
      consulted: [...(through?.via ?? [])],
    };

    if (refParameter || legacyRef) {
      node.boundaries.push({
        reason: 'wrapper',
        detail: refParameter
          ? 'React passes ref to the second argument of this forwardRef render function. Reads through that argument are not analyzed.'
          : 'This analysis predates forwardRef detection. Generate a new analysis to trace ref at this element.',
        span: refParameter ?? current.span,
      });
    }

    if (through?.comparator) {
      node.boundaries.push({
        reason: 'custom-comparator',
        detail:
          'A custom memo comparator receives every prop outside the component body. It is not analyzed.',
        span: through.comparator,
      });
    }

    const exposed = through ? exposure(index, through) : null;

    if (exposed) {
      node.consulted.push(...exposed.files);

      if (exposed.boundary) {
        node.boundaries.push(exposed.boundary);
      }
    }

    for (const flow of flows) {
      if (flow.kind === 'use') {
        node.uses.push(flow);
      } else if (flow.kind === 'unknown') {
        node.boundaries.push(flow);
      } else if (flow.kind === 'derive') {
        node.derives.push({ flow, site: index.sites.get(flow.site) });
      } else {
        const site = index.sites.get(flow.site);
        const target = flow.attr === '*' ? name : flow.attr;

        if (!site) {
          node.boundaries.push({
            outgoing: true,
            reason: 'no-source',
            detail: 'The receiving element is missing from the analysis.',
            span: flow.span,
          });
          continue;
        }

        // An attribute written after a props spread replaces the spread's value.
        if (
          flow.via === 'spread' &&
          site.attributes.some(
            (attribute, position) =>
              position > (flow.index ?? -1) &&
              attribute.kind === 'attr' &&
              attribute.name === target,
          )
        ) {
          continue;
        }

        const receiver = site.target ? index.components.get(site.target) : undefined;
        const id = `${site.target}\n${target}`;
        let child: TraceNode | null = null;

        if (!receiver) {
          node.boundaries.push({
            outgoing: true,
            reason: site.unresolved?.reason ?? 'no-source',
            detail: site.unresolved?.detail ?? `${site.tag} is not part of the analysis.`,
            span: flow.span,
          });
        } else if (path.includes(id)) {
          node.boundaries.push({
            outgoing: true,
            reason: 'recursive',
            detail: `${receiver.name} receives ${target} again further down. Recursive paths are not resolved.`,
            span: flow.span,
          });
        } else if (path.length >= MAX_DEPTH || budget-- <= 0) {
          node.boundaries.push({
            outgoing: true,
            reason: 'limit',
            detail: 'The path is longer than this trace follows.',
            span: flow.span,
          });
        } else {
          child = visit(receiver, target, site, [...path, id]);
        }

        node.forwards.push({ flow, site, key: target, node: child });
      }
    }

    const fallback = refParameter || legacyRef ? undefined : current.defaults?.[name];

    // Passing the prop is what keeps an effectful default from running.
    if (fallback?.effectful && Object.hasOwn(current.defaults!, name)) {
      node.boundaries.push({
        reason: 'effectful-default',
        detail: `${name} has a default value that runs code. Whether the prop is passed changes what runs.`,
        span: fallback.span,
      });
    }

    const used = node.uses.length > 0 || node.derives.length > 0;
    const children = node.forwards.map((edge) => edge.node);

    node.verdict = used
      ? node.forwards.length
        ? 'used-forwarded'
        : node.uses.length
          ? 'used'
          : 'derived'
      : node.forwards.length
        ? 'forwarded'
        : node.boundaries.length
          ? 'unknown'
          : 'unused';
    node.consumer =
      used || children.some((child) => child?.consumer === 'found')
        ? 'found'
        : node.boundaries.length || children.some((child) => child?.consumer !== 'none')
          ? 'unknown'
          : 'none';

    return { ...node, headline: headline(node) };
  };

  return visit(component, key, via, [`${component.id}\n${key}`]);
}

export interface PropTrace {
  site: ReportSite;
  key: string;
  supply: Supply;
  /** Null when the element's component was not analyzed. */
  flow: TraceNode | null;
  boundary?: Boundary;
  headline: string;
  /** A short qualification of the headline, when one is needed. */
  caveat?: string;
}

export function traceProp(
  index: ReportIndex,
  site: ReportSite,
  key: string,
  owners: OwnerResolver,
  instance?: string,
): PropTrace {
  const supply = traceSupply(index, site, key, owners, instance);
  const component = site.target ? index.components.get(site.target) : undefined;

  if (!component) {
    const boundary: Boundary = {
      reason: site.unresolved?.reason ?? 'no-source',
      detail: site.unresolved?.detail ?? `${site.tag} is not part of the analysis.`,
      span: site.span,
    };

    return { site, key, supply, flow: null, boundary, headline: 'Unknown beyond this point' };
  }

  const flow = traceFlow(index, component, key, site);
  const first = supply.steps[0];
  const closed = flow.verdict === 'unused' || flow.consumer === 'none';

  // "Unused" is a claim about a value that was really delivered.
  if (closed && (first.supplied === 'absent' || first.supplied === 'unlisted-spread')) {
    return {
      site,
      key,
      supply,
      flow,
      headline: 'No use found in this receiver',
      caveat: `Source does not show this element passing ${key}, so delivery is not confirmed.`,
    };
  }

  return {
    site,
    key,
    supply,
    flow,
    headline: flow.headline,
    ...(first.uncertain
      ? { caveat: 'A later spread on this element may replace the value shown here.' }
      : flow.boundaries.length && flow.verdict !== 'unknown'
        ? { caveat: 'Some paths from here could not be analyzed.' }
        : {}),
  };
}

// ---- Is the running build the analyzed text? --------------------------------

export interface BuildMismatch {
  path: string;
  /** `changed`: built from other text. `missing`: the build recorded no hash for the file. */
  status: 'changed' | 'missing';
}

/**
 * Compares every file a trace relies on with the hashes the running build
 * recorded. The selected element's own stamp only covers the file it was
 * written in; a receiver further down lives in another file, which may have
 * been edited since the analysis was made.
 */
export function checkBuild(
  index: ReportIndex,
  trace: { site: ReportSite; flow: TraceNode | null; supply?: Supply },
  built: Record<string, string>,
): BuildMismatch[] {
  const files = new Set<number>();

  const element = (site: ReportSite | undefined) => {
    if (!site) {
      return;
    }

    files.add(site.span.file);
    site.via?.forEach((file) => files.add(file));

    // An object spread decides which attribute supplies a prop.
    for (const attribute of site.attributes) {
      if (attribute.kind === 'spread' && attribute.source.type === 'object') {
        Object.values(attribute.source.keys).forEach((span) => files.add(span.file));
      }
    }
  };

  const visit = (node: TraceNode | null) => {
    if (!node) {
      return;
    }

    files.add(node.component.span.file);
    node.consulted.forEach((file) => files.add(file));
    node.boundaries.forEach((boundary) => files.add(boundary.span.file));
    node.derives.forEach(({ site }) => element(site));

    for (const edge of node.forwards) {
      element(edge.site);
      visit(edge.node);
    }
  };

  for (const step of trace.supply?.steps ?? []) {
    element(step.site);
    files.add(step.span.file);
  }

  if (trace.supply?.end.kind === 'origin' && trace.supply.end.origin.span) {
    files.add(trace.supply.end.origin.span.file);
  }

  // The element's own receiver may be unresolved; its resolution path still counts.
  element(trace.site);
  visit(trace.flow);

  const mismatches: BuildMismatch[] = [];

  for (const file of files) {
    const { path, hash } = index.report.files[file];

    if (!Object.hasOwn(built, path)) {
      mismatches.push({ path, status: 'missing' });
    } else if (built[path] !== hash) {
      mismatches.push({ path, status: 'changed' });
    }
  }

  return mismatches.sort((a, b) => a.path.localeCompare(b.path));
}

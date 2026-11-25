// The source analysis exchanged between the local analyzer and the inspector.
// The analyzer writes it from source files on the developer's machine; the
// panel reads it from a file the developer chooses. Nothing here is uploaded.

export const REPORT_FORMAT = 'react-anatomy-source-trace';
export const REPORT_VERSION = 1;
export const REPORT_MAX_BYTES = 24 * 1024 * 1024;

/** The global written by instrumented builds. See scripts/source-trace/instrument.ts. */
export const SOURCE_REGISTRY_KEY = '__REACT_ANATOMY_SOURCE_V1__';

/** Written by an instrumented build next to the props of each component element. */
export interface SiteStamp {
  file: string;
  hash: string;
  /** Offset of the JSX element in the file's text. */
  at: number;
}

/** What the page agent reads for one mounted component. Positions and hashes only. */
export interface SourceEvidence {
  /** Whether the page was built with call-site metadata at all. */
  metadata: boolean;
  name: string;
  self: SiteStamp | null;
  /** Names of the props the instance currently holds. Values stay in the page. */
  propNames: string[];
  /** The instance holds more props than `propNames` lists: a name was cut by a bound, or could not be read. */
  propNamesLimited: boolean;
  /** The enclosing component list reached a traversal limit. */
  ancestorsLimited: boolean;
  /** Enclosing components, nearest first. */
  ancestors: { id: string | null; name: string; stamp: SiteStamp | null }[];
  /** Stamped components below the selection. */
  descendants: { id: string | null; name: string; stamp: SiteStamp }[];
  /**
   * From React's development owner record: the position in `ancestors` of the
   * component that created this one, then of the one that created that, and so
   * on. -1 ends the list where the creator is not an enclosing component. Null
   * when the build keeps no owner record (a production build).
   */
  creators: number[] | null;
  /** The text hash the running build recorded for each instrumented file. */
  files: Record<string, string>;
  /** A bound was reached while reading neighbors or files; `ancestors`, `descendants` or `files` are incomplete. */
  limited: boolean;
}

export interface ReportFile {
  path: string;
  /** Hash of the exact text that was analyzed. An instrumented build stamps the same hash. */
  hash: string;
}

export interface Span {
  file: number;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  /** The first source line of the span, without its indentation. */
  text: string;
  /** The part of `text` the evidence refers to. */
  mark: [number, number];
}

/** When the code containing a reference runs. */
export type Phase = 'render' | 'effect' | 'event' | 'closure';

export type UseHow =
  | 'render'
  | 'host-prop'
  | 'host-handler'
  | 'condition'
  | 'call'
  | 'call-argument'
  | 'hook'
  | 'hook-dependency'
  | 'iterated'
  | 'key'
  | 'assigned'
  | 'destructured'
  | 'return'
  | 'expression';

export type DeriveHow = 'projection' | 'transform' | 'item' | 'spread' | 'closure';

export type UnknownReason =
  | 'props-escape'
  | 'dynamic-key'
  | 'nested-pattern'
  | 'custom-comparator'
  | 'no-source'
  | 'wrapper'
  | 'lazy'
  | 'dynamic-component'
  | 'class-component'
  | 'react-builtin'
  | 'unresolved-spread'
  | 'element-escape'
  | 'effectful-default'
  | 'reassigned'
  | 'recursive'
  | 'limit';

/** One thing a component does with the value of one incoming prop. */
export type Flow =
  | {
      kind: 'forward';
      /** The receiving call site. */
      site: string;
      /** The receiving prop name; `*` keeps the incoming name (a props spread). */
      attr: string;
      via: 'attribute' | 'spread' | 'children';
      /** For a spread: its position among the site's attributes. */
      index?: number;
      conditional?: boolean;
      phase: Phase;
      span: Span;
    }
  | {
      kind: 'derive';
      site: string;
      attr: string;
      how: DeriveHow;
      phase: Phase;
      span: Span;
    }
  | {
      kind: 'use';
      how: UseHow;
      detail: string;
      /** The value went through this call before it reached the use. */
      through?: string;
      phase: Phase;
      span: Span;
    }
  | { kind: 'unknown'; reason: UnknownReason; detail: string; span: Span };

export interface ReportComponent {
  id: string;
  name: string;
  span: Span;
  /** How the component declares its props parameter. */
  params: 'none' | 'destructured' | 'object';
  wrappers: string[];
  /**
   * Props destructured with a default value. `effectful` is false only when
   * the default is a literal, a function expression, or an array or object
   * literal made only of those.
   */
  defaults?: Record<string, { span: Span; effectful: boolean }>;
  /** Flows for props the component names. */
  props: Record<string, Flow[]>;
  /** Flows that apply to every prop except the excluded names: a props object or a rest element. */
  objects: { exclude: string[]; flow: Flow }[];
}

export type Origin =
  | { type: 'prop'; key: string; conditional?: boolean }
  | { type: 'derived'; keys: string[]; how: DeriveHow }
  | {
      type: 'local';
      what:
        | 'state'
        | 'hook'
        | 'function'
        | 'const'
        | 'module'
        | 'import'
        | 'param'
        | 'literal'
        | 'jsx'
        | 'expression';
      detail: string;
      span?: Span;
    };

export type SpreadSource =
  | { type: 'props'; exclude: string[] }
  | { type: 'value'; origin: Origin }
  | { type: 'object'; name: string; keys: Record<string, Span>; origins?: Record<string, Origin> }
  | { type: 'unknown'; detail: string };

export type SiteAttribute =
  | { kind: 'attr'; name: string; span: Span; origin: Origin }
  | { kind: 'spread'; span: Span; source: SpreadSource };

/** One JSX element that renders a component: `<Row item={project} />`. */
export interface ReportSite {
  /** `<file path>@<offset>`; an instrumented build stamps the same pair on the element's props. */
  id: string;
  tag: string;
  span: Span;
  /** The component this element renders, when its implementation was analyzed. */
  target: string | null;
  unresolved?: { reason: UnknownReason; detail: string };
  /**
   * Other files whose declarations were read to resolve the tag: an alias or a
   * `memo` wrapper declared apart from the element and the component.
   */
  via?: number[];
  /** A custom `memo` comparator between this site and its target. */
  comparator?: Span;
  /** The element passes ref to a forwardRef render function's second argument. */
  forwardedRef?: Span;
  /**
   * Where the created element goes. Absent means it is rendered: returned from
   * the creating function, or nested only in host elements, fragments, and
   * React built-ins. Code that receives an element can read its props without
   * the element's own component reading them.
   */
  placement?: { kind: 'component'; site: string; attr: string } | { kind: 'value'; detail: string };
  /** The component whose code creates this element. */
  owner: string | null;
  ownerNote?: string;
  attributes: SiteAttribute[];
}

export interface SourceReport {
  format: typeof REPORT_FORMAT;
  version: typeof REPORT_VERSION;
  /** Earlier reports did not distinguish a plain call site from forwardRef. */
  tracksForwardRefSites?: true;
  generatedAt: string;
  /** A label for the analyzed project; never an absolute path. */
  label: string;
  files: ReportFile[];
  components: ReportComponent[];
  sites: ReportSite[];
  notes: string[];
}

export function siteId(path: string, offset: number) {
  return `${path}@${offset}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validSpan(span: unknown, files: number) {
  return (
    isRecord(span) &&
    Number.isInteger(span.file) &&
    (span.file as number) >= 0 &&
    (span.file as number) < files &&
    Number.isInteger(span.line) &&
    Number.isInteger(span.column) &&
    typeof span.text === 'string' &&
    Array.isArray(span.mark) &&
    span.mark.length === 2 &&
    span.mark.every((value) => Number.isInteger(value))
  );
}

function validFlow(flow: unknown, files: number) {
  if (!isRecord(flow) || !validSpan(flow.span, files)) {
    return false;
  }

  if (flow.kind === 'forward' || flow.kind === 'derive') {
    return typeof flow.site === 'string' && typeof flow.attr === 'string';
  }

  if (flow.kind === 'use') {
    return typeof flow.how === 'string' && typeof flow.detail === 'string';
  }

  return (
    flow.kind === 'unknown' && typeof flow.reason === 'string' && typeof flow.detail === 'string'
  );
}

function validOrigin(origin: unknown, files: number): boolean {
  if (!isRecord(origin)) {
    return false;
  }

  if (origin.type === 'prop') {
    return typeof origin.key === 'string';
  }

  if (origin.type === 'derived') {
    return Array.isArray(origin.keys) && origin.keys.every((key) => typeof key === 'string');
  }

  return (
    origin.type === 'local' &&
    typeof origin.what === 'string' &&
    typeof origin.detail === 'string' &&
    (origin.span === undefined || validSpan(origin.span, files))
  );
}

function validAttribute(attribute: unknown, files: number) {
  if (!isRecord(attribute) || !validSpan(attribute.span, files)) {
    return false;
  }

  if (attribute.kind === 'attr') {
    return typeof attribute.name === 'string' && validOrigin(attribute.origin, files);
  }

  const source = attribute.source;

  if (attribute.kind !== 'spread' || !isRecord(source)) {
    return false;
  }

  if (source.type === 'props') {
    return Array.isArray(source.exclude) && source.exclude.every((key) => typeof key === 'string');
  }

  if (source.type === 'value') {
    return validOrigin(source.origin, files);
  }

  if (source.type === 'object') {
    return (
      typeof source.name === 'string' &&
      isRecord(source.keys) &&
      Object.values(source.keys).every((span) => validSpan(span, files)) &&
      (source.origins === undefined ||
        (isRecord(source.origins) &&
          Object.values(source.origins).every((origin) => validOrigin(origin, files))))
    );
  }

  return source.type === 'unknown' && typeof source.detail === 'string';
}

/**
 * Reads a report chosen by the developer. The file is local but still
 * untrusted input: every field the inspector dereferences is checked here, so
 * a damaged or foreign file is rejected instead of half-rendered.
 */
export function parseReport(
  text: string,
): { ok: true; report: SourceReport } | { ok: false; message: string } {
  if (text.length > REPORT_MAX_BYTES) {
    return { ok: false, message: 'This file is too large to be a source analysis (24 MB limit).' };
  }

  let data: unknown;

  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, message: 'This file is not valid JSON.' };
  }

  if (!isRecord(data) || data.format !== REPORT_FORMAT) {
    return { ok: false, message: 'This file is not a React Anatomy source analysis.' };
  }

  if (data.version !== REPORT_VERSION) {
    return {
      ok: false,
      message: `This analysis uses format version ${String(data.version).slice(0, 12)}. This inspector reads version ${REPORT_VERSION}. Generate it again with the matching analyzer.`,
    };
  }

  const { files, components, sites, notes } = data;

  if (
    !Array.isArray(files) ||
    !Array.isArray(components) ||
    !Array.isArray(sites) ||
    !Array.isArray(notes) ||
    typeof data.label !== 'string' ||
    typeof data.generatedAt !== 'string'
  ) {
    return { ok: false, message: 'This source analysis is incomplete.' };
  }

  const count = files.length;
  const filesValid = files.every(
    (file) => isRecord(file) && typeof file.path === 'string' && typeof file.hash === 'string',
  );
  const componentsValid = components.every(
    (component) =>
      isRecord(component) &&
      typeof component.id === 'string' &&
      typeof component.name === 'string' &&
      validSpan(component.span, count) &&
      typeof component.params === 'string' &&
      Array.isArray(component.wrappers) &&
      isRecord(component.props) &&
      Object.values(component.props).every(
        (flows) => Array.isArray(flows) && flows.every((flow) => validFlow(flow, count)),
      ) &&
      (component.defaults === undefined ||
        (isRecord(component.defaults) &&
          Object.values(component.defaults).every(
            (entry) =>
              isRecord(entry) &&
              validSpan(entry.span, count) &&
              typeof entry.effectful === 'boolean',
          ))) &&
      Array.isArray(component.objects) &&
      component.objects.every(
        (entry) =>
          isRecord(entry) &&
          Array.isArray(entry.exclude) &&
          entry.exclude.every((key) => typeof key === 'string') &&
          validFlow(entry.flow, count),
      ),
  );
  const sitesValid = sites.every(
    (site) =>
      isRecord(site) &&
      typeof site.id === 'string' &&
      typeof site.tag === 'string' &&
      validSpan(site.span, count) &&
      (site.target === null || typeof site.target === 'string') &&
      (site.owner === null || typeof site.owner === 'string') &&
      (site.unresolved === undefined ||
        (isRecord(site.unresolved) &&
          typeof site.unresolved.reason === 'string' &&
          typeof site.unresolved.detail === 'string')) &&
      (site.comparator === undefined || validSpan(site.comparator, count)) &&
      (site.forwardedRef === undefined || validSpan(site.forwardedRef, count)) &&
      (site.placement === undefined ||
        (isRecord(site.placement) &&
          (site.placement.kind === 'component'
            ? typeof site.placement.site === 'string' && typeof site.placement.attr === 'string'
            : site.placement.kind === 'value' && typeof site.placement.detail === 'string'))) &&
      (site.via === undefined ||
        (Array.isArray(site.via) &&
          site.via.every((file) => Number.isInteger(file) && file >= 0 && file < count))) &&
      (site.ownerNote === undefined || typeof site.ownerNote === 'string') &&
      Array.isArray(site.attributes) &&
      site.attributes.every((attribute) => validAttribute(attribute, count)),
  );

  if (
    !filesValid ||
    !componentsValid ||
    !sitesValid ||
    !notes.every((note) => typeof note === 'string')
  ) {
    return { ok: false, message: 'This source analysis is damaged or was edited by hand.' };
  }

  return { ok: true, report: data as unknown as SourceReport };
}

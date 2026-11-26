// The contract for "Find same reference". The inspected page compares raw
// values by identity and returns only this metadata: names, keys, instance IDs
// and counts. The compared values never leave the page.

export interface ReferenceRequest {
  /** The instance whose prop is the reference to look for. */
  id: string;
  /** A top-level prop name, or a symbol's description when `symbol` is set. */
  name: string;
  symbol?: boolean;
  /** Search this component's subtree, plus the ancestors of the instance. */
  scopeId?: string;
  /** Returned by an earlier search. Rejects IDs that belong to a previous document. */
  epoch?: string;
  maxComponents?: number;
}

export interface ReferenceMatch {
  id: string;
  name: string;
  key: string | null;
  /** Top-level props holding the reference. Empty for a gap. */
  props: string[];
  moreProps: number;
  /** The nearest named ancestors, outermost first. */
  path: string[];
  pathTruncated: boolean;
  /** A gap is an ancestor without the reference, below one that has it. */
  relation: 'source' | 'ancestor' | 'descendant' | 'other' | 'gap';
  /** Above the searched subtree. */
  outside: boolean;
}

export interface ReferenceCoverage {
  components: number;
  /** Accessor props that were skipped rather than evaluated. */
  accessors: number;
  /** Components whose props object could not be reflected. */
  unreadable: number;
  /** Components with more props than one search compares. */
  keyLimited: number;
  /** Why the search stopped before visiting the whole scope. */
  limit: 'components' | 'matches' | 'fibers' | 'time' | null;
  /** Whether every ancestor above the searched subtree was resolved. */
  ancestors: boolean;
  roots: number;
}

export interface ReferenceSearch {
  epoch: string;
  observedAt: number;
  source: {
    id: string;
    name: string;
    key: string | null;
    prop: string;
    type: string;
    preview: string;
  };
  scope: { id: string; name: string } | null;
  matches: ReferenceMatch[];
  coverage: ReferenceCoverage;
}

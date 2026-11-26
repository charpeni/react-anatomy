import type { PropValue, Result } from './types.ts';

// "Who reads this context" rests on three kinds of evidence. Each response
// field below belongs to exactly one of them, and the panel labels it as such:
//
// - Dependencies: the context list React keeps on a Fiber from its latest
//   render. It says a component subscribed. It says nothing about renders.
// - Sampled values: identity tokens for the provider's value and for the value
//   each reader last read, taken when the list is read. Two samples can show
//   that a reader read a new value. They cannot count renders.
// - Measured renders: counts taken inside React's commit hook while the user
//   records. Only this evidence is a render count.

export interface ContextOwner {
  id: string;
  name: string;
}

export interface ContextProviderSummary {
  /** A provider Fiber's ID, or `default:<contextId>@<root>` for a root's readers with no provider above them. */
  key: string;
  kind: 'provider' | 'default';
  /** Identifies the context object. Two contexts can share a display name. */
  contextId: string;
  name: string | null;
  /** The nearest component above the provider. */
  owner: ContextOwner | null;
  /** Components that read this provider's value, from dependencies. */
  readers: number;
  /** The scan could not finish for this group: `readers` is a lower bound. */
  atLeast: boolean;
  /** The provider of the same context that this one shadows. */
  shadows: string | null;
  root: number;
}

export interface ContextOverview {
  providers: ContextProviderSummary[];
  /** Provider keys the requested component reads, then the providers above it, nearest first. */
  reads: string[];
  above: string[];
  roots: number;
  /** Changes when the page reloads: provider keys from another session mean nothing here. */
  session: string;
  limited: boolean;
  recording: ContextRecording;
  readAt: number;
}

export interface ContextMeasured {
  /**
   * Commits in which React rendered this component while recording: those where
   * its Fiber carries PerformedWork. Calls React discarded are not included.
   */
  renders: number;
  /** Of those, commits in which the provider it reads committed a new value. */
  withNewValue: number;
  /** Mounted while recording; its first render is included in `renders`. */
  mounted: boolean;
}

export interface ContextReader {
  /** The component instance to navigate to. */
  id: string;
  name: string;
  key: string | null;
  /** `consumer`: a `<Context.Consumer>` rendered by this component reads the value. */
  via: 'component' | 'consumer';
  memo: boolean;
  portal: boolean;
  /** Sampled: identity of the value this reader last read, where React records it. */
  valueToken?: string;
  /** Sampled: whether that is the provider's current value. */
  current?: boolean;
  measured?: ContextMeasured;
}

export interface ContextBystander {
  id: string;
  name: string;
  key: string | null;
  memo: boolean;
  measured?: ContextMeasured;
}

export interface ContextRecording {
  /** Whether React reports commits to a hook this page already has. */
  capability: 'ready' | 'unavailable';
  active: boolean;
  /** True once a recording has started, until it is cleared. */
  recorded: boolean;
  commits: number;
  startedAt?: number;
  stoppedAt?: number;
  /** A work limit was reached: counts are lower bounds. */
  limited: boolean;
}

export interface ContextReaders {
  provider: {
    key: string;
    kind: 'provider' | 'default';
    contextId: string;
    name: string | null;
    owner: ContextOwner | null;
    /** A preview of the current value. Absent for the default value. */
    value: PropValue | null;
    /** Sampled: identity of the provider's current value. */
    valueToken: string | null;
    /** Measured: commits in which this provider committed a new value. */
    valueChanges?: number;
  };
  readers: ContextReader[];
  /** Providers of the same context below this one. Their readers do not read this value. */
  nested: { key: string; owner: ContextOwner | null; readers: number }[];
  /** Components below the provider with no dependency on it. Null for the default value. */
  bystanders: ContextBystander[] | null;
  /**
   * `unchecked` counts components whose dependency list was too long to finish
   * and did not show this context. They are in neither list.
   */
  totals: { readers: number; bystanders: number; unchecked: number };
  /** Tokens from different epochs cannot be compared. */
  epoch: string;
  limited: boolean;
  recording: ContextRecording;
  readAt: number;
}

export interface ContextRequests {
  contexts: { id?: string };
  'context-readers': { key: string };
  'context-record': { command: 'start' | 'stop' | 'clear' };
}

export interface ContextResponses {
  contexts: ContextOverview;
  'context-readers': Result<ContextReaders>;
  'context-record': Result<{ recording: ContextRecording }>;
}

/** The private React field read to find readers. */
export interface ContextDependency {
  context: object;
  memoizedValue?: unknown;
  next: ContextDependency | null;
}

export interface ContextRenderRecord {
  renders: number;
  mounted: boolean;
  /** Renders in a commit where the nearest provider of that context changed value, by context ID. */
  withNewValue: Record<string, number>;
}

export interface ContextRecorder {
  active: boolean;
  startedAt: number;
  stoppedAt?: number;
  commits: number;
  limited: boolean;
  renders: Map<string, ContextRenderRecord>;
  valueChanges: Map<string, number>;
  stop: () => void;
}

export interface ContextAgentState {
  contextIds?: WeakMap<object, string>;
  contextSequence?: number;
  contextSession?: string;
  contextValues?: {
    epoch: string;
    sequence: number;
    objects: WeakMap<object, string>;
    primitives: Map<unknown, string>;
  };
  contextRecorder?: ContextRecorder;
}

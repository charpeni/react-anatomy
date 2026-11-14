import type { PropValue, Snapshot } from './types.ts';

export interface FiberTypeInfo {
  displayName?: string;
  name?: string;
  render?: FiberType;
  type?: FiberType;
}

export type FiberType =
  | string
  | FiberTypeInfo
  | (FiberTypeInfo & ((...args: never[]) => unknown))
  | null;

/** Only the private React fields read by the inspector. */
export interface Fiber {
  tag: number;
  type: FiberType;
  key: string | null;
  stateNode: unknown;
  memoizedProps: unknown;
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
  alternate: Fiber | null;
}

export interface FiberRoot {
  current: Fiber | null;
}

export interface PropSession {
  id: string;
  props: unknown;
  values: Map<string, { value: unknown; kind: string }>;
  seen: WeakMap<object, string>;
}

export interface AgentState {
  version: number;
  revision: number;
  sequence: number;
  hostSequence: number;
  fiberIds: WeakMap<Fiber, string>;
  hostIds: WeakMap<Element, string>;
  elements: Map<string, Element[]>;
  owners: WeakMap<Element, string>;
  picked: string | null;
  observer: MutationObserver | null;
  overlay: HTMLDivElement | null;
  picker: {
    move: (event: PointerEvent) => void;
    click: (event: MouseEvent) => void;
    key: (event: KeyboardEvent) => void;
  } | null;
  lease: ReturnType<typeof setTimeout> | null;
  highlightTimer?: ReturnType<typeof setTimeout>;
  invalidate?: () => void;
  rootHandles: FiberRoot[];
  propSessions: Map<string, PropSession>;
  propSequence: number;
  jobSequence?: number;
  captureJob?: { token: string; iterator: Generator<void, Snapshot> };
  searchJob?: {
    token: string;
    query: string;
    scopeId?: string;
    queue: Fiber[];
    offset: number;
    matches: number;
    revision: number;
  };
}

export interface StoredPropEntry {
  key: string;
  name: string;
  symbol?: boolean;
  value: PropValue;
}

declare global {
  interface Window {
    __REACT_ANATOMY_INSPECTOR_V1__?: AgentState;
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: {
      renderers: Map<number, unknown>;
      getFiberRoots: (rendererId: number) => Set<FiberRoot>;
    };
  }
}

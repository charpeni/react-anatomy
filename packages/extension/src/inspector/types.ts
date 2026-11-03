export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ComponentNode {
  id: string;
  name: string;
  key: string | null;
  parent: string | null;
  children: string[];
  depth: number;
  hosts: string[];
  bounds: Frame | null;
  frame: Frame | null;
  portal: boolean;
}

export interface CaptureBudget {
  maxComponents?: number;
  maxDepth?: number;
}

export interface CaptureLimits {
  components: number;
  depth: number;
  maximum: { components: number; depth: number };
  hit: { components: boolean; depth: boolean };
}

export interface Snapshot {
  version: number;
  status: 'ready' | 'no-react';
  nodes: ComponentNode[];
  url: string;
  title: string;
  capturedAt: number;
  revision: number;
  viewport: { width: number; height: number; scrollX: number; scrollY: number };
  rootCount: number;
  message?: string;
  html?: string;
  fonts?: string;
  hostRects?: Record<string, Frame>;
  warnings?: string[];
  truncated?: boolean;
  limits?: CaptureLimits;
  captureMs?: number;
  elementCount?: number;
}

export interface Layer extends ComponentNode {
  frame: Frame;
  layerDepth: number;
  layerChildren: string[];
}

export interface SceneLayer extends Layer {
  sceneDepth: number;
  sceneChildren: string[];
}

export interface PropValue {
  type: string;
  preview: string;
  handle?: string;
  expandable?: boolean;
}

export interface PropEntry {
  key: string;
  name: string;
  symbol?: boolean;
  value: PropValue;
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export interface PropInspection {
  token: string;
  root: PropValue;
  readAt: number;
}

export interface PropPage {
  entries?: PropEntry[];
  text?: string;
  total: number;
  nextOffset: number | null;
  limited: boolean;
}

export interface PageRequests {
  capture: CaptureBudget;
  status: object;
  props: { id: string };
  'props-read': { token: string; handle: string; offset: number; filter?: string };
  'props-release': { token: string };
  highlight: { id: string };
  element: { id: string };
  clear: object;
  dispose: object;
  pick: object;
}

export interface PageResponses {
  capture: Snapshot;
  status: {
    revision: number;
    picking: boolean;
    picked: string | null;
    url: string;
    title: string;
    expired: boolean;
  };
  props: Result<PropInspection>;
  'props-read': Result<PropPage>;
  'props-release': Result;
  highlight: Result;
  element: Element | null;
  clear: Result;
  dispose: Result;
  pick: Result;
}

export type PageCall = <Action extends keyof PageRequests>(
  request: { action: Action } & PageRequests[Action],
) => Promise<PageResponses[Action]>;

export interface Transport {
  mode: 'devtools' | 'window';
  call: PageCall;
  inspect?: (id: string) => Promise<Result>;
  onNavigate: (callback: () => void) => () => void;
}

export type PageRequest = {
  [Action in keyof PageRequests]: { action: Action } & PageRequests[Action];
}[keyof PageRequests];

export type PageResponse = PageResponses[keyof PageResponses];

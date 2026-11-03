export interface Point {
  x: number;
  y: number;
}
export interface Box extends Point {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface Rect extends Point {
  w: number;
  h: number;
}
export interface Cue {
  text: string;
  start: number;
  end: number;
  file?: string;
  lines?: number;
}
export interface ClipScript {
  id: string;
  cues: string[];
  say?: string;
}
export interface NarrationScript {
  model: string;
  voice: string;
  instructions: string;
  clips: ClipScript[];
}
export interface NarrationClip {
  id: string;
  file: string;
  duration: number;
  text: string;
  cues: Cue[];
  model?: string;
  format?: string;
}
export interface Narration {
  clips: NarrationClip[];
  provider?: string;
  model?: string;
  voice?: string;
  [key: string]: unknown;
}
export type Cursor = { start: number; end: number } & (
  | { hide: true; from?: never; to?: never }
  | { hide?: false; from: Point; to: Point }
);
export interface IntroTimeline {
  url: string;
  fps: number;
  duration: number;
  frames: { start: number; page: string | null; dev: string | null }[];
  cursor: Cursor[];
  clicks: (Point & { time: number })[];
  camera: { start: number; duration: number; rect: Point & { w: number } }[];
  keys: { start: number; end: number; label: string[] }[];
  speech: { id: string; start: number }[];
  events: Record<string, number>;
}

export interface DemoTimeline {
  url: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  frames: { file: string; duration: number }[];
  captions: { start: number; end: number | null; title: string; detail: string; chapter: string }[];
  chapters: { start: number; name: string }[];
  cursors: { start: number; end: number; from: Point; to: Point }[];
  clicks: (Point & { time: number })[];
}

export interface RenderedCue extends Cue {
  file: string;
  lines: number;
}

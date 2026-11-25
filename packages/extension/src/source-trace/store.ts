import type { ReportIndex } from './trace.ts';
import { useSyncExternalStore } from 'react';
import { REPORT_MAX_BYTES, parseReport } from './report.ts';
import { indexReport } from './trace.ts';

// The loaded analysis outlives the selected component, so it is kept here
// rather than in a component. It lives in memory only: closing the panel
// forgets it, and it is never written to extension storage.

interface SourceState {
  index: ReportIndex | null;
  fileName: string | null;
  error: string | null;
  /** The prop being traced. Set from the Props inspector or from this section. */
  prop: string | null;
  open: boolean;
}

let state: SourceState = { index: null, fileName: null, error: null, prop: null, open: false };
const listeners = new Set<() => void>();

function update(next: Partial<SourceState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

export function useSourceReport() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    () => state,
  );
}

let fileRequest = 0;

export async function loadReport(file: Pick<File, 'name' | 'size' | 'text'>) {
  const request = ++fileRequest;
  if (file.size > REPORT_MAX_BYTES) {
    update({ error: 'This file is too large to be a source analysis (24 MB limit).' });

    return;
  }

  let text: string;

  try {
    text = await file.text();
  } catch {
    if (request === fileRequest) {
      update({ error: 'The file could not be read.' });
    }

    return;
  }

  if (request !== fileRequest) {
    return;
  }

  const parsed = parseReport(text);

  if (parsed.ok) {
    update({ index: indexReport(parsed.report), fileName: file.name, error: null });
  } else {
    update({ error: parsed.message });
  }
}

export function clearReport() {
  fileRequest++;
  update({ index: null, fileName: null, error: null, prop: null });
}

export function setSourceTraceOpen(open: boolean) {
  if (open !== state.open) {
    update({ open });
  }
}

/** Chooses the prop to trace for the selected component. */
export function selectTracedProp(key: string | null, reveal = true) {
  if (key !== state.prop || (reveal && state.index && !state.open)) {
    update({ prop: key, ...(reveal && state.index && key !== null ? { open: true } : {}) });
  }
}

/** The top-level prop a path in the Props inspector belongs to: `props.project.name` is `project`. */
export function topLevelProp(path: string) {
  const dotted = /^props\.([A-Za-z_$][\w$]*)/.exec(path);

  if (dotted) {
    return dotted[1];
  }

  const quoted = /^props\[("(?:[^"\\]|\\.)*")\]/.exec(path);

  if (quoted) {
    try {
      return String(JSON.parse(quoted[1]));
    } catch {
      return null;
    }
  }

  return /^props\[(\d+)\]/.exec(path)?.[1] ?? null;
}

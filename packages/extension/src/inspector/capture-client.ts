import type { CaptureBudget, PageCall, Snapshot } from './types.ts';

// Each step runs briefly in the inspected page. Returning between steps lets
// both the application and the panel handle input, including Cancel.
export async function captureSnapshot(
  call: PageCall,
  budget: CaptureBudget,
  signal: AbortSignal,
): Promise<Snapshot> {
  signal.throwIfAborted();
  const { token } = await call({ action: 'capture-start', ...budget });
  let finished = false;
  try {
    while (true) {
      signal.throwIfAborted();
      const step = await call({ action: 'capture-step', token });
      signal.throwIfAborted();
      if (step.done) {
        finished = true;
        return step.snapshot;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    if (!finished) {
      await call({ action: 'capture-cancel', token }).catch(() => {});
    }
  }
}

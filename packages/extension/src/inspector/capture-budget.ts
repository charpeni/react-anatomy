import type { CaptureLimits, Snapshot } from './types.ts';

export function nextCaptureBudget(limits: CaptureLimits | undefined) {
  if (!limits) {
    return null;
  }

  const next = { maxComponents: limits.components, maxDepth: limits.depth };

  if (limits.hit.components) {
    next.maxComponents = Math.min(limits.maximum.components, Math.ceil(limits.components * 2.5));
  }

  if (limits.hit.depth) {
    next.maxDepth = Math.min(limits.maximum.depth, limits.depth * 2);
  }

  return next.maxComponents > limits.components || next.maxDepth > limits.depth ? next : null;
}

export function captureLimitMessage(snapshot: {
  nodes: Pick<Snapshot['nodes'], 'length'>;
  limits?: CaptureLimits;
}) {
  const number = (value: number) => value.toLocaleString('en-US');

  const messages = [`Partial hierarchy: ${number(snapshot.nodes.length)} components captured.`];

  if (snapshot.limits?.hit.components) {
    messages.push(`Component limit: ${number(snapshot.limits.components)}.`);
  }

  if (snapshot.limits?.hit.depth) {
    messages.push(`Stopped at ${number(snapshot.limits.depth)} nested levels.`);
  }

  return messages.join(' ');
}

import type { ComponentNode, PageCall } from '../inspector/types.ts';
import { UnusedProps } from './UnusedProps.tsx';
import { useSourceTrace } from './use-source-trace.ts';

// The one place the details pane mounts source-assisted sections. The page is
// read once here and the result is shared with everything rendered below.
export function SourceTraceSection({
  node,
  call,
  capturedAt,
}: {
  node: ComponentNode;
  call: PageCall;
  capturedAt: number;
}) {
  const source = useSourceTrace(call, node, capturedAt);

  return <UnusedProps source={source} />;
}

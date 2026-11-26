import type { ComponentNode, PageCall } from '../inspector/types.ts';
import { SourceTrace } from './SourceTrace.tsx';
import { selectTracedProp } from './store.ts';
import { UnusedProps } from './UnusedProps.tsx';
import { useSourceTrace } from './use-source-trace.ts';

// The one place the details pane mounts source-assisted sections. The page is
// read once here and the result is shared with everything rendered below.
export function SourceTraceSection({
  node,
  call,
  capturedAt,
  isCaptured,
  onSelect,
}: {
  node: ComponentNode;
  call: PageCall;
  capturedAt: number;
  isCaptured: (id: string) => boolean;
  onSelect: (id: string) => void;
}) {
  const source = useSourceTrace(call, node, capturedAt);

  return (
    <>
      <SourceTrace node={node} source={source} isCaptured={isCaptured} onSelect={onSelect} />
      <UnusedProps source={source} onTrace={selectTracedProp} />
    </>
  );
}

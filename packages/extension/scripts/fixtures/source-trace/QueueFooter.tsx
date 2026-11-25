// A leaf: it renders only host elements, so the build plugin has no element to
// stamp in this file. `density` arrives here and is never read.
export function QueueFooter({ revision }: { density: string; revision: number }) {
  return <p className="queue-footer">Queue revision {revision}</p>;
}

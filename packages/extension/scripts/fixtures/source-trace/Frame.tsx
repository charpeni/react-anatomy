import type { ReactNode } from 'react';

// Renders itself once more and hands the inner frame an element it created.
// The label inside the inner frame was therefore created by the outer one:
// the nearest enclosing Frame is not the one that supplied its props.
export function Frame({
  depth,
  label,
  children,
}: {
  depth: number;
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className="frame">
      {children}
      {depth > 0 && (
        <Frame depth={depth - 1} label="Inner frame">
          <FrameLabel text={label} />
        </Frame>
      )}
    </div>
  );
}

function FrameLabel({ text }: { text: string }) {
  return <span className="frame-label">{text}</span>;
}

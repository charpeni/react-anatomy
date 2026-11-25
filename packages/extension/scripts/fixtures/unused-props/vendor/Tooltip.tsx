import type { ReactNode } from 'react';

// Stands in for a package: it is bundled but left out of the analysis.
export function Tooltip({
  label,
  children,
}: {
  label: string;
  placement: string;
  children: ReactNode;
}) {
  return <span title={label}>{children}</span>;
}

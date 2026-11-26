import type { ReactNode } from 'react';

// Bundled with the fixture but deliberately left out of the source analysis,
// like a dependency whose implementation is not available.
export function Tooltip({ children, ...rest }: { children: ReactNode; [key: string]: unknown }) {
  return (
    <span className="tooltip" title={typeof rest.title === 'string' ? rest.title : undefined}>
      {children}
    </span>
  );
}

import type { ReactNode } from 'react';
import { memo } from 'react';

interface MeterProps {
  used: number;
  limit: number;
  version: number;
}

// The comparator reads `version`; the component body does not. Removing the
// prop would stop the meter from ever updating.
export const SeatMeter = memo(
  function SeatMeter({ used, limit }: MeterProps) {
    return <meter className="seats" value={used} max={limit} />;
  },
  (previous, next) => previous.version === next.version,
);

function sameVersion(previous: MeterProps, next: MeterProps) {
  return previous.version === next.version;
}

const MemoMeter = memo(function StableMeter({ used, limit }: MeterProps) {
  return <meter className="seats" value={used} max={limit} />;
}, sameVersion);

export const StableMeter = MemoMeter;

// Receives more props than the page agent lists (200). It reads two by fixed
// name; `legacyScale` is written by the caller after the spread and never read.
export function UsageHistory(props: {
  label: string;
  legacyScale?: string;
  [day: string]: unknown;
}) {
  return (
    <p className="notice">
      {props.label}: {String(props.day0)} seats on day one
    </p>
  );
}

// Receives children and never renders them.
export function EmptyState({ title }: { title: string; children?: ReactNode }) {
  return <p className="empty">{title}</p>;
}

export function Notice({ kind, details }: { kind: 'info' | 'error'; details: string }) {
  if (kind === 'error') {
    return <p className="notice error">{details}</p>;
  }

  return <p className="notice">Everything is up to date.</p>;
}

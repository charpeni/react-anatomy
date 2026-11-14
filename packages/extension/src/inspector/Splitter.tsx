import { useRef } from 'react';

export function Splitter({
  label,
  value,
  onChange,
  min = 170,
  max = 440,
  reverse = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  reverse?: boolean;
}) {
  const start = useRef<{ x: number; value: number } | null>(null);

  const resize = (value: number) => onChange(Math.max(min, Math.min(max, value)));

  return (
    <div
      className="splitter"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) {
          return;
        }

        start.current = { x: e.clientX, value };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (start.current) {
          resize(start.current.value + (e.clientX - start.current.x) * (reverse ? -1 : 1));
        }
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          resize(value + (e.key === 'ArrowRight' ? 10 : -10) * (reverse ? -1 : 1));
        }
      }}
    />
  );
}

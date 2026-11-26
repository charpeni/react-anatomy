import { useEffect, useRef } from 'react';

interface CouponFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  dense?: boolean;
  placeholder?: string;
}

// `dense` is named so that it is not spread onto the <input>, where React
// would warn about an unknown attribute. Its value is never read.
export function CouponField({ label, value, onChange, dense, ...input }: CouponFieldProps) {
  return (
    <label className="field">
      {label}
      <input {...input} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function SaveBar(props: { dirty: boolean; revision: number; onReset: () => void }) {
  const bar = useRef<HTMLElement>(null);

  // props.revision is not read inside the effect. It only decides when it runs.
  useEffect(() => {
    bar.current?.animate([{ background: '#e8f0ff' }, { background: '#fff' }], 600);
  }, [props.revision]);

  return (
    <footer ref={bar} className="save-bar">
      <button disabled={!props.dirty} onClick={props.onReset}>
        Reset
      </button>
    </footer>
  );
}

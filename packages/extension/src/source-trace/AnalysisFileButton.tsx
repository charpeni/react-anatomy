import { useRef } from 'react';
import { loadReport, useSourceReport } from './store.ts';

export function AnalysisFileButton() {
  const { index } = useSourceReport();
  const input = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={input}
        className="trace-file"
        type="file"
        hidden
        accept=".json,application/json"
        aria-label="Source analysis file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) {
            void loadReport(file);
          }
        }}
      />
      <button className="standard-button" onClick={() => input.current?.click()}>
        {index ? 'Replace analysis…' : 'Load source analysis…'}
      </button>
    </>
  );
}

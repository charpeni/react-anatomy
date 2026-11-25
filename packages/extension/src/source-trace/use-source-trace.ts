import type { PageCall } from '../inspector/types.ts';
import type { ReportSite, SourceEvidence } from './report.ts';
import type { Association, ReportIndex } from './trace.ts';
import { useEffect, useMemo, useState } from 'react';
import { useSourceReport } from './store.ts';
import { associate } from './trace.ts';

export interface SourceTraceState {
  index: ReportIndex | null;
  /** What the page reported for the selected component. Null until read. */
  evidence: SourceEvidence | null;
  loading: boolean;
  error: string | null;
  association: Association | null;
  /** The element this instance is traced from: verified against the running build. */
  site: ReportSite | null;
  match: 'verified' | null;
}

// One read of the page per selected component, shared by every section that
// needs source evidence. Nothing is read until an analysis has been loaded.
export function useSourceTrace(
  call: PageCall,
  node: { id: string; name: string },
  capturedAt: number,
): SourceTraceState {
  const { index } = useSourceReport();
  const [result, setResult] = useState<{
    id: string;
    evidence: SourceEvidence | null;
    error: string | null;
  } | null>(null);
  const active = !!index;

  useEffect(() => {
    if (!active) {
      return;
    }

    let cancelled = false;

    call({ action: 'source-evidence', id: node.id })
      .then((response) => {
        if (!cancelled) {
          setResult(
            response?.ok
              ? { id: node.id, evidence: response, error: null }
              : {
                  id: node.id,
                  evidence: null,
                  error: response?.message || 'The page could not be read.',
                },
          );
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setResult({
            id: node.id,
            evidence: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [active, call, node.id, capturedAt]);

  return useMemo(() => {
    const current = index && result?.id === node.id ? result : null;
    const evidence = current?.evidence ?? null;
    const association = index && evidence ? associate(index, evidence.self) : null;
    const verified = association?.status === 'verified' ? association.site : null;

    return {
      index,
      evidence,
      loading: !!index && !current,
      error: current?.error ?? null,
      association,
      site: verified,
      match: verified ? 'verified' : null,
    };
  }, [index, result, node.id]);
}

import type { PageCall } from '../inspector/types.ts';
import type { ReportSite, SourceEvidence } from './report.ts';
import type { Association, OwnerResolver, ReportIndex } from './trace.ts';
import { useEffect, useMemo, useState } from 'react';
import { useSourceReport } from './store.ts';
import { associate, candidateSites, liveOwners, staticOwners } from './trace.ts';

export interface SourceTraceState {
  index: ReportIndex | null;
  /** What the page reported for the selected component. Null until read. */
  evidence: SourceEvidence | null;
  loading: boolean;
  error: string | null;
  association: Association | null;
  /** The element this instance is traced from: verified, or chosen by the developer. */
  site: ReportSite | null;
  /** `verified`: joined by build metadata. `manual`: chosen by the developer, not checked. */
  match: 'verified' | 'manual' | null;
  owners: OwnerResolver | null;
  /** Elements that render a component of this name. Never applied automatically. */
  candidates: ReportSite[];
  choose: (siteId: string | null) => void;
  refresh: () => void;
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
  const [chosen, setChosen] = useState<{ id: string; site: string } | null>(null);
  const [version, setVersion] = useState(0);
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
  }, [active, call, node.id, capturedAt, version]);

  return useMemo(() => {
    const current = index && result?.id === node.id ? result : null;
    const evidence = current?.evidence ?? null;
    const association = index && evidence ? associate(index, evidence.self) : null;
    const candidates = index ? candidateSites(index, node.name) : [];
    const manual =
      index && chosen?.id === node.id && association?.status !== 'verified'
        ? (index.sites.get(chosen.site) ?? null)
        : null;
    const verified = association?.status === 'verified' ? association.site : null;

    return {
      index,
      evidence,
      loading: !!index && !current,
      error: current?.error ?? null,
      association,
      site: verified ?? manual,
      match: verified ? 'verified' : manual ? 'manual' : null,
      owners:
        index && verified && evidence
          ? liveOwners(index, evidence.ancestors, evidence.creators, evidence.ancestorsLimited)
          : index && manual
            ? staticOwners(index)
            : null,
      candidates,
      choose: (siteId) => setChosen(siteId ? { id: node.id, site: siteId } : null),
      refresh: () => setVersion((value) => value + 1),
    };
  }, [index, result, chosen, node.id, node.name]);
}

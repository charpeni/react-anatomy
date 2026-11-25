import type { ReportSite, SourceEvidence, Span } from './report.ts';
import type { Association, ReportIndex } from './trace.ts';
import type { AuditRow, AuditTier, PropAudit } from './unused-props.ts';
import { useMemo, useState } from 'react';
import { auditSelection, countTiers } from './unused-props.ts';
import { AnalysisFileButton } from './AnalysisFileButton.tsx';
import { clearReport, useSourceReport } from './store.ts';
import styles from './unused-props.css';

export interface UnusedPropsSource {
  index: ReportIndex | null;
  evidence: SourceEvidence | null;
  loading: boolean;
  error: string | null;
  association: Association | null;
  site: ReportSite | null;
  match: 'verified' | 'manual' | null;
}

const GROUPS: { title: string; hint: string; tiers: AuditTier[]; open: boolean }[] = [
  {
    title: 'No reader found',
    hint: 'Passed by this element. No analyzed code reads them or passes them to code that does.',
    tiers: ['candidate', 'dead-end'],
    open: true,
  },
  {
    title: 'Not proven',
    hint: 'The analysis could have missed a reader. Treat these props as used.',
    tiers: ['this-render', 'unknown'],
    open: true,
  },
  {
    title: 'Used, but easy to miss',
    hint: 'Look for reads in event handlers, hook dependencies, or a props spread.',
    tiers: ['indirect'],
    open: true,
  },
  {
    title: 'Used',
    hint: 'The source shows where the component reads or forwards these props.',
    tiers: ['used', 'reserved'],
    open: false,
  },
];

const UNAVAILABLE_TAGS = {
  'not-observed': 'Not observed',
  'out-of-date': 'Out of date',
  'not-analyzed': 'Not analyzed',
  unsupported: 'Not supported',
} as const;

function SourceLine({ index, label, span }: { index: ReportIndex; label: string; span: Span }) {
  const [from, to] = span.mark;
  const file = index.report.files[span.file]?.path ?? 'unknown file';

  return (
    <li className="unused-evidence">
      <div className="unused-evidence-label">
        <span>{label}</span>
        <span className="unused-location" title={`${file}:${span.line}:${span.column}`}>
          {file.split('/').pop()}:{span.line}
        </span>
      </div>
      <code>
        {span.text.slice(0, from)}
        <mark>{span.text.slice(from, to)}</mark>
        {span.text.slice(to)}
      </code>
    </li>
  );
}

function Row({
  index,
  row,
  onTrace,
}: {
  index: ReportIndex;
  row: AuditRow;
  onTrace?: (key: string) => void;
}) {
  const [open, setOpen] = useState(row.tier === 'candidate' || row.tier === 'dead-end');

  return (
    <li className="unused-row" data-tier={row.tier} data-prop={row.key}>
      <button className="unused-row-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="unused-name">{row.key}</span>
        <span className="unused-label">{row.label}</span>
      </button>
      {open && (
        <div className="unused-row-body">
          <p>{row.explanation}</p>
          {!!row.evidence.length && (
            <ul className="unused-evidence-list">
              {row.evidence.map((item, position) => (
                <SourceLine key={position} index={index} label={item.label} span={item.span} />
              ))}
            </ul>
          )}
          {row.caveats.map((caveat) => (
            <p key={caveat} className="unused-caveat">
              {caveat}
            </p>
          ))}
          {onTrace && (
            <button className="unused-trace" onClick={() => onTrace(row.key)}>
              Trace {row.key} in source
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function summarize(audit: Extract<PropAudit, { status: 'ready' }>) {
  const counts = countTiers(audit.rows);
  const found = counts.candidate + counts['dead-end'];
  const open = counts['this-render'] + counts.unknown;
  const total = audit.rows.length;

  // A partial list must not read as a count of every prop.
  const props = audit.partial ? `${total} props listed for` : `${total} props on`;

  if (!total) {
    return audit.partial
      ? `No prop of this <${audit.site.tag}> element could be listed.`
      : `This <${audit.site.tag}> element passes no props.`;
  }

  const head = found
    ? `${found} of the ${props} this <${audit.site.tag}> element ${found === 1 ? 'has' : 'have'} no reader in ${audit.component.name} or below it.`
    : open
      ? `No prop ${audit.partial ? 'listed for' : 'on'} this <${audit.site.tag}> element is shown to be unused.`
      : `Every prop ${audit.partial ? 'listed for' : 'on'} this <${audit.site.tag}> element is read or passed down.`;
  const rest = open ? ` ${open} could not be proven either way.` : '';

  return head + rest + (audit.partial ? ' The list is incomplete.' : '');
}

export function UnusedProps({
  source,
  onTrace,
}: {
  source: UnusedPropsSource;
  /** Opens the full trace of one prop. */
  onTrace?: (key: string) => void;
}) {
  const { fileName, error: fileError } = useSourceReport();
  const { index, evidence, association, site, match } = source;
  const audit = useMemo(
    () =>
      index && evidence
        ? auditSelection(index, {
            association,
            chosen: match === 'manual' ? site : null,
            propNames: evidence.propNames,
            propNamesLimited: evidence.propNamesLimited,
            metadata: evidence.metadata,
            built: evidence.files,
          })
        : null,
    [index, evidence, association, site, match],
  );
  const counts = audit?.status === 'ready' ? countTiers(audit.rows) : null;
  const found = counts ? counts.candidate + counts['dead-end'] : 0;

  return (
    <details className="inspector-section unused-props" open={!!audit}>
      <summary>
        Unused props
        {audit?.status === 'ready' && (
          <span className={found ? 'unused-count found' : 'unused-count'}>
            {found ? `${found} without a reader` : 'none found'}
            {audit.partial ? ' · partial list' : ''}
          </span>
        )}
        {audit?.status === 'unavailable' && (
          <span>{UNAVAILABLE_TAGS[audit.why].toLowerCase()}</span>
        )}
      </summary>
      <style>{styles}</style>
      <div className="section-body unused-body">
        <div className="unused-file-actions">
          <AnalysisFileButton />
          {index && (
            <button className="standard-button" onClick={clearReport}>
              Remove analysis
            </button>
          )}
        </div>
        {fileName && <p className="unused-muted">Analysis: {fileName}</p>}
        {fileError && (
          <p className="props-error" role="alert">
            {fileError}
          </p>
        )}
        {!index ? (
          <p className="unused-muted">
            Load a source analysis from your computer to check which props this component reads or
            passes down.
          </p>
        ) : source.error ? (
          <p className="unused-muted">{source.error}</p>
        ) : !audit ? (
          <p className="unused-muted">Reading the page…</p>
        ) : audit.status === 'unavailable' ? (
          <div className="unused-unavailable" data-why={audit.why}>
            <span className="unused-tag">{UNAVAILABLE_TAGS[audit.why]}</span>
            <strong>{audit.title}</strong>
            <p>{audit.detail}</p>
            {audit.span && (
              <ul className="unused-evidence-list">
                <SourceLine index={index} label="The element" span={audit.span} />
              </ul>
            )}
          </div>
        ) : (
          <>
            <p className="unused-summary" data-partial={audit.partial || undefined}>
              {summarize(audit)}
            </p>
            {GROUPS.map((group) => {
              const rows = audit.rows.filter((row) => group.tiers.includes(row.tier));

              return rows.length ? (
                <details key={group.title} className="unused-group" open={group.open}>
                  <summary title={group.hint}>
                    {group.title} <span>{rows.length}</span>
                  </summary>
                  <p className="unused-muted">{group.hint}</p>
                  <ul>
                    {rows.map((row) => (
                      <Row key={row.key} index={index} row={row} onTrace={onTrace} />
                    ))}
                  </ul>
                </details>
              ) : null;
            })}
            {audit.notes.map((note) => (
              <p key={note} className="unused-caveat">
                {note}
              </p>
            ))}
            <p className="unused-muted unused-scope">
              This check covers one JSX element and the components the analyzer could follow below
              it. Before removing a prop, check other callers, tests, types, and any code the
              analysis couldn’t follow.
            </p>
          </>
        )}
      </div>
    </details>
  );
}

import type { ComponentNode } from '../inspector/types.ts';
import type { Flow, ReportSite, Span } from './report.ts';
import type { ReportIndex, SupplyStep, TraceNode } from './trace.ts';
import type { SourceTraceState } from './use-source-trace.ts';
import { useEffect, useMemo, useState } from 'react';
import { clearReport, selectTracedProp, setSourceTraceOpen, useSourceReport } from './store.ts';
import { checkBuild, propNames, traceProp } from './trace.ts';
import { AnalysisFileButton } from './AnalysisFileButton.tsx';
import styles from './source-trace.css';

if (typeof document !== 'undefined') {
  document.head.appendChild(
    Object.assign(document.createElement('style'), { textContent: styles }),
  );
}

const PHASES = {
  render: '',
  event: 'In an event handler. Runs later, when the event fires.',
  effect: 'In an effect. Runs after the component commits.',
  closure: 'Inside a callback. When it runs is not known from source.',
};

const HOW = {
  projection: 'A property read from it is',
  transform: 'A value computed from it is',
  item: 'Each item of it is',
  spread: 'Its fields are',
  closure: 'A function that uses it is',
};

function Evidence({ index, span }: { index: ReportIndex; span: Span }) {
  const [from, to] = span.mark;
  // Keep the marked part in view when the line starts far to its left.
  const start = from > 36 ? from - 24 : 0;

  return (
    <span className="trace-evidence">
      <span className="trace-location">
        {index.report.files[span.file]?.path}:{span.line}:{span.column}
      </span>
      <code className="trace-snippet">
        {start ? '… ' : ''}
        {span.text.slice(start, from)}
        <mark>{span.text.slice(from, to)}</mark>
        {span.text.slice(to)}
      </code>
    </span>
  );
}

function supplyText(step: SupplyStep) {
  const who = step.owner?.name ?? 'Code outside a component';
  const tag = `<${step.site.tag}>`;
  const origin = step.origin;

  if (step.supplied === 'absent') {
    return `${tag} is written here without ${step.key}.`;
  }

  if (step.supplied === 'unlisted-spread') {
    return `${who} spreads a value into ${tag} whose keys are not known from source.`;
  }

  if (step.supplied === 'props-spread') {
    return `${who} spreads its own props into ${tag}. ${step.key} passes through unchanged.`;
  }

  if (!origin) {
    return `${who} passes ${step.key} to ${tag}.`;
  }

  if (origin.type === 'prop') {
    return (
      (origin.key === step.key
        ? `${who} passes its own prop ${origin.key} on, unchanged.`
        : `${who} passes its own prop ${origin.key} on under a new name, ${step.key}.`) +
      (origin.conditional ? ' Only on one branch of a condition.' : '')
    );
  }

  if (origin.type === 'derived') {
    const keys = origin.keys
      .map((key) => (key === '*' ? 'its whole props object' : key))
      .join(', ');

    return origin.how === 'item'
      ? `${who} passes each item of its prop ${keys} as ${step.key}.`
      : origin.how === 'projection'
        ? `${who} passes a property read from its prop ${keys}.`
        : origin.how === 'closure'
          ? `${who} passes a new function that uses its prop ${keys}.`
          : `${who} computes ${step.key} from its prop ${keys}.`;
  }

  return `${who} passes ${origin.detail}.`;
}

function sentence(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? '' : '.');
}

function FlowList({
  index,
  node,
  instances,
  onFollow,
}: {
  index: ReportIndex;
  node: TraceNode;
  instances: (site: ReportSite) => string[];
  onFollow: (id: string, key: string) => void;
}) {
  const follow = (site: ReportSite | undefined, key: string) => {
    const mounted = site ? instances(site) : [];

    if (!site || !mounted.length || key === '*') {
      return null;
    }

    return (
      <span className="trace-instances">
        {mounted.length} mounted below
        {mounted.slice(0, 4).map((id, position) => (
          <button
            key={id}
            className="trace-link"
            aria-label={`Select mounted ${site.tag} ${position + 1} of ${mounted.length} and trace ${key}`}
            onClick={() => onFollow(id, key)}
          >
            {position + 1}
          </button>
        ))}
        {mounted.length > 4 ? ` +${mounted.length - 4}` : ''}
      </span>
    );
  };

  const empty =
    !node.uses.length && !node.derives.length && !node.forwards.length && !node.boundaries.length;

  return (
    <ul className="trace-flows">
      {node.uses.map((use: Extract<Flow, { kind: 'use' }>, position) => (
        <li key={'use' + position} data-flow="use" data-phase={use.phase}>
          <span className="trace-kind">Used</span>
          <span className="trace-text">
            {sentence(use.detail)} {PHASES[use.phase]}
          </span>
          <Evidence index={index} span={use.span} />
        </li>
      ))}
      {node.derives.map(({ flow, site }, position) => (
        <li key={'derive' + position} data-flow="derive">
          <span className="trace-kind">Derived</span>
          <span className="trace-text">
            {HOW[flow.how]}{' '}
            {flow.attr === '*'
              ? `spread onto <${site?.tag ?? '?'}>.`
              : `passed to <${site?.tag ?? '?'}> as ${flow.attr}.`}{' '}
            {PHASES[flow.phase]}
          </span>
          <Evidence index={index} span={flow.span} />
          {follow(site, flow.attr)}
        </li>
      ))}
      {node.forwards.map((edge, position) => (
        <li key={'forward' + position} data-flow="forward">
          <span className="trace-kind">Forwarded</span>
          <span className="trace-text">
            To {`<${edge.site.tag}>`}
            {edge.key === node.key ? ` as ${edge.key}, unchanged` : `, renamed to ${edge.key}`}
            {edge.flow.via === 'spread' ? ', through a props spread' : ''}
            {edge.flow.via === 'children' ? ', as its children' : ''}
            {edge.flow.conditional ? ', on one branch of a condition' : ''}.{' '}
            {PHASES[edge.flow.phase]}
          </span>
          <Evidence index={index} span={edge.flow.span} />
          {follow(edge.site, edge.key)}
          {edge.node && (
            <div className="trace-child">
              <p className="trace-child-heading">
                <strong>
                  {edge.node.component.name} · {edge.node.key}
                </strong>{' '}
                <span data-verdict={edge.node.verdict}>{edge.node.headline}</span>
              </p>
              <FlowList index={index} node={edge.node} instances={instances} onFollow={onFollow} />
            </div>
          )}
        </li>
      ))}
      {node.boundaries.map((boundary, position) => (
        <li key={'unknown' + position} data-flow="unknown">
          <span className="trace-kind">Unknown</span>
          <span className="trace-text">{sentence(boundary.detail)}</span>
          <Evidence index={index} span={boundary.span} />
        </li>
      ))}
      {empty && (
        <li data-flow="none">
          <span className="trace-text">
            Nothing in {node.component.name} reads {node.key} or passes it on.
          </span>
          <Evidence index={index} span={node.component.span} />
        </li>
      )}
    </ul>
  );
}

// Wait for a local analysis before requesting call-site metadata from the page.
export function SourceTrace({
  node,
  source,
  isCaptured,
  onSelect,
}: {
  node: ComponentNode;
  source: SourceTraceState;
  isCaptured: (id: string) => boolean;
  onSelect: (id: string) => void;
}) {
  const { index, fileName, error, prop, open } = useSourceReport();
  const [notice, setNotice] = useState<string | null>(null);
  const { site, match, association, evidence, owners } = source;
  const names = useMemo(() => {
    const listed = new Set(index && site ? propNames(index, site) : []);

    evidence?.propNames.forEach((name) => listed.add(name));

    return [...listed];
  }, [index, site, evidence]);
  const target = index && site?.target ? index.components.get(site.target) : undefined;
  const key = prop !== null && names.includes(prop) ? prop : null;
  const trace = useMemo(
    () =>
      index && site && owners && key !== null ? traceProp(index, site, key, owners, node.id) : null,
    [index, site, owners, key, node.id],
  );
  const mismatches = useMemo(
    () =>
      index && trace && match === 'verified' && evidence
        ? checkBuild(index, trace, evidence.files)
        : [],
    [index, trace, match, evidence],
  );

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = setTimeout(() => setNotice(null), 6000);

    return () => clearTimeout(timer);
  }, [notice]);

  const instances = (target: ReportSite) =>
    index && evidence && match === 'verified'
      ? evidence.descendants
          .filter(
            (item) =>
              item.id !== null &&
              `${item.stamp.file}@${item.stamp.at}` === target.id &&
              index.files.get(item.stamp.file)?.hash === item.stamp.hash,
          )
          .map((item) => item.id!)
      : [];

  const select = (id: string, traced?: string) => {
    if (!isCaptured(id)) {
      setNotice(
        'That component is outside the current capture. Return to the whole page or capture more components to select it.',
      );
      return;
    }

    if (traced !== undefined) {
      selectTracedProp(traced);
    }

    onSelect(id);
  };

  return (
    <details
      className="inspector-section source-trace"
      open={open}
      onToggle={(event) => setSourceTraceOpen(event.currentTarget.open)}
    >
      <summary>
        Trace in source<span>local file · opt-in</span>
      </summary>
      <div className="section-body">
        {!index ? (
          <>
            <p className="trace-intro">
              Load a local source analysis to find where a component received a prop and which line
              reads it. The file stays in this panel until you remove it or close the panel.
            </p>
            <div className="trace-actions">
              <AnalysisFileButton />
            </div>
            <p className="trace-note">
              See “Trace a prop in source” in the documentation for how to create one.
            </p>
          </>
        ) : (
          <>
            <p className="trace-loaded">
              <strong>{index.report.label}</strong> · {index.report.files.length} files ·{' '}
              {index.report.components.length} components
              <span title={fileName ?? undefined}> · {fileName}</span>
            </p>
            <div className="trace-actions">
              <AnalysisFileButton />
              <button className="standard-button" onClick={clearReport}>
                Remove
              </button>
            </div>
            {!!index.report.notes.length && (
              <details className="trace-notes">
                <summary>Analysis notes ({index.report.notes.length})</summary>
                <ul>
                  {index.report.notes.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
        {error && (
          <p className="trace-alert" role="alert">
            {error}
          </p>
        )}
        {index && (
          <div
            className="trace-association"
            role="status"
            data-match={match ?? association?.status}
          >
            {source.error ? (
              <p className="trace-alert">{source.error}</p>
            ) : source.loading || !association ? (
              <p className="trace-note">Reading call-site evidence…</p>
            ) : association.status === 'verified' ? (
              <>
                <p className="trace-status verified">
                  <strong>Call site verified.</strong> This {node.name} was created by the element
                  below. The running build and the analysis were made from the same text of this
                  file.
                </p>
                <Evidence index={index} span={association.site.span} />
                {target && target.name !== node.name && (
                  <p className="trace-note">
                    The page names this component {node.name}. In source, the element renders{' '}
                    {target.name}. Wrappers and display names can cause this.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="trace-status">
                  {association.status === 'stale' ? (
                    <>
                      <strong>Out of date.</strong> The page was built from a different version of{' '}
                      {association.file} than this analysis read. Rebuild the page or run the
                      analyzer again. A matching file is required to verify this instance.
                    </>
                  ) : association.status === 'unlisted' ? (
                    <>
                      <strong>Not in the analysis.</strong> This {node.name} was created in{' '}
                      {association.file}, which the analysis does not include.
                    </>
                  ) : association.status === 'mismatch' ? (
                    <>
                      <strong>Not matched.</strong> The build and the analysis agree on the text of{' '}
                      {association.file} but not on its elements. Use the same version of the
                      analyzer and the build plugin.
                    </>
                  ) : evidence?.metadata ? (
                    <>
                      <strong>No call-site record for this instance.</strong> Elements created
                      outside the instrumented source, or copied with cloneElement, have none.
                    </>
                  ) : (
                    <>
                      <strong>No source metadata on this page.</strong> The page was not built with
                      the React Anatomy source plugin, so Anatomy cannot tell which element in your
                      source created this instance.
                    </>
                  )}
                </p>
                {match === 'manual' && site ? (
                  <>
                    <p className="trace-status manual">
                      <strong>Chosen by you.</strong> Not verified against the running page. The
                      trace below describes the source only.{' '}
                      <button className="trace-link" onClick={() => source.choose(null)}>
                        Choose another
                      </button>
                    </p>
                    <Evidence index={index} span={site.span} />
                  </>
                ) : source.candidates.length ? (
                  <>
                    <p className="trace-note">
                      {source.candidates.length === 1
                        ? `One element in the analyzed source renders a component named ${node.name}.`
                        : `${source.candidates.length} elements in the analyzed source render a component named ${node.name}.`}{' '}
                      A name does not identify an instance. Choose one to read its source trace:
                    </p>
                    <ul className="trace-candidates">
                      {source.candidates.slice(0, 30).map((candidate) => (
                        <li key={candidate.id}>
                          <button
                            className="trace-candidate"
                            onClick={() => source.choose(candidate.id)}
                          >
                            <Evidence index={index} span={candidate.span} />
                          </button>
                        </li>
                      ))}
                    </ul>
                    {source.candidates.length > 30 && (
                      <p className="trace-note">
                        Showing 30 of {source.candidates.length} elements.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="trace-note">
                    No element in the analysis renders a component named {node.name}.
                  </p>
                )}
              </>
            )}
          </div>
        )}
        {index && site && (
          <label className="trace-prop">
            Prop
            <select
              aria-label="Prop to trace"
              value={key ?? ''}
              onChange={(event) => selectTracedProp(event.target.value || null)}
            >
              <option value="">Choose a prop…</option>
              {names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        {index && site && evidence?.propNamesLimited && (
          <p className="trace-note">
            This component holds more props than Anatomy lists for a trace (200 names).
          </p>
        )}
        {index && site && key === null && (
          <p className="trace-note">Choose a prop here, or click one in Props above.</p>
        )}
        {index && trace && (
          <div className="trace-result" aria-live="polite">
            {!!mismatches.length && (
              <p className="trace-alert" role="alert">
                <strong>Not verified against this build.</strong> This trace reads{' '}
                {mismatches
                  .map(
                    (item) =>
                      `${item.path} (${item.status === 'changed' ? 'changed since the analysis' : 'not recorded by the build'})`,
                  )
                  .join(', ')}
                . The result below describes the analyzed source, which may differ from the running
                page.
              </p>
            )}
            <p
              className="trace-verdict"
              data-verdict={trace.flow?.verdict ?? 'unknown'}
              data-consumer={trace.flow?.consumer ?? 'unknown'}
              data-scope={match === 'verified' && !mismatches.length ? 'build' : 'source'}
            >
              <span className="trace-key">{key}</span>
              <strong>{trace.headline}</strong>
              <span className="trace-scope">
                {match === 'verified' && !mismatches.length
                  ? 'Checked against the running build'
                  : 'Source only'}
              </span>
            </p>
            {trace.caveat && <p className="trace-note">{trace.caveat}</p>}
            <h3>Supplied by</h3>
            <ol className="trace-supply">
              {trace.supply.steps.map((step) => (
                <li key={JSON.stringify([step.site.id, step.key, step.instance ?? null])}>
                  <span className="trace-text">{supplyText(step)}</span>
                  <Evidence index={index} span={step.span} />
                  {step.uncertain && (
                    <span className="trace-text">
                      A later spread on this element may replace the value.
                    </span>
                  )}
                  {step.found === 'only-site' && (
                    <span className="trace-instances">
                      The only element in the analyzed source that renders {step.site.tag}.
                    </span>
                  )}
                  {step.found === 'page' && (
                    <span className="trace-instances">
                      Mounted ancestor
                      {step.instance && (
                        <button
                          className="trace-link"
                          aria-label={`Select the mounted ${step.site.tag}`}
                          onClick={() => select(step.instance!, step.key)}
                        >
                          Select
                        </button>
                      )}
                    </span>
                  )}
                </li>
              ))}
              <li data-end={trace.supply.end.kind}>
                {trace.supply.end.kind === 'origin' ? (
                  <>
                    <span className="trace-text">
                      <strong>Starts here:</strong> {trace.supply.end.origin.detail}.
                    </span>
                    {trace.supply.end.origin.span && (
                      <Evidence index={index} span={trace.supply.end.origin.span} />
                    )}
                  </>
                ) : trace.supply.end.kind === 'derived' ? (
                  <span className="trace-text">
                    Computed from several props ({trace.supply.end.keys.join(', ')}). The chain is
                    not followed past a value with more than one source.
                  </span>
                ) : trace.supply.end.kind === 'branches' ? (
                  <>
                    <span className="trace-text">
                      {trace.supply.end.component.name} is rendered from{' '}
                      {trace.supply.end.sites.length} elements. Source alone cannot tell which one
                      applies:
                    </span>
                    {trace.supply.end.sites.slice(0, 8).map((branch) => (
                      <Evidence key={branch.id} index={index} span={branch.span} />
                    ))}
                  </>
                ) : (
                  <span className="trace-text">
                    <strong>Unknown beyond this point.</strong> {trace.supply.end.detail}
                  </span>
                )}
              </li>
            </ol>
            <h3>In {trace.flow?.component.name ?? `<${trace.site.tag}>`}</h3>
            {trace.flow ? (
              <FlowList
                index={index}
                node={trace.flow}
                instances={instances}
                onFollow={(id, traced) => select(id, traced)}
              />
            ) : (
              trace.boundary && (
                <ul className="trace-flows">
                  <li data-flow="unknown">
                    <span className="trace-kind">Unknown</span>
                    <span className="trace-text">{sentence(trace.boundary.detail)}</span>
                    <Evidence index={index} span={trace.boundary.span} />
                  </li>
                </ul>
              )
            )}
            {evidence?.limited && (
              <p className="trace-note">
                The page has more components around this one than Anatomy reads for a trace. Some
                mounted instances may be missing above.
              </p>
            )}
          </div>
        )}
        {notice && (
          <p className="trace-alert" role="status">
            {notice}
          </p>
        )}
      </div>
    </details>
  );
}

import type {
  ComponentNode,
  ContextOverview,
  ContextProviderSummary,
  ContextReaders as Readers,
  ContextRecording,
  PageCall,
} from './types.ts';
import type { ContextMeasured } from './context-types.ts';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Glyph } from './Glyph.tsx';
import { installCommitHook } from './context-hook.ts';
import contextStyles from './context-readers.css';

document.head.appendChild(
  Object.assign(document.createElement('style'), { textContent: contextStyles }),
);

type Baseline = {
  key: string;
  epoch: string;
  at: number;
  provider: string | null;
  readers: Map<string, string | undefined>;
};

// Reading contexts walks the page's whole React tree, so nothing is read until
// the user opens the section. It then stays open for the rest of the panel
// session, including across a focused capture, which remounts the viewer.
let sectionOpen = false;

const time = (value: number) => new Date(value).toLocaleTimeString();
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

// Contexts are matched by identity. Names are only labels, so contexts that
// share one (or have none) are numbered in the order they appear.
function contextLabels(providers: ContextProviderSummary[]) {
  const byName = new Map<string, string[]>();

  for (const provider of providers) {
    const name = provider.name || 'Context';
    const ids = byName.get(name) || [];

    if (!ids.includes(provider.contextId)) {
      ids.push(provider.contextId);
    }

    byName.set(name, ids);
  }

  return (provider: { name: string | null; contextId: string }) => {
    const name = provider.name || 'Context';
    const ids = byName.get(name) || [];

    return ids.length > 1 ? `${name} #${ids.indexOf(provider.contextId) + 1}` : name;
  };
}

function measuredText(measured: ContextMeasured, reader: boolean, atLeast: boolean) {
  const bound = atLeast ? '≥ ' : '';
  const parts = [`${bound}${plural(measured.renders, 'render')}`];

  if (reader && measured.renders) {
    parts.push(`${bound}${measured.withNewValue} with a new value`);
  }

  if (measured.mounted) {
    parts.push('mounted');
  }

  return parts.join(' · ');
}

// Lists the components that read one context provider, and says what kind of
// evidence each statement about them rests on. See context-types.ts.
export function ContextReaders({
  node,
  capturedAt,
  call,
  isCaptured,
  onSelect,
  onReload,
}: {
  node: ComponentNode;
  capturedAt: number;
  call: PageCall;
  isCaptured: (id: string) => boolean;
  onSelect: (id: string) => void;
  onReload?: (injectedScript: string) => void;
}) {
  const [open, setOpen] = useState(sectionOpen);
  const [overview, setOverview] = useState<ContextOverview | null>(null);
  const [readers, setReaders] = useState<Readers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState<{ key: string; session: string } | null>(null);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState(false);
  // Every read is a sample, but selection changes also trigger reads. A
  // comparison is shown once the user asks for one or a value has changed.
  const [asked, setAsked] = useState(false);
  const asking = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    call({ action: 'contexts', id: node.id })
      .then((result) => {
        if (!cancelled) {
          setOverview(result);
          setError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, node.id, capturedAt, refresh, call]);

  const providers = overview?.providers;
  const label = useMemo(() => contextLabels(providers || []), [providers]);

  // A pinned provider outlives selection changes, so following a reader into
  // the tree keeps its list in view. It does not outlive the page.
  const activeKey =
    (pinned?.session === overview?.session &&
      providers?.some((provider) => provider.key === pinned?.key) &&
      pinned?.key) ||
    overview?.reads[0] ||
    overview?.above[0] ||
    providers?.[0]?.key ||
    null;

  const applyReaders = useEffectEvent((result: Readers) => {
    setReaders(result);
    setError(null);

    if (asking.current) {
      asking.current = false;
      setAsked(true);
    }

    if (!baseline || baseline.key !== result.provider.key || baseline.epoch !== result.epoch) {
      sample(result);
    }
  });

  function sample(result: Readers) {
    setAsked(false);
    setBaseline({
      key: result.provider.key,
      epoch: result.epoch,
      at: result.readAt,
      provider: result.provider.valueToken,
      readers: new Map(result.readers.map((reader) => [reader.id, reader.valueToken])),
    });
  }

  async function read(key: string, currentGeneration: number) {
    try {
      const result = await call({ action: 'context-readers', key });

      if (generation.current !== currentGeneration) {
        return;
      }

      if (result.ok) {
        applyReaders(result);
      } else {
        setReaders(null);
        setError(result.message);
      }
    } catch (error) {
      if (generation.current === currentGeneration) {
        setError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  const readLatest = useEffectEvent(read);
  const recording = readers?.recording.active;

  /* oxlint-disable react-hooks/exhaustive-deps, react/set-state-in-effect -- Clear the previous provider's list while the next one is read. `readers` is this effect's own output, and invalidating the generation on cleanup discards a late response. */
  useEffect(() => {
    const currentGeneration = ++generation.current;

    if (!activeKey || !open) {
      setReaders(null);

      return;
    }

    if (readers && readers.provider.key !== activeKey) {
      setReaders(null);
    }

    readLatest(activeKey, currentGeneration);

    // Counts arrive while the user interacts with the page.
    const timer = recording
      ? setInterval(() => {
          if (document.visibilityState !== 'hidden') {
            readLatest(activeKey, generation.current);
          }
        }, 800)
      : undefined;

    return () => {
      generation.current++;
      clearInterval(timer);
    };
  }, [activeKey, open, overview, recording]);
  /* oxlint-enable react-hooks/exhaustive-deps, react/set-state-in-effect */

  async function record(command: 'start' | 'stop' | 'clear') {
    setPending(true);

    try {
      const result = await call({ action: 'context-record', command });

      if (!result.ok) {
        setError(result.message);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
      setRefresh((n) => n + 1);
    }
  }

  function pin(key: string) {
    if (overview) {
      setPinned({ key, session: overview.session });
    }
  }

  const active = providers?.find((provider) => provider.key === activeKey);
  const status: ContextRecording | undefined = readers?.recording || overview?.recording;
  const comparable =
    !!readers &&
    !!baseline &&
    baseline.key === readers.provider.key &&
    baseline.epoch === readers.epoch &&
    baseline.at !== readers.readAt;
  const compared =
    comparable &&
    (asked ||
      readers.provider.valueToken !== baseline.provider ||
      readers.readers.some(
        (reader) =>
          !baseline.readers.has(reader.id) || baseline.readers.get(reader.id) !== reader.valueToken,
      ));
  const evidence = status?.recorded ? 'measured' : compared ? 'sampled' : 'dependencies';
  const sampledValues = !!readers?.readers.some((reader) => reader.valueToken !== undefined);
  const atLeast = !!status?.limited;
  const reads = new Set(overview?.reads);
  const optionText = (provider: ContextProviderSummary) =>
    `${provider.shadows ? '↳ ' : ''}${label(provider)} · ${
      provider.kind === 'default'
        ? 'default value'
        : provider.owner
          ? `in ${provider.owner.name}`
          : 'at the root'
    }${(overview?.roots ?? 1) > 1 ? ` · root ${provider.root + 1}` : ''} · ${provider.atLeast ? '≥ ' : ''}${plural(provider.readers, 'reader')}`;
  const name = active ? label(active) : 'this context';
  // Report lower bounds when a scan skips components or context dependencies.
  const partial = !!readers && (readers.limited || !!overview?.limited);
  const lowerBound = partial || !!readers?.totals.unchecked;

  function row(
    item: { id: string; name: string; key: string | null; memo: boolean },
    tags: string[],
    detail: string | null,
  ) {
    const captured = isCaptured(item.id);

    return (
      <li key={item.id}>
        <button
          className="context-row"
          data-context-instance={item.id}
          aria-current={item.id === node.id ? 'true' : undefined}
          disabled={!captured}
          title={
            captured
              ? `Select ${item.name} in the tree and 3D view`
              : 'This instance is not in the current capture. Capture the page again to select it.'
          }
          onClick={() => {
            if (activeKey) {
              pin(activeKey);
            }

            onSelect(item.id);
          }}
        >
          <span className="context-row-name">
            {item.name}
            {item.key && <small>{item.key}</small>}
          </span>
          {[...tags, ...(item.memo ? ['memo'] : []), ...(captured ? [] : ['not captured'])].map(
            (tag) => (
              <span className="context-tag" key={tag}>
                {tag}
              </span>
            ),
          )}
          {detail && <span className="context-row-evidence">{detail}</span>}
        </button>
      </li>
    );
  }

  return (
    <details
      className="inspector-section context-readers"
      open={open}
      onToggle={(e) => {
        if (e.target === e.currentTarget) {
          sectionOpen = e.currentTarget.open;
          setOpen(sectionOpen);

          // A closed section shows no counts, so it must not keep counting.
          if (!sectionOpen && status?.active) {
            void record('stop');
          }
        }
      }}
    >
      <summary>
        Context readers<span>{open ? 'read-only' : 'who reads a provider'}</span>
      </summary>
      {!open ? null : !overview ? (
        <div className="section-body">
          {error ? (
            <p className="props-error" role="status">
              {error}
            </p>
          ) : (
            <span className="props-loading" role="status">
              Reading contexts…
            </span>
          )}
        </div>
      ) : !providers?.length ? (
        <div className="section-body">
          <p className="context-note">
            {overview.roots
              ? 'No context providers or readers were found in the captured React roots.'
              : 'This capture has expired. Capture the page again to read its contexts.'}
          </p>
        </div>
      ) : (
        <>
          <div className="props-toolbar context-toolbar">
            <select
              aria-label="Context provider"
              title={
                active
                  ? `${optionText(active)}. Choose a context provider to list its readers.`
                  : 'Choose a context provider to list its readers'
              }
              value={activeKey ?? ''}
              onChange={(e) => pin(e.target.value)}
            >
              {reads.size > 0 && (
                <optgroup label={`Read by ${node.name}`}>
                  {providers
                    .filter((provider) => reads.has(provider.key))
                    .map((provider) => (
                      <option key={provider.key} value={provider.key}>
                        {optionText(provider)}
                      </option>
                    ))}
                </optgroup>
              )}
              <optgroup label={reads.size ? 'Other providers' : 'Providers on this page'}>
                {providers
                  .filter((provider) => !reads.has(provider.key))
                  .map((provider) => (
                    <option key={provider.key} value={provider.key}>
                      {optionText(provider)}
                    </option>
                  ))}
              </optgroup>
            </select>
            <button
              className="icon-button"
              aria-label="Refresh context readers"
              title={
                'Read providers and readers again' +
                (sampledValues ? ', and sample their current values' : '')
              }
              onClick={() => {
                asking.current = true;
                setRefresh((n) => n + 1);
              }}
            >
              <Glyph type="reset" size={13} />
            </button>
          </div>
          <div className="section-body context-body" aria-busy={!readers && !error}>
            {error && (
              <p className="props-error" role="status">
                {error}
              </p>
            )}
            {readers && (
              <>
                <dl className="context-provider">
                  <dt>Provided</dt>
                  <dd>
                    {readers.provider.kind === 'default' ? (
                      'No provider above these readers: they read the default value'
                    ) : readers.provider.owner ? (
                      <button
                        className="context-link"
                        disabled={!isCaptured(readers.provider.owner.id)}
                        title="Select the component that renders this provider"
                        onClick={() => {
                          pin(readers.provider.key);
                          onSelect(readers.provider.owner!.id);
                        }}
                      >
                        in {readers.provider.owner.name}
                      </button>
                    ) : (
                      'at the root'
                    )}
                  </dd>
                  {readers.provider.value && (
                    <>
                      <dt>Value</dt>
                      <dd className={'property-value ' + readers.provider.value.type}>
                        {readers.provider.value.preview}
                      </dd>
                    </>
                  )}
                </dl>
                {active?.shadows && (
                  <p className="context-note">
                    Shadows an outer {name} provider.{' '}
                    <button className="context-link" onClick={() => pin(active.shadows!)}>
                      Show the outer provider
                    </button>
                  </p>
                )}
                <h3 id="context-readers-heading">
                  Readers of {name} ({lowerBound ? 'at least ' : ''}
                  {readers.totals.readers})
                </h3>
                {readers.readers.length ? (
                  <ul className="context-list" aria-labelledby="context-readers-heading">
                    {readers.readers.map((reader) => {
                      const before = baseline?.readers.get(reader.id);
                      const detail =
                        evidence === 'measured' && reader.measured
                          ? measuredText(reader.measured, true, atLeast)
                          : evidence === 'sampled'
                            ? !baseline!.readers.has(reader.id)
                              ? 'new reader'
                              : reader.valueToken === undefined || before === undefined
                                ? null
                                : reader.valueToken === before
                                  ? 'same value'
                                  : 'read a new value'
                            : null;

                      return row(
                        reader,
                        [
                          ...(reader.via === 'consumer' ? ['Consumer'] : []),
                          ...(reader.portal ? ['portal'] : []),
                          ...(reader.current === false ? ['stale value'] : []),
                        ],
                        detail,
                      );
                    })}
                  </ul>
                ) : (
                  <p className="context-note">No mounted component reads this provider.</p>
                )}
                {readers.readers.length < readers.totals.readers && (
                  <p className="context-note">
                    Showing the first {readers.readers.length} of {readers.totals.readers} readers.
                  </p>
                )}
                {readers.nested.map((inner) => (
                  <p className="context-note context-nested" key={inner.key}>
                    {plural(inner.readers, 'reader')} below read a nested {name} provider
                    {inner.owner ? ` in ${inner.owner.name}` : ''} instead.{' '}
                    <button className="context-link" onClick={() => pin(inner.key)}>
                      Show its readers
                    </button>
                  </p>
                ))}
                {readers.totals.unchecked > 0 && (
                  <p className="context-note context-unchecked">
                    {plural(readers.totals.unchecked, 'component')} below{' '}
                    {readers.totals.unchecked === 1 ? 'reads' : 'read'} more contexts than can be
                    checked. {readers.totals.unchecked === 1 ? 'It is' : 'They are'} left out of
                    both lists.
                  </p>
                )}
                {readers.bystanders && readers.totals.bystanders > 0 && (
                  <details className="context-bystanders" open={readers.totals.bystanders <= 8}>
                    <summary id="context-bystanders-heading">
                      Not readers ({readers.totals.bystanders}
                      {partial ? ' found' : ''})
                    </summary>
                    <ul className="context-list" aria-labelledby="context-bystanders-heading">
                      {readers.bystanders.map((item) =>
                        row(
                          item,
                          [],
                          evidence === 'measured' && item.measured
                            ? measuredText(item.measured, false, atLeast)
                            : null,
                        ),
                      )}
                    </ul>
                    {readers.bystanders.length < readers.totals.bystanders && (
                      <p className="context-note">
                        Showing the first {readers.bystanders.length} of {readers.totals.bystanders}
                        .
                      </p>
                    )}
                  </details>
                )}
                <p className="context-evidence" data-evidence={evidence}>
                  {evidence === 'measured' ? (
                    <>
                      <strong>Evidence: measured renders.</strong>{' '}
                      {status!.active ? 'Recording' : 'Recorded'}{' '}
                      {plural(status!.commits, 'commit')}
                      {readers.provider.valueChanges !== undefined &&
                        `, ${readers.provider.valueChanges} with a new provider value`}
                      . Counted in React’s commit hook, once per commit that rendered the component.
                      A render with a new value can have other causes too, such as a parent
                      rendering.
                      {atLeast && ' A work limit was reached, so counts are lower bounds.'}
                    </>
                  ) : evidence === 'sampled' ? (
                    <>
                      <strong>Evidence: sampled values.</strong> {time(baseline!.at)} →{' '}
                      {time(readers.readAt)}:{' '}
                      {readers.provider.valueToken === null
                        ? 'the default value is not sampled'
                        : readers.provider.valueToken === baseline!.provider
                          ? 'the provider holds the same value'
                          : 'the provider holds a different value'}
                      .{' '}
                      {sampledValues
                        ? 'A reader with a new value rendered at least once between samples. Samples can’t count renders or tell you whether a non-reader rendered.'
                        : 'This React version does not record the value each reader last read.'}
                    </>
                  ) : (
                    <>
                      <strong>Evidence: dependencies.</strong> React recorded this context in each
                      reader’s latest render. Render counts require a recording.
                    </>
                  )}
                  {partial && ' The scan reached a work limit, so the lists may be incomplete.'}
                </p>
                <div className="context-actions">
                  {status?.active ? (
                    <button
                      className="standard-button"
                      disabled={pending}
                      onClick={() => record('stop')}
                    >
                      Stop recording
                    </button>
                  ) : status?.capability === 'ready' ? (
                    <button
                      className="standard-button"
                      disabled={pending}
                      title="Count renders in React’s commit hook until you stop"
                      onClick={() => record('start')}
                    >
                      {status.recorded ? 'Record again' : 'Record renders'}
                    </button>
                  ) : onReload ? (
                    <button
                      className="standard-button"
                      title="React reports commits only to a hook that exists before it loads. Reloading resets the page’s state."
                      onClick={() => onReload(`(${installCommitHook.toString()})()`)}
                    >
                      Reload page to measure renders
                    </button>
                  ) : null}
                  {status?.recorded && !status.active && (
                    <button
                      className="standard-button"
                      disabled={pending}
                      onClick={() => record('clear')}
                    >
                      Clear counts
                    </button>
                  )}
                  {evidence !== 'measured' && sampledValues && (
                    <button
                      className="standard-button"
                      title="Compare later samples with the values read now"
                      onClick={() => sample(readers)}
                    >
                      Set baseline
                    </button>
                  )}
                </div>
                {status?.capability === 'unavailable' && !status.active && (
                  <p className="context-note">
                    {onReload
                      ? 'Render counts need React’s commit reports, which this page is not sending.'
                      : 'Render counts need React’s commit reports. Open React Anatomy from its DevTools panel to enable them.'}
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}
    </details>
  );
}

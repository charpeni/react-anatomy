import type { ComponentNode, PageCall, PropEntry } from './types.ts';
import type { ReferenceMatch } from './reference-types.ts';
import { useEffect, useRef, useState } from 'react';
import { Glyph } from './Glyph.tsx';
import {
  closeReferenceSearch,
  findSameReference,
  groupReferenceMatches,
  referenceNotes,
  referencePropLabel,
  referenceScope,
  referenceSummary,
  repeatReferenceSearch,
  useReferenceSearch,
  useReferenceTarget,
} from './reference-search.ts';

// Only values with an identity can be matched. Equal strings, numbers and
// booleans in two components say nothing about where a value travelled.
const REFERENCE_TYPES = new Set([
  'function',
  'object',
  'array',
  'map',
  'set',
  'date',
  'dom',
  'react-element',
]);

const GROUP_PAGE = 50;
let announcedRun = 0;
// A match outside the capture is selected once focusing has loaded it.
let awaitingCapture: string | null = null;

export function FindReferenceButton({
  componentId,
  entry,
}: {
  componentId: string;
  entry: PropEntry;
}) {
  const target = useReferenceTarget();

  if (!REFERENCE_TYPES.has(entry.value.type)) {
    return null;
  }

  const active =
    target?.id === componentId && target.name === entry.name && target.symbol === !!entry.symbol;

  return (
    <button
      className={'icon-button reference-action' + (active ? ' active' : '')}
      aria-label={`Find same reference as ${entry.name}`}
      aria-pressed={active}
      title="Find the components that received this same reference"
      onClick={() =>
        findSameReference({ id: componentId, name: entry.name, symbol: !!entry.symbol })
      }
    >
      <Glyph type="link" size={12} />
    </button>
  );
}

const BADGES: Record<ReferenceMatch['relation'], string> = {
  source: 'searched from',
  ancestor: 'ancestor',
  descendant: 'descendant',
  other: '',
  gap: 'no matching prop',
};

export function SameReference({
  call,
  capturedAt,
  scopeId,
  selectedId,
  captured,
  onSelect,
  onFocus,
  onHover,
}: {
  call: PageCall;
  capturedAt: number;
  scopeId: string | null;
  selectedId: string;
  captured: Record<string, ComponentNode>;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onHover?: (id: string | null) => void;
}) {
  const search = useReferenceSearch(call, capturedAt, scopeId);
  const [expanded, setExpanded] = useState(new Set<number>());
  const heading = useRef<HTMLElement | null>(null);
  const { target, result, run } = search;

  // Bring a search the user just started into view and to the keyboard. A
  // remount after focusing a subtree must not take focus again.
  useEffect(() => {
    if (target && run !== announcedRun) {
      announcedRun = run;
      heading.current?.scrollIntoView({ block: 'nearest' });
      heading.current?.focus({ preventScroll: true });
    }
  }, [target, run]);

  /* oxlint-disable react-hooks/exhaustive-deps -- Applies once to the capture that follows the click. */
  useEffect(() => {
    const id = awaitingCapture;

    awaitingCapture = null;

    if (id && captured[id]) {
      onSelect(id);
    }
  }, [capturedAt]);
  /* oxlint-enable react-hooks/exhaustive-deps */

  if (!target) {
    return null;
  }

  function reveal(id: string) {
    if (captured[id]) {
      onSelect(id);
    } else {
      awaitingCapture = id;
      onFocus(id);
    }
  }

  const groups = result ? groupReferenceMatches(result.matches) : [];
  const notes = result ? referenceNotes(result) : [];

  function instance(match: ReferenceMatch, label: React.ReactNode, spoken: string) {
    const loaded = !!captured[match.id];
    const badge = [
      BADGES[match.relation],
      match.outside && match.relation !== 'source' ? 'above focus' : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const path = [...(match.pathTruncated ? ['…'] : []), ...match.path, match.name].join(' › ');

    return (
      <li key={match.id}>
        <button
          className={
            'reference-instance' +
            (match.id === selectedId ? ' selected' : '') +
            (match.relation === 'gap' ? ' gap' : '')
          }
          data-reference-id={match.id}
          data-reference-relation={match.relation}
          aria-current={match.id === selectedId ? 'true' : undefined}
          aria-label={[
            spoken,
            badge,
            match.id === selectedId ? 'selected' : loaded ? '' : 'focus to load',
          ]
            .filter(Boolean)
            .join(', ')}
          title={`${path}\n${loaded ? 'Select this instance' : 'Outside this capture. Focus it to load it.'}`}
          onClick={() => reveal(match.id)}
          onMouseEnter={() => loaded && onHover?.(match.id)}
          onMouseLeave={() => onHover?.(null)}
        >
          {label}
          {badge && <small>{badge}</small>}
          {!loaded && <small>Focus to load</small>}
          <small className="reference-id">{match.id}</small>
        </button>
      </li>
    );
  }

  return (
    <details className="inspector-section same-reference" open>
      <summary ref={heading}>
        Same reference<span>identity</span>
      </summary>
      <div className="reference-toolbar">
        <div className="reference-source" title="The prop whose value is being matched">
          <span className="node-name">{result?.source.name ?? 'Component'}</span>
          {result?.source.key && <small>key="{result.source.key}"</small>}
          <span className="property-name">{referencePropLabel([target.name])}</span>
          {result && (
            <span className={'property-value ' + result.source.type}>{result.source.preview}</span>
          )}
        </div>
        <button
          className="icon-button"
          aria-label="Search again"
          title="Read the current reference and search again"
          disabled={search.loading}
          onClick={() => repeatReferenceSearch()}
        >
          <Glyph type="reset" size={13} />
        </button>
        <button
          className="icon-button"
          aria-label="Close same reference"
          title="Close"
          onClick={closeReferenceSearch}
        >
          <Glyph type="close" size={12} />
        </button>
      </div>
      <div className="section-body" aria-busy={search.loading}>
        {search.loading ? (
          <span className="props-loading" role="status">
            Comparing references…
          </span>
        ) : search.error ? (
          <p className="props-error" role="status">
            {search.error}
          </p>
        ) : (
          result && (
            <>
              <p className="reference-summary" role="status">
                {referenceSummary(result)}
              </p>
              <ul className="reference-list" aria-label="Components holding this reference">
                {groups.map((group, index) => {
                  const props = referencePropLabel(group.props, group.moreProps);
                  const title = (
                    <>
                      <span className="node-name">{group.name}</span>
                      {props && <span className="property-name">{props}</span>}
                    </>
                  );

                  if (group.instances.length === 1) {
                    const [match] = group.instances;

                    return instance(
                      match,
                      <>
                        {title}
                        {match.key && <small>key="{match.key}"</small>}
                      </>,
                      `${group.name}${match.key ? ` key ${match.key}` : ''} ${props}`,
                    );
                  }

                  const shown = expanded.has(index)
                    ? group.instances
                    : group.instances.slice(0, GROUP_PAGE);

                  return (
                    <li key={group.instances[0].id} className="reference-group">
                      <div className="reference-group-title">
                        {title}
                        <span className="reference-count">× {group.instances.length}</span>
                      </div>
                      <ul aria-label={`${group.name} instances`}>
                        {shown.map((match, position) =>
                          instance(
                            match,
                            <span className="reference-key">
                              {match.key ? `key="${match.key}"` : `instance ${position + 1}`}
                            </span>,
                            `${group.name} ${match.key ? `key ${match.key}` : `instance ${position + 1}`}`,
                          ),
                        )}
                      </ul>
                      {shown.length < group.instances.length && (
                        <button
                          className="props-more"
                          onClick={() => setExpanded((previous) => new Set(previous).add(index))}
                        >
                          Show all {group.instances.length} instances
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {notes.map((note) => (
                <p className="reference-note" key={note}>
                  {note}
                </p>
              ))}
            </>
          )
        )}
        {scopeId && !search.loading && (
          <button
            className="props-more"
            onClick={() => repeatReferenceSearch(!search.wholePage)}
            title={
              search.wholePage
                ? 'Search the focused subtree and the ancestors of the instance'
                : 'Search all discovered React roots, beyond the focused subtree'
            }
          >
            {search.wholePage ? 'Search the focused subtree only' : 'Search the whole page'}
          </button>
        )}
      </div>
      {result && !search.loading && (
        <div className="props-hint">
          Observed {new Date(result.observedAt).toLocaleTimeString()} ·{' '}
          {result.coverage.components.toLocaleString('en-US')} components in{' '}
          {referenceScope(result)}. A match is the same object at that moment. It does not show who
          created or passed it.
        </div>
      )}
    </details>
  );
}

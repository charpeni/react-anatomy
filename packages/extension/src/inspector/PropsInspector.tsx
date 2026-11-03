import type { PageCall, PropEntry, PropInspection, PropPage } from './types.ts';
import React, { useEffect, useRef, useState } from 'react';
import { Glyph } from './Glyph.tsx';

function propertyPath(parent: string, entry: PropEntry) {
  if (entry.symbol) {
    return `${parent}[${entry.name}]`;
  }

  if (/^(0|[1-9]\d*)$/.test(entry.name)) {
    return `${parent}[${entry.name}]`;
  }

  return /^[A-Za-z_$][\w$]*$/.test(entry.name)
    ? `${parent}.${entry.name}`
    : `${parent}[${JSON.stringify(entry.name)}]`;
}

// Each branch loads independently. A generation guard prevents a late response
// from replacing the next component, filter, or refreshed inspection.
function PropChildren({
  call,
  token,
  handle,
  path,
  ancestors,
  expanded,
  toggle,
  filter = '',
  selectPath,
}: {
  call: PageCall;
  token: string;
  handle: string;
  path: string;
  ancestors: string[];
  expanded: Set<string>;
  toggle: (path: string, open: boolean) => void;
  filter?: string;
  selectPath: (path: string) => void;
}) {
  const [page, setPage] = useState<PropPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  async function load(offset: number, replace: boolean, currentGeneration: number) {
    setLoading(true);
    setError(null);

    try {
      const result = await call({ action: 'props-read', token, handle, offset, filter });

      if (generation.current !== currentGeneration) {
        return;
      }

      if (!result?.ok) {
        throw new Error(result?.message || 'Unable to read props.');
      }

      setPage((previous) =>
        replace || !previous
          ? result
          : {
              ...result,
              ...(result.entries
                ? { entries: [...(previous.entries || []), ...result.entries] }
                : {}),
              ...(result.text !== undefined ? { text: (previous.text || '') + result.text } : {}),
            },
      );
    } catch (error) {
      if (generation.current === currentGeneration) {
        setError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (generation.current === currentGeneration) {
        setLoading(false);
      }
    }
  }

  /* oxlint-disable react-hooks/exhaustive-deps, react/set-state-in-effect -- Each remote branch restarts only when its identity or filter changes. Clearing pending data and invalidating the generation on cleanup prevent stale responses. */
  useEffect(() => {
    const currentGeneration = ++generation.current;

    setPage(null);
    load(0, true, currentGeneration);

    return () => {
      generation.current++;
    };
  }, [token, handle, filter]);

  /* oxlint-enable react-hooks/exhaustive-deps, react/set-state-in-effect */
  return (
    <div className="prop-children" aria-busy={loading}>
      {page?.entries?.map((entry) => {
        const childPath = propertyPath(path, entry);
        const circular = !!entry.value.handle && ancestors.includes(entry.value.handle);
        const expandable = entry.value.expandable && !circular;
        const open = expanded.has(childPath);
        const preview = circular ? '↩ Circular reference' : entry.value.preview;
        const content = (
          <>
            <span className="property-name">
              {entry.name}
              <span className="property-colon">: </span>
            </span>
            <span className={'property-value ' + entry.value.type}>{preview}</span>
          </>
        );

        return expandable ? (
          <details
            className="property-object"
            key={entry.key}
            data-prop-path={childPath}
            open={open}
            onToggle={(e) => {
              if (e.target === e.currentTarget && e.currentTarget.open !== open) {
                toggle(childPath, e.currentTarget.open);
              }
            }}
          >
            <summary title={childPath} onClick={() => selectPath(childPath)}>
              {content}
            </summary>
            {open && (
              <PropChildren
                call={call}
                token={token}
                handle={entry.value.handle!}
                path={childPath}
                ancestors={[...ancestors, entry.value.handle!]}
                expanded={expanded}
                toggle={toggle}
                selectPath={selectPath}
              />
            )}
          </details>
        ) : (
          <div
            className="property-row"
            key={entry.key}
            data-prop-path={childPath}
            title={childPath}
            onClick={() => selectPath(childPath)}
          >
            {content}
          </div>
        );
      })}
      {page?.text !== undefined && <pre className="prop-string">{page.text}</pre>}
      {page?.entries?.length === 0 && !loading && (
        <span className="empty-value">
          {filter ? 'No matching prop names' : path === 'props' ? 'No props' : 'No own properties'}
        </span>
      )}
      {error && (
        <p className="props-error" role="status">
          {error}
        </p>
      )}
      {loading && (
        <span className="props-loading" role="status">
          Loading…
        </span>
      )}
      {!loading && page?.nextOffset != null && (
        <button
          className="props-more"
          onClick={() => load(page.nextOffset!, false, generation.current)}
        >
          Show more ({page.nextOffset} of {page.total})
        </button>
      )}
      {page?.limited && (
        <p className="props-hint">
          Inspection limit: {page.text !== undefined ? '1,000,000 characters' : '10,000 entries'}.
        </p>
      )}
    </div>
  );
}

export function PropsInspector({
  componentId,
  capturedAt,
  call,
}: {
  componentId: string;
  capturedAt: number;
  call: PageCall;
}) {
  const [inspection, setInspection] = useState<PropInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [expanded, setExpanded] = useState(new Set<string>());
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [path, setPath] = useState('props');

  /* oxlint-disable react/set-state-in-effect -- Clear the previous remote inspection while the new request is pending. */
  useEffect(() => {
    let cancelled = false;
    let token: string | undefined;

    setInspection(null);
    setError(null);
    call({ action: 'props', id: componentId })
      .then((result) => {
        token = result.ok ? result.token : undefined;

        if (cancelled) {
          if (token) {
            call({ action: 'props-release', token }).catch(() => {});
          }

          return;
        }

        if (!result?.ok) {
          setError(result?.message || 'Unable to read props.');
        } else {
          setInspection(result);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;

      if (token) {
        call({ action: 'props-release', token }).catch(() => {});
      }
    };
  }, [componentId, capturedAt, refresh, call]);
  /* oxlint-enable react/set-state-in-effect */
  useEffect(() => {
    const timer = setTimeout(() => setQuery(filter), 120);

    return () => clearTimeout(timer);
  }, [filter]);

  function toggle(path: string, open: boolean) {
    setExpanded((previous) => {
      const next = new Set(previous);

      open ? next.add(path) : next.delete(path);

      return next;
    });
  }

  return (
    <details className="inspector-section props-inspector" open>
      <summary>
        Props<span>read-only</span>
      </summary>
      <div className="props-toolbar">
        <label className="props-filter">
          <Glyph type="search" size={12} />
          <input
            aria-label="Filter prop names"
            placeholder="Filter prop names"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        {filter && (
          <button
            className="icon-button"
            aria-label="Clear prop filter"
            title="Clear prop filter"
            onClick={() => setFilter('')}
          >
            <Glyph type="close" size={12} />
          </button>
        )}
        <button
          className="icon-button"
          aria-label="Collapse prop values"
          title="Collapse prop values"
          onClick={() => setExpanded(new Set())}
        >
          <Glyph type="collapse" size={13} />
        </button>
        <button
          className="icon-button"
          aria-label="Refresh props"
          title="Read current props from the component"
          onClick={() => setRefresh((n) => n + 1)}
        >
          <Glyph type="reset" size={13} />
        </button>
      </div>
      <div className="section-body property-list">
        {error ? (
          <p className="props-error" role="status">
            {error}
          </p>
        ) : !inspection ? (
          <span className="props-loading" role="status">
            Reading props…
          </span>
        ) : inspection.root.expandable ? (
          <PropChildren
            key={inspection.token}
            call={call}
            token={inspection.token}
            handle={inspection.root.handle!}
            path="props"
            ancestors={[inspection.root.handle!]}
            expanded={expanded}
            toggle={toggle}
            filter={query}
            selectPath={setPath}
          />
        ) : (
          <span className={'property-value ' + inspection.root.type}>
            {inspection.root.preview}
          </span>
        )}
      </div>
      <div className="props-path" title={path}>
        {path}
      </div>
      <div
        className="props-hint"
        title={
          inspection ? `Last read: ${new Date(inspection.readAt).toLocaleTimeString()}` : undefined
        }
      >
        Current values · Refresh to reread
      </div>
    </details>
  );
}

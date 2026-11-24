import type { ImageProps, PageCall, PropInspection, PropValue } from './types.ts';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Glyph } from './Glyph.tsx';
import {
  changeHidden,
  confirmHidden,
  propertyPath,
  reviewRows,
  sameRows,
  type LoadedPage,
} from './image-props.ts';

interface HideChange {
  path: string;
  container: string;
  value: PropValue;
  hide: boolean;
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
  onPage,
  hidden,
  stale,
  onHide,
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
  /** Reports what this branch shows, which is what an exported props card draws. */
  onPage: (path: string, page: LoadedPage | null) => void;
  /** Values hidden in exported props cards, when this component is included in them. */
  hidden?: Set<string>;
  /** Collections masked in the image because a hidden value in them may have moved. */
  stale?: Set<string>;
  onHide?: (change: HideChange) => void;
}) {
  const [page, setPage] = useState<LoadedPage | null>(null);
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

      const readAt = Date.now();

      setPage((previous) =>
        replace || !previous
          ? { ...result, readAt }
          : {
              ...result,
              readAt,
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

  // A filtered page is a view of the props, not what an image should show.
  useEffect(() => {
    if (page && !filter) {
      onPage(path, { ...page, handle });
    }
  }, [page]);

  useEffect(() => () => onPage(path, null), []);
  /* oxlint-enable react-hooks/exhaustive-deps, react/set-state-in-effect */

  return (
    <div className="prop-children" aria-busy={loading}>
      {page?.entries?.map((entry) => {
        const childPath = propertyPath(path, entry);
        const circular = !!entry.value.handle && ancestors.includes(entry.value.handle);
        const expandable = entry.value.expandable && !circular;
        const open = expanded.has(childPath);
        const preview = circular ? '↩ Circular reference' : entry.value.preview;
        const isHidden = !!hidden?.has(childPath);
        const content = (
          <>
            <span className="property-name">
              {entry.name}
              <span className="property-colon">: </span>
            </span>
            <span className={'property-value ' + entry.value.type}>{preview}</span>
          </>
        );
        const item = expandable ? (
          <details
            className={
              'property-object' +
              (isHidden ? ' hidden-in-image' : '') +
              (stale?.has(childPath) ? ' stale-in-image' : '')
            }
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
                onPage={onPage}
                hidden={hidden}
                stale={stale}
                onHide={onHide}
              />
            )}
          </details>
        ) : (
          <div
            className={'property-row' + (isHidden ? ' hidden-in-image' : '')}
            key={entry.key}
            data-prop-path={childPath}
            title={childPath}
            onClick={() => selectPath(childPath)}
          >
            {content}
          </div>
        );

        // The hide button sits beside the entry, not inside its summary, so it
        // never toggles the value or nests one control inside another. Its
        // label stays fixed; aria-pressed carries whether the value is hidden.
        return hidden ? (
          <div className="prop-entry" key={entry.key}>
            {item}
            <button
              className="prop-hide"
              aria-label={`Hide ${entry.name} in props card`}
              aria-pressed={isHidden}
              title={
                (isHidden ? 'Hidden' : 'Hide this value') +
                ' in the exported props card. Page text in the layers stays visible.'
              }
              onClick={() =>
                onHide?.({ path: childPath, container: path, value: entry.value, hide: !isHidden })
              }
            >
              <Glyph type="eyeOff" size={12} />
            </button>
          </div>
        ) : (
          item
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

function newImage(expanded: Set<string>): ImageProps {
  return {
    included: true,
    expanded: [...expanded],
    hidden: [],
    rows: [],
    counts: {},
    reviewedAt: 0,
    stale: [],
  };
}

export function PropsInspector({
  componentId,
  capturedAt,
  call,
  image,
  onImage,
}: {
  componentId: string;
  capturedAt: number;
  call: PageCall;
  /** This component's choices for exported images, whether or not it is included now. */
  image?: ImageProps;
  onImage?: (image: ImageProps) => void;
}) {
  const [inspection, setInspection] = useState<PropInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  // A component reopens with the branches its image shows.
  const [expanded, setExpanded] = useState(() => new Set(image?.expanded));
  const [pages, setPages] = useState<ReadonlyMap<string, LoadedPage>>(() => new Map());
  const included = !!image?.included;
  const hidden = useMemo(
    () => (image?.included ? new Set(image.hidden.map((h) => h.path)) : undefined),
    [image],
  );
  const stale = useMemo(() => new Set(image?.included ? image.stale : []), [image]);
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [path, setPath] = useState('props');

  const onPage = useCallback((pagePath: string, page: LoadedPage | null) => {
    setPages((previous) => {
      const next = new Map(previous);

      page ? next.set(pagePath, page) : next.delete(pagePath);

      return next;
    });
  }, []);

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

  // An included component's card draws what this inspector shows. Report the
  // rows whenever they change, so the image never needs to read the page again.
  /* oxlint-disable react-hooks/exhaustive-deps -- onImage is a new function on every panel render; the rows depend only on these values. */
  useEffect(() => {
    if (!image?.included || !inspection) {
      return;
    }

    const review = reviewRows(pages, image);

    if (
      review &&
      (!sameRows(review.rows, image.rows) ||
        review.reviewedAt !== image.reviewedAt ||
        review.stale.join('\n') !== image.stale.join('\n') ||
        JSON.stringify(review.counts) !== JSON.stringify(image.counts))
    ) {
      onImage?.({ ...image, ...review });
    }
  }, [pages, image, inspection]);
  /* oxlint-enable react-hooks/exhaustive-deps */

  function changeExpanded(next: Set<string>) {
    setExpanded(next);

    if (image) {
      onImage?.({ ...image, expanded: [...next] });
    }
  }

  function toggle(path: string, open: boolean) {
    const next = new Set(expanded);

    open ? next.add(path) : next.delete(path);
    changeExpanded(next);
  }

  function hide(change: HideChange) {
    if (image?.included) {
      onImage?.({ ...image, hidden: changeHidden(image.hidden, pages, change) });
    }
  }

  // Excluding keeps the choices, so including the component again restores
  // its hidden values instead of silently showing them.
  function include() {
    onImage?.(
      image ? { ...image, included: !image.included, expanded: [...expanded] } : newImage(expanded),
    );
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
          onClick={() => changeExpanded(new Set())}
        >
          <Glyph type="collapse" size={13} />
        </button>
        {onImage && (
          <button
            className={'icon-button' + (included ? ' active' : '')}
            aria-label="Include in image"
            aria-pressed={included}
            title={
              included
                ? 'Remove these props from exported images'
                : 'Show these props in exported images'
            }
            onClick={include}
          >
            <Glyph type="image" size={13} />
          </button>
        )}
        <button
          className="icon-button"
          aria-label="Refresh props"
          title="Read current props from the component"
          onClick={() => setRefresh((n) => n + 1)}
        >
          <Glyph type="reset" size={13} />
        </button>
      </div>
      <div className={'section-body property-list' + (included ? ' in-image' : '')}>
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
            onPage={onPage}
            hidden={hidden}
            stale={stale}
            onHide={hide}
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
      {included && image!.stale.length > 0 && (
        <div className="props-stale" role="status">
          <p>
            {image!.stale.map((p) => p.replace(/^props\.?/, '') || 'props').join(', ')} changed
            after you hid a value in it. The image masks it until you check its hidden values.
          </p>
          <button
            className="standard-button"
            onClick={() =>
              onImage?.({ ...image!, hidden: confirmHidden(image!.hidden, pages, image!.stale) })
            }
          >
            Keep hidden values
          </button>
        </div>
      )}
      {included && (
        <div className="props-hint props-image-hint">
          In exported images: top-level props and the branches you expand. The eye button hides a
          value in the props card only; page text and keys stay visible.
        </div>
      )}
    </details>
  );
}

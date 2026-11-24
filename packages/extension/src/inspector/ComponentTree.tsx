import type { ComponentNode, PageCall, SearchMatch } from './types.ts';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Glyph } from './Glyph.tsx';

const ROW_HEIGHT = 21;
const indent = (level: number) => 4 + level * 14;

// Reserve the full horizontal extent even when the widest row is offscreen.
// The row has a 14px toggle, 8px end padding and an 80px minimum select button.
function measureTreeWidth(rows: { node: ComponentNode; level: number }[], fontFamily: string) {
  const measure = document.createElement('canvas').getContext('2d');
  function measureLabels(size: number) {
    const cache = new Map<string, number>();
    return (text: string) => {
      let width = cache.get(text);
      if (width === undefined) {
        if (measure) {
          measure.font = `${size}px ${fontFamily}`;
        }
        width = measure ? Math.ceil(measure.measureText(text).width) : text.length * size * 2;
        cache.set(text, width);
      }
      return width;
    };
  }
  const nameWidth = measureLabels(11);
  const keyWidth = measureLabels(10);
  const badgeWidth = measureLabels((11 * 5) / 6);
  let widest = 0;
  for (const { node, level } of rows) {
    // Button padding, the component glyph and the gap before the name.
    let content = 4 + 12 + 4 + Math.min(240, nameWidth(node.name));
    if (node.key) {
      content += 4 + Math.min(140, keyWidth(`key="${node.key}"`));
    }
    if (node.hasMore) {
      content += 4 + badgeWidth('…');
    }
    if (!node.frame) {
      content += 4 + badgeWidth('○');
    }
    widest = Math.max(widest, indent(level) + 14 + Math.max(80, content) + 8);
  }
  return widest;
}

// The tree panel: every captured component, a page-side search for components
// beyond the capture, and keyboard navigation. Long trees render only the rows
// near the scroll position.
export function ComponentTree({
  nodes,
  byId,
  roots,
  collapsed,
  selectedId,
  hovered,
  picked,
  scopeId,
  scopeName,
  searchRef,
  call,
  isShown,
  onSelect,
  onFocus,
  onToggle,
  onHover,
  onCollapseAll,
}: {
  nodes: ComponentNode[];
  byId: Record<string, ComponentNode>;
  roots: ComponentNode[];
  collapsed: Set<string>;
  selectedId: string;
  hovered: string | null;
  picked: { id: string; time: number } | null;
  scopeId: string | null;
  scopeName?: string;
  searchRef: React.RefObject<HTMLInputElement | null>;
  call: PageCall;
  isShown: (id: string) => boolean;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onToggle: (id: string) => void;
  onHover: (id: string | null) => void;
  onCollapseAll: () => void;
}) {
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [searchStatus, setSearchStatus] = useState('');
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearchResults([]);
      if (!search.trim()) {
        setSearchStatus('');
        return;
      }
      setSearchStatus('Searching this scope…');
      let cursor: string | undefined;
      let matches: SearchMatch[] = [];
      try {
        do {
          const result = await call({
            action: 'search',
            scopeId: scopeId || undefined,
            query: search,
            cursor,
          });
          if (cancelled) {
            return;
          }
          matches = [...matches, ...result.matches];
          setSearchResults(matches);
          cursor = result.cursor || undefined;
          setSearchStatus(
            cursor
              ? `Searching… ${matches.length} matches`
              : result.limited
                ? `${matches.length} matches in searched portion. Refine the search or focus a smaller component.`
                : matches.length
                  ? `${matches.length} matches in this scope`
                  : 'No matching components in this scope.',
          );
          if (cursor) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        } while (cursor && !cancelled);
      } catch (error) {
        if (!cancelled) {
          setSearchStatus(error instanceof Error ? error.message : 'Search failed. Try again.');
        }
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // A new capture replaces `nodes`, so an open search runs again against it.
  }, [search, scopeId, nodes, call]);

  const treeScroll = useRef<HTMLDivElement | null>(null);
  const widthSpacer = useRef<HTMLDivElement | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [treeViewport, setTreeViewport] = useState({ top: 0, height: 600 });
  const treeRows = useMemo(() => {
    const result: { node: ComponentNode; level: number }[] = [];
    const stack = [...roots].reverse().map((node) => ({ node, level: 0 }));
    while (stack.length) {
      const row = stack.pop()!;
      result.push(row);
      if (!collapsed.has(row.node.id)) {
        for (const id of [...row.node.children].reverse()) {
          if (byId[id]) {
            stack.push({ node: byId[id], level: row.level + 1 });
          }
        }
      }
    }
    return result;
  }, [roots, byId, collapsed]);
  const virtual = treeRows.length > 100;
  const rowIndexes = useMemo(
    () => new Map(treeRows.map(({ node }, i) => [node.id, i])),
    [treeRows],
  );
  const firstRow = virtual ? Math.max(0, Math.floor(treeViewport.top / ROW_HEIGHT) - 8) : 0;
  const lastRow = virtual
    ? Math.min(treeRows.length, firstRow + Math.ceil(treeViewport.height / ROW_HEIGHT) + 16)
    : treeRows.length;
  const visibleIndexes = Array.from(
    { length: Math.max(0, lastRow - firstRow) },
    (_, i) => firstRow + i,
  );
  // Keep selection available to scrollIntoView, and preserve the actual DOM focus
  // if the user scrolls away or selects a different component from the stage.
  for (const id of new Set([selectedId, focusedId])) {
    const i = id === null ? undefined : rowIndexes.get(id);
    if (i !== undefined && (i < firstRow || i >= lastRow)) {
      visibleIndexes.push(i);
    }
  }
  if (visibleIndexes.length > lastRow - firstRow) {
    visibleIndexes.sort((a, b) => a - b);
  }
  const searching = !!search.trim();
  useLayoutEffect(() => {
    const spacer = widthSpacer.current;
    const row = treeScroll.current?.querySelector('.tree-row');
    if (!spacer || !row) {
      return;
    }
    const fontFamily = getComputedStyle(row).fontFamily;
    const measure = () => {
      spacer.style.width = measureTreeWidth(treeRows, fontFamily) + 'px';
    };
    measure();
    document.fonts.addEventListener('loadingdone', measure);
    return () => document.fonts.removeEventListener('loadingdone', measure);
  }, [virtual, treeRows, searching]);
  useLayoutEffect(() => {
    const element = treeScroll.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(() =>
      setTreeViewport({ top: element.scrollTop, height: element.clientHeight }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function treeKey(e: React.KeyboardEvent<HTMLButtonElement>, node: ComponentNode) {
    const index = rowIndexes.get(node.id)!;
    let next: ComponentNode | undefined;
    if (e.key === 'ArrowDown') {
      next = treeRows[Math.min(treeRows.length - 1, index + 1)]?.node;
    }
    if (e.key === 'ArrowUp') {
      next = treeRows[Math.max(0, index - 1)]?.node;
    }
    if (e.key === 'Home') {
      next = treeRows[0]?.node;
    }
    if (e.key === 'End') {
      next = treeRows.at(-1)?.node;
    }
    if (e.key === 'ArrowRight') {
      if (node.hasMore && !node.children.length) {
        onFocus(node.id);
      } else if (node.children.length) {
        if (collapsed.has(node.id)) {
          onToggle(node.id);
        } else {
          next = treeRows[index + 1]?.node;
        }
      }
    }
    if (e.key === 'ArrowLeft') {
      if (node.children.length && !collapsed.has(node.id)) {
        onToggle(node.id);
      } else {
        next = node.parent ? byId[node.parent] : undefined;
      }
    }
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      if (next) {
        onSelect(next.id);
        const target = next.id;
        requestAnimationFrame(() =>
          treeScroll.current
            ?.querySelector<HTMLButtonElement>(`[data-tree="${target}"]`)
            ?.focus({ preventScroll: true }),
        );
      }
    }
  }

  useLayoutEffect(() => {
    const button = treeScroll.current?.querySelector('.tree-row.selected .tree-select');
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    button?.querySelector('.node-name')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedId, picked, treeRows, searching]);

  function row(index: number): React.ReactNode {
    const { node, level } = treeRows[index];
    const closed = collapsed.has(node.id);

    return (
      <div
        key={node.id}
        className={`tree-row ${selectedId === node.id ? 'selected ' : ''}${hovered === node.id ? 'hovered ' : ''}${!isShown(node.id) ? 'dimmed' : ''}`}
        style={{ paddingLeft: indent(level), top: virtual ? index * ROW_HEIGHT : undefined }}
        onFocus={() => setFocusedId(node.id)}
        onBlur={() => setFocusedId(null)}
        onMouseEnter={() => onHover(node.id)}
        onMouseLeave={() => onHover(null)}
      >
        <button
          tabIndex={-1}
          className={'tree-toggle ' + (!node.children.length && !node.hasMore ? 'empty' : '')}
          aria-label={(closed ? 'Expand ' : 'Collapse ') + node.name}
          disabled={!node.children.length && !node.hasMore}
          onClick={() =>
            node.hasMore && !node.children.length ? onFocus(node.id) : onToggle(node.id)
          }
        >
          {(node.children.length > 0 || node.hasMore) && (
            <Glyph type={closed || !node.children.length ? 'chevron' : 'chevronDown'} size={12} />
          )}
        </button>
        <button
          role="treeitem"
          aria-level={level + 1}
          aria-selected={selectedId === node.id}
          aria-expanded={node.children.length ? !closed : undefined}
          tabIndex={selectedId === node.id ? 0 : -1}
          className="tree-select"
          data-tree={node.id}
          title={`${node.name}${node.key ? ` key="${node.key}"` : ''}${!node.frame ? ' · No output in the current viewport' : ''}`}
          onKeyDown={(e) => treeKey(e, node)}
          onClick={() => onSelect(node.id)}
          onDoubleClick={() => onFocus(node.id)}
        >
          <span className="node-icon">
            <Glyph type="component" size={12} />
          </span>
          <span className="node-name">{node.name}</span>
          {node.hasMore && (
            <small title="More descendants available. Focus this component to capture them.">
              …
            </small>
          )}
          {node.key && <small className="tree-key">key="{node.key}"</small>}
          {!node.frame && (
            <small title={node.bounds ? 'Outside the captured viewport' : 'No visible DOM output'}>
              ○
            </small>
          )}
        </button>
      </div>
    );
  }

  return (
    <aside className="tree-panel" aria-label="Component hierarchy">
      <div className="panel-title">
        <span>Components</span>
        <span className="count">{nodes.length}</span>
        <button
          className="icon-button"
          aria-label="Collapse all components"
          title="Collapse all components"
          onClick={onCollapseAll}
        >
          <Glyph type="collapse" size={14} />
        </button>
      </div>
      <label className="tree-search">
        <Glyph type="search" size={13} />
        <input
          ref={searchRef}
          aria-label="Find a component"
          placeholder={scopeName ? `Search in ${scopeName}` : 'Search the page'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search ? (
          <button aria-label="Clear filter" onClick={() => setSearch('')}>
            <Glyph type="close" size={12} />
          </button>
        ) : (
          <kbd>/</kbd>
        )}
      </label>
      <div
        className="tree-scroll"
        ref={treeScroll}
        role="tree"
        aria-label="React components"
        data-component-count={nodes.length}
        onScroll={(e) =>
          setTreeViewport({
            top: e.currentTarget.scrollTop,
            height: e.currentTarget.clientHeight,
          })
        }
      >
        {search.trim() ? (
          <>
            <p className="search-empty" role="status">
              {searchStatus || 'Searching this scope…'}
            </p>
            {searchResults.map((match) => (
              <button
                key={match.id}
                className="tree-select search-result"
                data-search-result={match.id}
                onClick={() => {
                  if (byId[match.id]) {
                    onSelect(match.id);
                    setSearch('');
                  } else {
                    onFocus(match.id);
                  }
                }}
              >
                <span className="node-name">{match.name}</span>
                {match.key && <small>{match.key}</small>}
                {!byId[match.id] && <small>Focus to load</small>}
              </button>
            ))}
          </>
        ) : (
          <div
            className={virtual ? 'virtual-tree' : undefined}
            style={{ height: virtual ? treeRows.length * ROW_HEIGHT : undefined }}
          >
            {virtual && <div aria-hidden="true" ref={widthSpacer} className="tree-width-spacer" />}
            {visibleIndexes.map(row)}
          </div>
        )}
      </div>
      <div className="tree-footer">
        Double-click to focus <kbd>F</kbd>
      </div>
    </aside>
  );
}

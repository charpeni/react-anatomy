import type {
  HiddenValue,
  ImageProps,
  ImageRow,
  PropEntry,
  PropPage,
  PropPosition,
  PropValue,
} from './types.ts';

// What a props card in an exported image shows. The image draws the rows the
// author last saw in the inspector; it never reads the page again at export.
// Hidden values are stored without their value, and a hidden entry in an
// array, Map, or Set fails closed: if another value takes its position, its
// whole collection is masked until the author looks at it again.

/** A page of entries as the inspector loaded it, with when it was read. */
export interface LoadedPage extends PropPage {
  readAt: number;
  /** The value this page lists, to recognise a reference back to it. */
  handle?: string;
}

export type LoadedPages = ReadonlyMap<string, LoadedPage>;

/** The path shown for a prop, also used to remember expanded and hidden values. */
export function propertyPath(parent: string, entry: Pick<PropEntry, 'name' | 'symbol'>) {
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

/** Entries of arrays, Maps, and Sets are addressed by position, which can change. */
export function isPositional(path: string) {
  return /\[(0|[1-9]\d*)\]$/.test(path);
}

/** Objects keep their identity across reads; other values are known by their preview. */
export function fingerprint(value: PropValue) {
  return value.identity ?? `${value.type}:${value.preview}`;
}

/** The start of a text value, for spotting it in page text. Short values match too much. */
export function hiddenText(value: PropValue) {
  if (value.type !== 'string') {
    return undefined;
  }

  const quoted = /^"(?:[^"\\]|\\.)*"/.exec(value.preview)?.[0];

  try {
    const text = quoted ? (JSON.parse(quoted) as string).trim() : '';

    return text.length >= 4 ? text : undefined;
  } catch {
    return undefined;
  }
}

function entryAt(pages: LoadedPages, container: string, path: string) {
  return pages.get(container)?.entries?.find((entry) => propertyPath(container, entry) === path);
}

// The list items and Map entries a path passes through. A value hidden at
// `users[0].email` moves if another user is inserted, just as `users[0]` would.
function enclosing(path: string, pages: LoadedPages): PropPosition[] {
  const positions: PropPosition[] = [];

  for (const [container, page] of pages) {
    for (const entry of page.entries ?? []) {
      const entryPath = propertyPath(container, entry);
      const next = path[entryPath.length];

      if (isPositional(entryPath) && path.startsWith(entryPath) && (next === '.' || next === '[')) {
        positions.push({
          path: entryPath,
          container,
          fingerprint: fingerprint(entry.value),
          siblings: page.total,
        });
      }
    }
  }

  return positions;
}

// Records again only what is recorded in the confirmed collections. A change
// inside one list item does not confirm the list around it, and collapsed
// collections, which are not loaded, keep their record.
function rematch(hidden: HiddenValue, pages: LoadedPages, containers: string[]): HiddenValue {
  const page = pages.get(hidden.container);
  const entry = entryAt(pages, hidden.container, hidden.path);
  const confirmed = (p: PropPosition) =>
    containers.includes(p.container) && !!pages.get(p.container)?.entries;
  const around = [
    ...(hidden.enclosing ?? []).filter((p) => !confirmed(p)),
    ...enclosing(hidden.path, pages).filter(confirmed),
  ];

  // The value's own record always follows what is at its path now, so the
  // page-text warning looks for the value that is actually hidden.
  return page && entry
    ? {
        ...hidden,
        fingerprint: fingerprint(entry.value),
        siblings: page.total,
        text: hiddenText(entry.value),
        enclosing: around,
      }
    : { ...hidden, enclosing: around };
}

function within(hidden: HiddenValue, containers: string[]) {
  return (
    containers.includes(hidden.container) ||
    !!hidden.enclosing?.some((p) => containers.includes(p.container))
  );
}

/**
 * Hides or shows one value. Changing a value in a collection also confirms the
 * rest of that collection: its other hidden entries are matched to what is
 * there now. Collections around it are not confirmed.
 */
export function changeHidden(
  hidden: HiddenValue[],
  pages: LoadedPages,
  {
    path,
    container,
    value,
    hide,
  }: { path: string; container: string; value: PropValue; hide: boolean },
) {
  const next = hidden.filter((h) => h.path !== path);

  if (hide) {
    next.push({
      path,
      container,
      fingerprint: fingerprint(value),
      siblings: pages.get(container)?.total ?? 0,
      text: hiddenText(value),
      enclosing: enclosing(path, pages),
    });
  }

  return next.map((h) => (within(h, [container]) ? rematch(h, pages, [container]) : h));
}

/** Confirms masked collections: their hidden entries are matched to what is there now. */
export function confirmHidden(hidden: HiddenValue[], pages: LoadedPages, containers: string[]) {
  return hidden.map((h) => (within(h, containers) ? rematch(h, pages, containers) : h));
}

/**
 * Collections whose hidden entries may now hold different values: either the
 * hidden entry itself, or a list item or Map entry it sits inside, moved.
 */
export function staleContainers(hidden: HiddenValue[], pages: LoadedPages) {
  const stale = new Set<string>();

  for (const h of hidden) {
    for (const position of [...(isPositional(h.path) ? [h] : []), ...(h.enclosing ?? [])]) {
      const page = pages.get(position.container);

      // A collapsed collection is not drawn, so it cannot reveal anything.
      if (!page?.entries) {
        continue;
      }

      const entry = entryAt(pages, position.container, position.path);

      if (
        !entry ||
        page.total !== position.siblings ||
        fingerprint(entry.value) !== position.fingerprint
      ) {
        stale.add(position.container);
      }
    }
  }

  return [...stale];
}

/**
 * The rows a props card shows: top-level props, expanded branches, hidden
 * values without their value, and masked collections as a single line.
 *
 * Returns null until every expanded branch has loaded, so a card is never
 * replaced by a partial view while the inspector reads props again.
 */
export function reviewRows(
  pages: LoadedPages,
  { expanded, hidden }: Pick<ImageProps, 'expanded' | 'hidden'>,
): Pick<ImageProps, 'rows' | 'counts' | 'stale' | 'reviewedAt'> | null {
  if (!pages.has('props')) {
    return null;
  }

  let complete = true;

  const open = new Set(expanded);
  const hiddenPaths = new Set(hidden.map((h) => h.path));
  const stale = staleContainers(hidden, pages);
  const rows: ImageRow[] = [];
  const counts: Record<string, number> = {};
  let reviewedAt = 0;

  function walk(path: string, depth: number, ancestors: (string | undefined)[]) {
    const page = pages.get(path);

    if (!page) {
      complete = false;

      return;
    }

    reviewedAt = Math.max(reviewedAt, page.readAt);

    if (stale.includes(path)) {
      rows.push({ depth, name: '', type: 'stale' });

      return;
    }

    if (page.text !== undefined) {
      const text = page.text.slice(0, 300);

      rows.push({
        depth,
        name: '',
        type: 'string',
        preview: JSON.stringify(text) + (page.total > text.length ? '…' : ''),
      });

      return;
    }

    const entries = page.entries ?? [];

    counts[path] = entries.length;

    for (const entry of entries) {
      const childPath = propertyPath(path, entry);

      if (hiddenPaths.has(childPath)) {
        rows.push({ depth, name: entry.name, type: entry.value.type, hidden: true });
        continue;
      }

      rows.push({ depth, name: entry.name, type: entry.value.type, preview: entry.value.preview });

      // The inspector does not expand a reference back to an enclosing value.
      const chain = [...ancestors, page.handle];
      const circular = !!entry.value.handle && chain.includes(entry.value.handle);

      if (open.has(childPath) && entry.value.expandable && !circular) {
        walk(childPath, depth + 1, chain);
      }
    }

    if (page.nextOffset != null) {
      const more = page.total - entries.length;

      rows.push({ depth, name: '', type: 'more', preview: `${more.toLocaleString('en-US')} more` });
    }
  }

  walk('props', 0, []);

  if (!complete) {
    return null;
  }

  return { rows, counts, stale, reviewedAt };
}

/** Whether two reviews would draw the same card. */
export function sameRows(a: ImageRow[], b: ImageRow[]) {
  return JSON.stringify(a) === JSON.stringify(b);
}

import type { PageCall } from './types.ts';
import type { ReferenceMatch, ReferenceSearch } from './reference-types.ts';
import { useEffect, useSyncExternalStore } from 'react';

export interface ReferenceTarget {
  id: string;
  name: string;
  symbol: boolean;
}

interface ReferenceState {
  target: ReferenceTarget | null;
  wholePage: boolean;
  /** Counts explicit searches, so repeating one reads the page again. */
  run: number;
  epoch: string | null;
  /** The inputs of the observation held in `result` or `error`. */
  observed: string | null;
  result: ReferenceSearch | null;
  error: string | null;
}

// The search outlives the details pane it was started from: selecting a match
// replaces the props inspector, and focusing a subtree remounts the viewer.
// One panel has one search, so it lives beside the components that show it.
let state: ReferenceState = {
  target: null,
  wholePage: false,
  run: 0,
  epoch: null,
  observed: null,
  result: null,
  error: null,
};
const listeners = new Set<() => void>();

function update(next: Partial<ReferenceState>) {
  state = { ...state, ...next };

  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function findSameReference(target: ReferenceTarget) {
  update({
    target,
    wholePage: false,
    run: state.run + 1,
    epoch: null,
    observed: null,
    result: null,
    error: null,
  });
}

export function repeatReferenceSearch(wholePage = state.wholePage) {
  update({ wholePage, run: state.run + 1 });
}

export function closeReferenceSearch() {
  update({ target: null, epoch: null, observed: null, result: null, error: null });
}

export function useReferenceTarget() {
  return useSyncExternalStore(subscribe, () => state.target);
}

// Each capture pairs the search with the snapshot on screen: the instance IDs
// in a result are only offered while they describe the tree the user can see.
export function useReferenceSearch(call: PageCall, capturedAt: number, scopeId: string | null) {
  const current = useSyncExternalStore(subscribe, () => state);
  const scope = current.wholePage ? null : scopeId;
  const wanted = current.target ? `${current.run}:${capturedAt}:${scope ?? ''}` : null;

  useEffect(() => {
    const target = state.target;

    if (!wanted || !target || state.observed === wanted) {
      return;
    }

    let cancelled = false;

    const finish = (next: Partial<ReferenceState>) => {
      if (!cancelled && state.target === target) {
        update({ observed: wanted, result: null, error: null, ...next });
      }
    };

    call({
      action: 'same-reference',
      id: target.id,
      name: target.name,
      symbol: target.symbol,
      ...(scope ? { scopeId: scope } : {}),
      ...(state.epoch ? { epoch: state.epoch } : {}),
    })
      .then((result) =>
        result?.ok
          ? finish({ result, epoch: result.epoch })
          : finish({ error: result?.message || 'Unable to search for this reference.' }),
      )
      .catch((error) => finish({ error: error instanceof Error ? error.message : String(error) }));

    return () => {
      cancelled = true;
    };
  }, [wanted, scope, call]);

  return { ...current, loading: wanted !== null && current.observed !== wanted };
}

export interface ReferenceGroup {
  name: string;
  props: string[];
  moreProps: number;
  gap: boolean;
  instances: ReferenceMatch[];
}

// Repeated instances that hold the reference under the same prop names share a
// row. Ancestors and gaps stay separate: their order is the path to the instance.
export function groupReferenceMatches(matches: ReferenceMatch[]) {
  const groups: ReferenceGroup[] = [];
  const repeated = new Map<string, ReferenceGroup>();

  for (const match of matches) {
    const single = match.relation === 'gap' || match.relation === 'ancestor';
    const id = JSON.stringify([match.name, match.props, match.moreProps]);
    let group = single ? undefined : repeated.get(id);

    if (!group) {
      group = {
        name: match.name,
        props: match.props,
        moreProps: match.moreProps,
        gap: match.relation === 'gap',
        instances: [],
      };
      groups.push(group);

      if (!single) {
        repeated.set(id, group);
      }
    }

    group.instances.push(match);
  }

  return groups;
}

export function referencePropLabel(props: string[], moreProps = 0) {
  return (
    props.map((name) => (/^[A-Za-z_$][\w$]*$/.test(name) ? '.' + name : `[${name}]`)).join(', ') +
    (moreProps ? ` +${moreProps}` : '')
  );
}

export function referenceScope(search: ReferenceSearch) {
  return search.scope
    ? `${search.scope.name} and the ancestors of the searched instance`
    : search.coverage.roots > 1
      ? `the ${search.coverage.roots} React roots discovered on this page`
      : 'the React root discovered on this page';
}

/** Whether every component in the scope had all of its props compared. */
export function referenceComplete({ coverage }: ReferenceSearch) {
  return (
    !coverage.limit &&
    coverage.ancestors &&
    !coverage.accessors &&
    !coverage.unreadable &&
    !coverage.keyLimited
  );
}

// State what the search compared and found. Only a complete search can say
// that nothing else in its scope holds the reference.
export function referenceSummary(search: ReferenceSearch) {
  const count = search.matches.filter((match) => match.relation !== 'gap').length;
  const complete = referenceComplete(search);
  const found =
    count > 1
      ? `${count} component instances received this same reference.`
      : complete
        ? `No other component holds this reference as a top-level prop, among the ${search.coverage.components.toLocaleString('en-US')} compared in ${referenceScope(search)}.`
        : 'No other match was found.';

  return complete ? found : `${found} The search was incomplete, so others may exist.`;
}

/** Explain which props or components the search skipped. */
export function referenceNotes({ coverage }: ReferenceSearch) {
  const notes: string[] = [];
  const count = (value: number, noun: string) =>
    `${value.toLocaleString('en-US')} ${noun}${value === 1 ? '' : 's'}`;

  if (coverage.limit) {
    const reason = {
      components: 'its component limit',
      matches: 'its match limit',
      fibers: 'its tree size limit',
      time: 'its time limit',
    }[coverage.limit];

    notes.push(
      `Partial: the search reached ${reason} after ${count(coverage.components, 'component')}. Focus a smaller subtree and search again.`,
    );
  }

  if (!coverage.ancestors) {
    notes.push('Partial: some ancestors above the focused subtree could not be resolved.');
  }

  if (coverage.accessors) {
    notes.push(`${count(coverage.accessors, 'accessor prop')} skipped to avoid calling a getter.`);
  }

  if (coverage.unreadable) {
    notes.push(`Props of ${count(coverage.unreadable, 'component')} could not be read.`);
  }

  if (coverage.keyLimited) {
    notes.push(
      `${count(coverage.keyLimited, 'component')} had more than 500 props; only the first 500 were compared.`,
    );
  }

  return notes;
}

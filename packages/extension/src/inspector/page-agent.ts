import type {
  AgentState,
  Fiber,
  FiberRoot,
  PropSession,
  StoredPropEntry,
} from './page-agent-types.ts';
import type {
  CaptureBudget,
  Snapshot,
  SearchMatch,
  ComponentNode,
  Frame,
  PageRequest,
  PageRequests,
  PageResponse,
  PageResponses,
  PropPage,
  PropValue,
  Result,
} from './types.ts';

// This function is the entire inspected-page interface. Keep its dependencies
// inside the function: Chrome executes it in the page's MAIN world.
export function pageAgent<Action extends keyof PageRequests>(
  request: { action: Action } & PageRequests[Action],
): PageResponses[Action];
export function pageAgent(request: PageRequest = { action: 'capture' }): PageResponse {
  const key = '__STRATA_INSPECTOR_V1__';
  const version = 1;
  const previousState = window[key];
  const state: AgentState =
    previousState?.version === version
      ? previousState
      : {
          version,
          revision: 0,
          sequence: 0,
          hostSequence: 0,
          fiberIds: new WeakMap(),
          hostIds: new WeakMap(),
          elements: new Map(),
          owners: new WeakMap(),
          picked: null,
          observer: null,
          overlay: null,
          picker: null,
          lease: null,
          rootHandles: [],
          propSessions: new Map(),
          propSequence: 0,
        };
  if (state !== previousState) {
    Object.defineProperty(window, key, { configurable: true, value: state });
  }

  // A panel upgrade can attach to an agent installed by an earlier preview.
  state.propSessions ||= new Map();
  state.rootHandles ||= [];
  state.propSequence ||= 0;

  const clearHighlight = () => {
    state.overlay?.remove();
    state.overlay = null;
  };

  function stopPicking() {
    if (!state.picker) {
      return;
    }

    document.removeEventListener('pointermove', state.picker.move, true);
    document.removeEventListener('click', state.picker.click, true);
    document.removeEventListener('keydown', state.picker.key, true);
    state.picker = null;
    clearHighlight();
  }

  function dispose() {
    stopPicking();
    clearHighlight();
    state.observer?.disconnect();

    if (state.invalidate) {
      window.removeEventListener('resize', state.invalidate);
      document.removeEventListener('scroll', state.invalidate, true);
    }

    clearTimeout(state.lease ?? undefined);
    clearTimeout(state.highlightTimer);
    state.observer = null;
    state.elements.clear();
    state.owners = new WeakMap();
    state.rootHandles = [];
    state.propSessions.clear();
    state.captureJob = undefined;
    state.searchJob = undefined;
  }

  if (request.action === 'dispose') {
    dispose();

    return { ok: true };
  }

  clearTimeout(state.lease ?? undefined);
  state.lease = setTimeout(dispose, 120000);

  function observe() {
    if (state.observer) {
      return;
    }

    state.invalidate = () => state.revision++;
    state.observer = new MutationObserver((records) => {
      const real = records.some(
        (r) =>
          !state.overlay?.contains(r.target) &&
          r.target !== state.overlay &&
          (r.type !== 'childList' ||
            !Array.from(r.addedNodes)
              .concat(Array.from(r.removedNodes))
              .every((n) => n instanceof Element && n.hasAttribute('data-strata-overlay'))),
      );

      if (real) {
        state.revision++;
      }
    });
    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    window.addEventListener('resize', state.invalidate);
    document.addEventListener('scroll', state.invalidate, true);
  }

  function fiberId(fiber: Fiber) {
    let id =
      state.fiberIds.get(fiber) ||
      (fiber.alternate ? state.fiberIds.get(fiber.alternate) : undefined);

    if (!id) {
      id = `c${++state.sequence}`;
    }

    state.fiberIds.set(fiber, id);

    if (fiber.alternate) {
      state.fiberIds.set(fiber.alternate, id);
    }

    return id;
  }

  function componentName(f: Fiber) {
    if (![0, 1, 2, 11, 14, 15].includes(f.tag)) {
      return null;
    }

    let type = f.type;

    if (type && typeof type !== 'string' && type.displayName) {
      return type.displayName;
    }

    if (type && typeof type !== 'string' && type.render) {
      type = type.render;
    }

    if (type && typeof type !== 'string' && type.type) {
      type = type.type;
    }

    return typeof type === 'function' ? type.displayName || type.name || 'Anonymous' : 'Anonymous';
  }

  function highlight(id: string): Result {
    clearHighlight();

    const elements = state.elements.get(id);

    if (!elements?.length) {
      return { ok: false, message: 'This snapshot has expired. Capture the page again.' };
    }

    const overlay = document.createElement('div');

    overlay.setAttribute('data-strata-overlay', '');
    overlay.style.cssText =
      'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';

    const shadow = overlay.attachShadow({ mode: 'closed' });

    for (const el of elements) {
      if (!el.isConnected) {
        continue;
      }

      const rect = el.getBoundingClientRect();
      const box = document.createElement('div');

      box.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;box-sizing:border-box;border:2px solid #78cfa2;background:#78cfa21a;border-radius:3px;pointer-events:none;`;
      shadow.appendChild(box);
    }

    state.overlay = overlay;
    document.documentElement.appendChild(overlay);

    return { ok: true };
  }

  if (request.action === 'highlight') {
    const result = highlight(request.id);

    clearTimeout(state.highlightTimer);
    state.highlightTimer = setTimeout(clearHighlight, 2500);

    return result;
  }

  if (request.action === 'clear') {
    stopPicking();
    clearHighlight();

    return { ok: true };
  }

  if (request.action === 'element') {
    return state.elements.get(request.id)?.[0] || null;
  }

  if (request.action === 'pick') {
    stopPicking();
    state.picked = null;

    let hovered: string | null = null;

    const owner = (target: EventTarget | null) => {
      for (let el = target; el instanceof Element; el = el.parentElement) {
        const prop = Object.keys(el).find((key) => key.startsWith('__reactFiber$'));
        let fiber = prop
          ? (Object.getOwnPropertyDescriptor(el, prop)?.value as Fiber | undefined)
          : undefined;
        for (let steps = 0; fiber && steps < 1000; steps++, fiber = fiber.return ?? undefined) {
          if (componentName(fiber)) {
            const id = fiberId(fiber);
            let root = fiber;
            for (let steps = 0; root.return && steps++ < 1000;) {
              root = root.return;
            }
            if (
              root.tag === 3 &&
              root.stateNode &&
              !state.rootHandles.includes(root.stateNode as FiberRoot)
            ) {
              state.rootHandles.push(root.stateNode as FiberRoot);
            }
            state.elements.set(id, [el]);
            return id;
          }
        }
        const id = state.owners.get(el);

        if (id) {
          return id;
        }
      }

      return null;
    };

    state.picker = {
      move: (e) => {
        const id = owner(e.target);

        if (id !== hovered) {
          hovered = id;
          id ? highlight(id) : clearHighlight();
        }
      },
      click: (e) => {
        const id = owner(e.target);

        if (!id) {
          return;
        }

        e.preventDefault();
        e.stopImmediatePropagation();
        state.picked = id;
        stopPicking();
      },
      key: (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          stopPicking();
        }
      },
    };
    document.addEventListener('pointermove', state.picker.move, true);
    document.addEventListener('click', state.picker.click, true);
    document.addEventListener('keydown', state.picker.key, true);

    return { ok: true };
  }

  if (request.action === 'status') {
    observe();

    return {
      revision: state.revision,
      picking: !!state.picker,
      picked: state.picked,
      url: location.href,
      title: document.title,
      expired: !state.elements.size,
    };
  }

  // Props are read from the current committed Fiber, independently of the visual
  // snapshot. Only the selected component is retained, and branches cross the
  // extension boundary as typed, bounded descriptors rather than app objects.
  function currentFiber(id: string) {
    const stack = state.rootHandles
      .map((root) => root.current)
      .filter((fiber): fiber is Fiber => fiber !== null);
    let visited = 0;

    while (stack.length && visited++ < 50000) {
      const fiber = stack.pop()!;

      if (
        (state.fiberIds.get(fiber) ||
          (fiber.alternate ? state.fiberIds.get(fiber.alternate) : undefined)) === id
      ) {
        return fiber;
      }

      for (let child = fiber.child; child; child = child.sibling) {
        stack.push(child);
      }
    }

    return null;
  }

  function ownValue(object: unknown, name: PropertyKey): unknown {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);

    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  }

  function propDescriptor(value: unknown, session: PropSession): PropValue {
    try {
      const type = value === null ? 'null' : typeof value;

      if (value === null || value === undefined || typeof value === 'boolean') {
        return { type, preview: String(value) };
      }

      if (typeof value === 'number') {
        return { type, preview: Object.is(value, -0) ? '-0' : String(value) };
      }

      if (typeof value === 'bigint') {
        return { type, preview: String(value) + 'n' };
      }

      if (typeof value === 'symbol') {
        return { type, preview: String(value).slice(0, 200) };
      }

      if (typeof value === 'function') {
        const name = ownValue(value, 'name');

        return {
          type,
          preview: `ƒ ${typeof name === 'string' && name ? name.slice(0, 200) : 'anonymous'}()`,
        };
      }

      if (typeof value === 'string' && value.length <= 180) {
        return { type, preview: JSON.stringify(value) };
      }

      let kind: string = type;
      let preview;

      if (typeof value === 'string') {
        preview = JSON.stringify(value.slice(0, 180)) + `… (${value.length} characters)`;
      } else if (value instanceof Element) {
        return {
          type: 'dom',
          preview: `<${Object.getOwnPropertyDescriptor(Element.prototype, 'tagName')!.get!.call(value).toLowerCase()}>`,
        };
      } else if (value instanceof Date) {
        const time = Date.prototype.getTime.call(value);

        return {
          type: 'date',
          preview: Number.isNaN(time) ? 'Invalid Date' : Date.prototype.toISOString.call(value),
        };
      } else if (Array.isArray(value)) {
        kind = 'array';
        preview = `Array(${ownValue(value, 'length')})`;
      } else if (value instanceof Map) {
        kind = 'map';
        preview = `Map(${Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!.call(value)})`;
      } else if (value instanceof Set) {
        kind = 'set';
        preview = `Set(${Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!.call(value)})`;
      } else if (
        [Symbol.for('react.element'), Symbol.for('react.transitional.element')].includes(
          ownValue(value, '$$typeof') as symbol,
        )
      ) {
        kind = 'react-element';

        const elementType = ownValue(value, 'type');
        const name =
          typeof elementType === 'string'
            ? elementType
            : typeof elementType === 'function'
              ? ownValue(elementType, 'displayName') || ownValue(elementType, 'name')
              : 'React element';

        preview = `<${typeof name === 'string' && name ? name.slice(0, 200) : 'Anonymous'} />`;
      } else {
        preview = 'Object';
      }

      let handle = typeof value === 'object' ? session.seen.get(value) : null;

      if (!handle) {
        if (session.values.size >= 5000) {
          return { type: kind, preview: preview + ' [inspection limit reached]' };
        }

        handle = `v${session.values.size}`;
        session.values.set(handle, { value, kind });

        if (typeof value === 'object') {
          session.seen.set(value, handle);
        }
      }

      return { type: kind, preview, handle, expandable: true };
    } catch {
      return { type: 'unavailable', preview: '[Unavailable]' };
    }
  }

  function propPage(
    session: PropSession,
    handle: string,
    offset = 0,
    filter = '',
  ): Result<PropPage> {
    const stored = session.values.get(handle);

    if (!stored) {
      return { ok: false, message: 'This value is no longer available. Refresh props.' };
    }

    const { value, kind } = stored;
    const start = Number.isSafeInteger(offset) && offset >= 0 ? Math.min(offset, 1000000) : 0;
    const pageSize = 50;
    const limit = 10000;

    try {
      if (kind === 'string' && typeof value === 'string') {
        const end = Math.min(start + 10000, value.length, 1000000);

        return {
          ok: true,
          text: value.slice(start, end),
          total: value.length,
          nextOffset: end < Math.min(value.length, 1000000) ? end : null,
          limited: value.length > 1000000,
        };
      }

      let keys;
      let total;
      let entries: StoredPropEntry[] = [];
      let limited = false;

      if (kind === 'map' || kind === 'set') {
        const prototype = kind === 'map' ? Map.prototype : Set.prototype;

        total = Object.getOwnPropertyDescriptor(prototype, 'size')!.get!.call(value);

        const iterator =
          kind === 'map'
            ? Map.prototype.entries.call(value as Map<unknown, unknown>)
            : Set.prototype.entries.call(value as Set<unknown>);

        for (let i = 0; i < Math.min(start + pageSize, total, limit); i++) {
          const item = iterator.next();

          if (item.done) {
            break;
          }

          if (i >= start) {
            entries.push({
              key: String(i),
              name: String(i),
              value: propDescriptor(
                kind === 'map' ? { key: item.value[0], value: item.value[1] } : item.value[0],
                session,
              ),
            });
          }
        }

        limited = total > limit;
      } else {
        // Do not follow React's private owner/Fiber graph through children props.
        keys =
          kind === 'react-element'
            ? ['type', 'key', 'props']
            : Reflect.ownKeys(value as object).filter(
                (key) => Object.getOwnPropertyDescriptor(value, key)?.enumerable,
              );
        limited = keys.length > limit;
        keys = keys
          .slice(0, limit)
          .map((key, index) => ({ key, id: String(index), name: String(key) }));

        if (filter) {
          keys = keys.filter(({ name }) => name.toLowerCase().includes(filter.toLowerCase()));
        }

        total = keys.length;
        entries = keys.slice(start, start + pageSize).map(({ key, id, name }) => {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          const result = !descriptor
            ? { type: 'unavailable', preview: '[Removed]' }
            : 'value' in descriptor
              ? propDescriptor(descriptor.value, session)
              : {
                  type: 'getter',
                  preview: descriptor.get ? '[Getter — not evaluated]' : '[Setter]',
                };

          return { key: id, name, symbol: typeof key === 'symbol', value: result };
        });
      }

      const end = start + entries.length;

      return {
        ok: true,
        entries,
        total,
        nextOffset: end < Math.min(total, limit) ? end : null,
        limited,
      };
    } catch {
      return { ok: false, message: 'This value cannot be inspected.' };
    }
  }

  if (request.action === 'props-release') {
    state.propSessions.delete(request.token);

    return { ok: true };
  }

  if (request.action === 'props') {
    const fiber = currentFiber(request.id);

    if (!fiber) {
      return { ok: false, message: 'This component is no longer mounted. Capture the page again.' };
    }

    const session: PropSession = {
      id: request.id,
      props: fiber.memoizedProps,
      values: new Map(),
      seen: new WeakMap(),
    };
    const token = `p${++state.propSequence}`;
    const root = propDescriptor(session.props, session);

    state.propSessions.set(token, session);

    while (state.propSessions.size > 4) {
      state.propSessions.delete(state.propSessions.keys().next().value!);
    }

    return { ok: true, token, root, readAt: Date.now() };
  }

  if (request.action === 'props-read') {
    const session = state.propSessions.get(request.token);

    if (!session) {
      return { ok: false, message: 'This props inspection has expired. Refresh props.' };
    }

    const fiber = currentFiber(session.id);

    if (!fiber) {
      return { ok: false, message: 'This component is no longer mounted. Capture the page again.' };
    }

    if (fiber.memoizedProps !== session.props) {
      return {
        ok: false,
        message: 'Props changed in the page. Refresh props to read the current values.',
      };
    }

    return propPage(
      session,
      request.handle,
      request.offset,
      typeof request.filter === 'string' ? request.filter.slice(0, 200) : '',
    );
  }

  if (request.action === 'search') {
    const query = request.query.trim().toLowerCase().slice(0, 150);
    if (!request.cursor) {
      const root = request.scopeId ? currentFiber(request.scopeId) : null;
      if (request.scopeId && !root) {
        throw new Error('This component is no longer mounted. Return to Whole page.');
      }
      state.searchJob = {
        token: `s${(state.jobSequence = (state.jobSequence || 0) + 1)}`,
        query,
        scopeId: request.scopeId,
        queue: root
          ? [root]
          : state.rootHandles.map((r) => r.current).filter((f): f is Fiber => !!f),
        offset: 0,
        matches: 0,
        revision: state.revision,
      };
    }
    const job = state.searchJob;
    if (
      !job ||
      (request.cursor && job.token !== request.cursor) ||
      job.query !== query ||
      job.scopeId !== request.scopeId
    ) {
      throw new Error('Search expired. Search again.');
    }
    if (job.revision !== state.revision) {
      state.searchJob = undefined;
      throw new Error('The page changed during search. Search again.');
    }
    const matches: SearchMatch[] = [];
    const started = performance.now();
    let visits = 0;
    while (
      job.offset < job.queue.length &&
      job.offset < 50000 &&
      job.matches < 200 &&
      visits++ < 500 &&
      performance.now() - started < 8
    ) {
      const fiber = job.queue[job.offset++];
      const name = componentName(fiber);
      if (name && `${name} ${fiber.key || ''}`.toLowerCase().includes(query)) {
        matches.push({
          id: fiberId(fiber),
          name,
          key: fiber.key == null ? null : String(fiber.key).slice(0, 100),
        });
        job.matches++;
      }
      for (let child = fiber.child; child; child = child.sibling) {
        if (job.queue.length >= 50000) {
          break;
        }
        job.queue.push(child);
      }
    }
    const limited =
      job.queue.length >= 50000 || (job.matches >= 200 && job.offset < job.queue.length);
    const done = job.offset >= job.queue.length || limited;
    if (done) {
      state.searchJob = undefined;
    }
    return { matches, cursor: done ? null : job.token, scanned: job.offset, limited };
  }

  if (request.action === 'capture-cancel') {
    if (state.captureJob?.token === request.token) {
      state.captureJob = undefined;
    }
    return { ok: true };
  }
  if (request.action === 'capture-step') {
    const job = state.captureJob;
    if (!job || job.token !== request.token) {
      throw new Error('Capture cancelled.');
    }
    const started = performance.now();
    let step: IteratorResult<void, Snapshot>;
    let count = 0;
    do {
      step = job.iterator.next();
      if (step.done) {
        state.captureJob = undefined;
        return { done: true, snapshot: step.value };
      }
    } while (++count < 250 && performance.now() - started < 8);
    return { done: false };
  }
  if (request.action === 'capture-start') {
    const token = `c${(state.jobSequence = (state.jobSequence || 0) + 1)}`;
    state.captureJob = { token, iterator: capture(request) };
    state.searchJob = undefined;
    return { token };
  }
  if (request.action !== 'capture') {
    return { ok: false, message: 'Unknown inspection action.' };
  }
  const iterator = capture(request);
  let step = iterator.next();
  while (!step.done) {
    step = iterator.next();
  }
  return step.value;

  function* capture(options: CaptureBudget): Generator<void, Snapshot> {
    stopPicking();
    clearHighlight();
    observe();

    let activeMs = 0;
    let resumedAt = performance.now();
    function* checkpoint(): Generator<void> {
      activeMs += performance.now() - resumedAt;
      yield;
      resumedAt = performance.now();
    }
    const workLimit = 1000;
    const maxBytes = 6 * 1024 * 1024;
    const maxVisualElements = 3000;

    // Keep defaults and bounds inside this function: it is serialized into the
    // inspected page and cannot reference an imported configuration module.
    const budget = (value: number | undefined, fallback: number, maximum: number) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.min(Math.floor(value), maximum) || fallback
        : fallback;

    const maxComponents = budget(options.maxComponents, 2000, 5000);
    const maxDepth = budget(options.maxDepth, 300, 1000);
    const limits = {
      components: maxComponents,
      depth: maxDepth,
      maximum: { components: 5000, depth: 1000 },
      hit: { components: false, depth: false },
    };
    const maxElements = 12000;
    const warnings = new Set<string>();
    let truncated = false;
    const roots = new Set<Fiber>();
    const scoped = options.scopeId ? currentFiber(options.scopeId) : null;
    if (options.scopeId && !scoped) {
      throw new Error(
        'This component is no longer mounted. Return to Whole page and capture again.',
      );
    }
    const scopePath: { id: string; name: string }[] = [];
    if (scoped) {
      for (
        let fiber: Fiber | null = scoped, steps = 0;
        fiber && steps++ < 1000;
        fiber = fiber.return
      ) {
        const name = componentName(fiber);
        if (name) {
          scopePath.unshift({ id: fiberId(fiber), name });
        }
      }
    }
    const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;

    // Cooperate with React DevTools when installed. Never replace its hook.
    if (!scoped && hook?.renderers && typeof hook.getFiberRoots === 'function') {
      try {
        for (const id of hook.renderers.keys()) {
          for (const root of hook.getFiberRoots(id)) {
            if (root.current) {
              roots.add(root.current);
            }
          }
        }
      } catch {}
    }

    // Attach after React has mounted, without requiring app code or a reload.
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
    let scanned = 0;

    for (
      let el: Node | null = walker.currentNode;
      !scoped && el && scanned++ < maxElements && activeMs < (roots.size ? 150 : workLimit);
      el = walker.nextNode()
    ) {
      yield* checkpoint();
      for (const prop of Object.keys(el)) {
        if (!prop.startsWith('__reactFiber$') && !prop.startsWith('__reactContainer$')) {
          continue;
        }

        let fiber = Object.getOwnPropertyDescriptor(el, prop)?.value as Fiber | undefined;

        if (!fiber || typeof fiber !== 'object') {
          continue;
        }

        let limit = 0;

        while (fiber.return && limit++ < 1000) {
          fiber = fiber.return;
        }

        if (fiber.tag === 3) {
          roots.add((fiber.stateNode as FiberRoot | null)?.current || fiber);
        }
      }
    }

    if (scoped) {
      roots.add(scoped);
    } else {
      // React can commit between discovery slices. Resolve each root once at
      // the end rather than capturing both sides of its alternate pair.
      state.rootHandles = [
        ...new Set(Array.from(roots, (root) => root.stateNode as FiberRoot).filter(Boolean)),
      ];
      roots.clear();
      for (const handle of state.rootHandles) {
        if (handle.current) {
          roots.add(handle.current);
        }
      }
    }

    const meta = {
      url: location.href,
      title: document.title,
      capturedAt: Date.now(),
      revision: state.revision,
      viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
      rootCount: roots.size,
      ...(scoped ? { scope: { id: options.scopeId!, path: scopePath } } : {}),
    };

    if (!roots.size) {
      return {
        version,
        status: 'no-react',
        nodes: [],
        ...meta,
        message:
          'No mounted React components found in this page. Open a React app and capture again.',
      };
    }

    if (!scoped && (scanned >= maxElements || activeMs >= 150)) {
      warnings.add(
        'DOM discovery reached its work limit. Some roots may be missing; pick a region on the page to inspect it.',
      );
    }

    const nodes: ComponentNode[] = [];
    const allHosts = new Set<Element>();
    const hostRects: Record<string, Frame> = {};
    const rectsByElement = new Map<Element, DOMRect>();
    const measure = (el: Element) => {
      let rect = rectsByElement.get(el);
      if (!rect) {
        rect = el.getBoundingClientRect();
        rectsByElement.set(el, rect);
      }
      return rect;
    };

    const capturedElements = new Map<string, Element[]>();
    const capturedOwners = new WeakMap<Element, string>();

    function hostId(el: Element) {
      if (!state.hostIds.has(el)) {
        state.hostIds.set(el, `h${++state.hostSequence}`);
      }

      return state.hostIds.get(el)!;
    }

    function hostsOf(fiber: Fiber) {
      const hosts: Element[] & { portal?: boolean } = [];
      const stack = [fiber];
      let visits = 0;

      while (stack.length && visits++ < maxElements) {
        const f = stack.pop()!;

        if (f.tag === 4) {
          hosts.portal = true;
        }

        if (f.stateNode instanceof Element) {
          if (f.stateNode.ownerDocument === document) {
            hosts.push(f.stateNode);
          }

          continue;
        }

        const children = [];

        for (let child = f.child; child; child = child.sibling) {
          children.push(child);
        }

        stack.push(...children.reverse());
      }

      return hosts;
    }

    function boundsOf(hosts: Element[]): Frame | null {
      const rects = hosts.map(measure).filter((rect) => rect.width > 0 && rect.height > 0);
      if (!rects.length) {
        return null;
      }

      const x = Math.min(...rects.map((rect) => rect.left));
      const y = Math.min(...rects.map((rect) => rect.top));
      const right = Math.max(...rects.map((rect) => rect.right));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      return { x, y, w: right - x, h: bottom - y };
    }

    const captureArea = { x: 0, y: 0, w: innerWidth, h: innerHeight };
    const scopedBounds = scoped ? boundsOf(hostsOf(scoped).filter((el) => el.isConnected)) : null;
    if (scopedBounds) {
      // Focus changes which components we inspect, not how many screens of DOM
      // we reconstruct. A long list must retain its visible content and fit the
      // viewer. A small offscreen component still gets its own complete view.
      const focusAxis = (start: number, length: number, viewport: number): [number, number] => {
        if (length <= viewport) {
          return [start, length];
        }
        const visibleStart = Math.max(0, start);
        const visibleEnd = Math.min(viewport, start + length);
        return visibleEnd > visibleStart
          ? [visibleStart, visibleEnd - visibleStart]
          : [start, viewport];
      };
      [captureArea.x, captureArea.w] = focusAxis(scopedBounds.x, scopedBounds.w, innerWidth);
      [captureArea.y, captureArea.h] = focusAxis(scopedBounds.y, scopedBounds.h, innerHeight);
    }

    const queue: { fiber: Fiber; parent: ComponentNode | null; portal: boolean; steps: number }[] =
      [...roots].map((fiber) => ({ fiber, parent: null, portal: false, steps: 0 }));
    let cursor = 0;
    const maxVisits = 50000;
    while (cursor < queue.length && cursor < maxVisits && activeMs < workLimit) {
      yield* checkpoint();
      const { fiber, parent, portal, steps } = queue[cursor++];
      if (steps > maxDepth) {
        truncated = true;
        limits.hit.depth = true;
        if (parent) {
          parent.hasMore = true;
        }
        warnings.add(
          `Hierarchy capture stopped beyond ${maxDepth} nested levels. Focus this branch or use Capture more.`,
        );
        continue;
      }
      const name = componentName(fiber);
      let owner = parent;

      if (name) {
        // Reaching the count alone does not mean anything is missing. Report the
        // limit only when an additional React component would be omitted.
        if (nodes.length >= maxComponents) {
          truncated = true;
          limits.hit.components = true;
          warnings.add(
            `Hierarchy capture stopped at ${maxComponents} components. ${maxComponents < limits.maximum.components ? 'Use Capture more or focus a component to inspect its subtree.' : 'Focus a component to inspect more detail within it.'}`,
          );

          if (parent) {
            parent.hasMore = true;
          }
          continue;
        }

        const output = hostsOf(fiber);
        const hosts = output.filter((el) => el.isConnected);
        const bounds = boundsOf(hosts);
        let frame: Frame | null = null;

        if (bounds) {
          const left = Math.max(captureArea.x, bounds.x);
          const top = Math.max(captureArea.y, bounds.y);
          const r = Math.min(captureArea.x + captureArea.w, bounds.x + bounds.w);
          const b = Math.min(captureArea.y + captureArea.h, bounds.y + bounds.h);

          if (r > left && b > top) {
            frame = { x: left, y: top, w: r - left, h: b - top };
          }
        }

        owner = {
          id: fiberId(fiber),
          name: String(name).slice(0, 150),
          key: fiber.key === null ? null : String(fiber.key).slice(0, 100),
          parent: parent?.id || null,
          children: [],
          depth: parent ? parent.depth + 1 : 0,
          hosts: hosts.map(hostId),
          bounds,
          frame,
          portal: portal || !!output.portal,
        };
        nodes.push(owner);

        if (parent) {
          parent.children.push(owner.id);
        }

        capturedElements.set(owner.id, hosts);

        for (const host of hosts) {
          allHosts.add(host);
          capturedOwners.set(host, owner.id);

          const rect = measure(host);

          hostRects[hostId(host)] = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
        }
      }

      for (let child = fiber.child; child; child = child.sibling) {
        if (queue.length >= maxVisits) {
          truncated = true;
          if (owner) {
            owner.hasMore = true;
          }
          break;
        }
        queue.push({
          fiber: child,
          parent: owner,
          portal: portal || fiber.tag === 4,
          steps: steps + 1,
        });
      }
    }
    if (cursor < queue.length || queue.length >= maxVisits) {
      truncated = true;
      for (const item of queue.slice(cursor)) {
        if (item.parent) {
          item.parent.hasMore = true;
        }
      }
      warnings.add('Discovery work limit reached. Focus a component to inspect its subtree.');
    }

    if (!nodes.length) {
      return {
        version,
        status: 'no-react',
        nodes: [],
        ...meta,
        message: 'React is mounted, but no inspectable components are currently rendered.',
      };
    }

    // Serialize DOM once, not once per component. The viewer splits this inert
    // snapshot at host IDs as the user expands and collapses the hierarchy.
    // It re-checks the markup with its own copy of these lists in snapshot.ts;
    // scripts/check-sanitizer.ts keeps the two aligned.
    const forbidden = new Set([
      'SCRIPT',
      'STYLE',
      'LINK',
      'META',
      'BASE',
      'IFRAME',
      'OBJECT',
      'EMBED',
      'NOSCRIPT',
      'TEMPLATE',
    ]);
    const safeAttributes = new Set([
      'viewBox',
      'd',
      'fill',
      'stroke',
      'stroke-width',
      'stroke-linecap',
      'stroke-linejoin',
      'points',
      'x',
      'y',
      'x1',
      'x2',
      'y1',
      'y2',
      'cx',
      'cy',
      'r',
      'rx',
      'ry',
      'width',
      'height',
      'preserveAspectRatio',
      'xmlns',
      'alt',
      'colspan',
      'rowspan',
      'type',
      'placeholder',
    ]);

    function safeAsset(value: string, base = location.href) {
      try {
        const url = new URL(value, base);

        return /^(https?:|data:)/.test(url.protocol) ? url.href : '';
      } catch {
        return '';
      }
    }

    let cloned = 0;
    let bytes = 0;
    let visualLimited = false;
    let styleProperties: string[] | undefined;
    function clone(el: Node, computedStyle?: CSSStyleDeclaration): Node {
      if (el.nodeType === Node.TEXT_NODE) {
        return document.createTextNode((el.textContent ?? '').slice(0, 20000));
      }

      if (!(el instanceof Element) || forbidden.has(el.tagName.toUpperCase())) {
        return document.createTextNode('');
      }

      let copy: Element & ElementCSSInlineStyle;

      if (el instanceof HTMLCanvasElement) {
        copy = document.createElement('img');

        try {
          copy.setAttribute('src', el.toDataURL());
        } catch {
          warnings.add('A canvas could not be captured.');
        }
      } else {
        // Cloning a registered custom element runs its constructor in the app.
        // Its visible output is copied below, into an inert ordinary element.
        const custom =
          el instanceof HTMLElement && (el.localName.includes('-') || el.hasAttribute('is'));
        copy = custom
          ? document.createElement(el.localName.includes('-') ? 'span' : el.localName)
          : (el.cloneNode(false) as Element & ElementCSSInlineStyle);

        if (custom) {
          for (const attribute of Array.from(el.attributes)) {
            if (safeAttributes.has(attribute.name)) {
              copy.setAttribute(attribute.name, attribute.value);
            }
          }
        }

        for (const attribute of Array.from(copy.attributes)) {
          if (!safeAttributes.has(attribute.name)) {
            copy.removeAttribute(attribute.name);
          }
        }
      }

      copy.setAttribute('data-strata-host', hostId(el));

      const computed = computedStyle || getComputedStyle(el);
      // Standard property names are the same for every element in this browser.
      // Enumerate them once: large design systems can add thousands of custom
      // properties to every computed style. Their resolved values are already
      // included in the standard properties we copy below.
      styleProperties ||= Array.from(computed).filter(
        (prop) =>
          !prop.startsWith('--') && !prop.startsWith('animation') && !prop.startsWith('transition'),
      );

      const declarations: string[] = [];
      for (const prop of styleProperties) {
        let value = computed.getPropertyValue(prop);

        value = value.replace(
          /url\(["']?([^"')]+)["']?\)/g,
          (_, url) => `url("${safeAsset(url).replace(/"/g, '%22')}")`,
        );
        declarations.push(`${prop}:${value}`);
      }

      copy.style.cssText = declarations.join(';');
      bytes += copy.style.cssText.length * 2;
      copy.style.setProperty('pointer-events', 'none', 'important');
      copy.style.setProperty('animation', 'none', 'important');
      copy.style.setProperty('transition', 'none', 'important');

      if (el instanceof HTMLImageElement) {
        copy.setAttribute('src', safeAsset(el.currentSrc || el.src));
      }

      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      ) {
        copy.setAttribute('disabled', '');

        if (el instanceof HTMLInputElement && (el.type === 'password' || el.type === 'file')) {
          (copy as HTMLInputElement).value = '';
        }

        if (el instanceof HTMLInputElement && el.type !== 'password' && el.type !== 'file') {
          copy.setAttribute('value', el.value);
        }

        if (el instanceof HTMLInputElement && el.checked) {
          copy.setAttribute('checked', '');
        }

        if (el instanceof HTMLTextAreaElement) {
          copy.textContent = el.value;
        }
      }

      if (el instanceof HTMLVideoElement) {
        warnings.add('Video is represented by its element bounds.');
      }

      return copy;
    }
    const topHosts = [...allHosts].filter((el) => {
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        if (allHosts.has(parent)) {
          return false;
        }
      }

      return true;
    });
    // React roots often sit on a transparent host. Preserve the canvas painted
    // by html/body (or the focused scope's external ancestors) so it does not
    // turn into the inspector's background. Composite translucent colors once,
    // below the captured hosts, rather than filling every component plane.
    let backgroundAncestor: Element | null = topHosts[0]?.parentElement || document.body;
    while (backgroundAncestor) {
      const ancestor: Element = backgroundAncestor;
      if (topHosts.every((host) => ancestor.contains(host))) {
        break;
      }
      backgroundAncestor = ancestor.parentElement;
    }
    const backgroundAncestors: Element[] = [];
    for (let el: Element | null = backgroundAncestor; el; el = el.parentElement) {
      backgroundAncestors.unshift(el);
    }
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const scheme = getComputedStyle(document.documentElement).colorScheme;
    canvas.style.colorScheme =
      scheme.includes('dark') &&
      (!scheme.includes('light') || matchMedia('(prefers-color-scheme: dark)').matches)
        ? 'dark'
        : 'light';
    const context = canvas.getContext('2d');
    let backgroundColor: string | undefined;
    if (context) {
      for (const ancestor of backgroundAncestors) {
        context.fillStyle = getComputedStyle(ancestor).backgroundColor;
        context.fillRect(0, 0, 1, 1);
      }
      if (context.getImageData(0, 0, 1, 1).data[3] < 255) {
        // Resolve the browser canvas color only if the page's own backgrounds
        // leave it visible. Detached canvases use the default color scheme.
        canvas.setAttribute('data-strata-overlay', '');
        canvas.style.setProperty('display', 'none', 'important');
        canvas.style.setProperty('color', 'Canvas', 'important');
        document.documentElement.appendChild(canvas);
        try {
          context.fillStyle = getComputedStyle(canvas).color;
        } finally {
          canvas.remove();
        }
        context.globalCompositeOperation = 'destination-over';
        context.fillRect(0, 0, 1, 1);
      }
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      backgroundColor = `rgb(${r}, ${g}, ${b})`;
    }
    const holder = document.createElement('div');

    // Discover components breadth first, but finish each visible DOM branch
    // before its siblings. If the visual budget runs out, this retains complete
    // text and controls instead of a broad collection of empty containers.
    const pending: { el: Node; parent: Node }[] = topHosts
      .map((el) => ({ el, parent: holder }))
      .reverse();
    const visibleArea = captureArea;
    let visualCursor = 0;
    while (pending.length) {
      yield* checkpoint();
      visualCursor++;
      const { el, parent } = pending.pop()!;
      if (
        el instanceof Element &&
        (forbidden.has(el.tagName.toUpperCase()) || el.hasAttribute('data-strata-overlay'))
      ) {
        continue;
      }
      let computed: CSSStyleDeclaration | undefined;
      if (el instanceof Element) {
        computed = getComputedStyle(el);
        if (computed.display === 'none') {
          // Closed menus and other hidden subtrees have no visible output.
          // Keep the reconstruction budget for the UI the user can see.
          continue;
        }
        const rect = measure(el);
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          (rect.right <= visibleArea.x ||
            rect.bottom <= visibleArea.y ||
            rect.left >= visibleArea.x + visibleArea.w ||
            rect.top >= visibleArea.y + visibleArea.h)
        ) {
          // Keep offscreen flow geometry without spending the reconstruction
          // budget on every card in a long list, including within a focused scope.
          const placeholder = document.createElement('span');
          const style = computed;
          placeholder.setAttribute('data-strata-host', hostId(el));
          placeholder.style.cssText = `display:${style.display};width:${rect.width}px;height:${rect.height}px;box-sizing:border-box;margin:${style.margin};flex:${style.flex};grid-area:${style.gridArea};visibility:hidden`;
          parent.appendChild(placeholder);
          continue;
        }
      }
      if (cloned >= maxVisualElements || bytes >= maxBytes || activeMs >= workLimit) {
        visualLimited = true;
        // Preserve the position/size of omitted regions without retaining their DOM.
        // Keep placeholder work bounded too; the rest is reported as omitted detail.
        if (el instanceof Element && visualCursor < maxVisualElements * 2) {
          const rect = measure(el);
          const placeholder = document.createElement('span');
          placeholder.setAttribute('data-strata-host', hostId(el));
          placeholder.style.cssText = `display:block;width:${rect.width}px;height:${rect.height}px;box-sizing:border-box;background:#80808012`;
          parent.appendChild(placeholder);
        }
        if (activeMs >= workLimit || visualCursor >= maxVisualElements * 2) {
          break;
        }
        continue;
      }
      const copy = clone(el, computed);
      parent.appendChild(copy);
      if (el instanceof Element) {
        cloned++;
        if (!(el instanceof HTMLCanvasElement) && !(el instanceof HTMLTextAreaElement)) {
          // Copy the composed tree: open shadow roots supply rendered content,
          // and slots supply assigned nodes (or their fallback), not hidden light DOM.
          const children =
            el.shadowRoot?.childNodes ||
            (el instanceof HTMLSlotElement ? el.assignedNodes({ flatten: true }) : el.childNodes);
          const count = Math.min(
            children.length,
            Math.max(0, maxVisualElements * 2 - pending.length - visualCursor),
          );
          if (count < children.length) {
            visualLimited = true;
          }
          for (let i = count - 1; i >= 0; i--) {
            pending.push({ el: children[i], parent: copy });
          }
        }
      } else {
        bytes += (copy.textContent?.length || 0) * 2;
      }
    }
    if (visualLimited) {
      warnings.add(
        'Visual detail was limited to keep capture responsive. Focus a component for a more detailed capture.',
      );
    }

    const fontRules: string[] = [];
    let fontRuleCount = 0;
    let fontBytes = 0;

    function collectFonts(rules: CSSRuleList, base: string, depth = 0) {
      for (const rule of rules) {
        if (++fontRuleCount > 10000 || fontBytes > 100000 || depth > 20) {
          break;
        }
        if (rule.type === CSSRule.FONT_FACE_RULE) {
          const css = rule.cssText.replace(
            /url\(["']?([^"')]+)["']?\)/g,
            (_, url) => `url("${safeAsset(url, base).replace(/"/g, '%22')}")`,
          );

          fontBytes += css.length;
          fontRules.push(css);
        } else if ('cssRules' in rule && rule.cssRules) {
          collectFonts((rule as CSSGroupingRule).cssRules, base, depth + 1);
        }
      }
    }

    for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) {
      yield* checkpoint();
      if (activeMs >= workLimit || fontRules.join('').length > 100000) {
        break;
      }
      try {
        collectFonts(sheet.cssRules, sheet.href || location.href);
      } catch {
        warnings.add(
          'Some cross-origin font definitions are unavailable; those fonts may use a fallback.',
        );
      }
    }

    state.elements = capturedElements;
    state.owners = capturedOwners;
    if (meta.revision !== state.revision) {
      warnings.add('The page changed during capture. Refresh to inspect its latest state.');
    }
    return {
      version,
      status: 'ready',
      ...meta,
      nodes,
      html: holder.innerHTML,
      fonts: fontRules.join('\n'),
      backgroundColor,
      hostRects,
      warnings: [...warnings],
      truncated,
      limits,
      captureMs: Math.round(activeMs + performance.now() - resumedAt),
      visualLimited,
      elementCount: cloned,
    };
  }
}

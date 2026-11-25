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
import type { ReferenceCoverage, ReferenceMatch } from './reference-types.ts';
import type {
  ContextDependency,
  ContextReaders,
  ContextRecorder,
  ContextRecording,
} from './context-types.ts';

// This function is the entire inspected-page interface. Keep its dependencies
// inside the function: Chrome executes it in the page's MAIN world.
export function pageAgent<Action extends keyof PageRequests>(
  request: { action: Action } & PageRequests[Action],
): PageResponses[Action];
export function pageAgent(request: PageRequest = { action: 'capture' }): PageResponse {
  const key = '__REACT_ANATOMY_INSPECTOR_V1__';
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
  state.document ||= Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  state.valueIds ||= new WeakMap();
  state.valueSequence ||= 0;
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
    state.contextRecorder?.stop();
    state.contextRecorder = undefined;
    state.contextValues = undefined;
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
              .every((n) => n instanceof Element && n.hasAttribute('data-anatomy-overlay'))),
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

    overlay.setAttribute('data-anatomy-overlay', '');
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

  // Exported images cannot load remote URLs, and the panel's own origin cannot
  // read most page assets. Copy images the page has already loaded and can read
  // (same-origin or CORS-enabled) into bounded data URLs. Others are skipped.
  if (request.action === 'images') {
    const urls = Array.isArray(request.urls) ? request.urls.slice(0, 200) : [];
    const sizes = Array.isArray(request.sizes) ? request.sizes : [];
    const wanted = new Map(urls.map((url, index) => [url, Number(sizes[index]) || 800]));
    const images: Record<string, string> = {};
    let bytes = 0;

    for (const image of Array.from(document.images)) {
      const url = image.currentSrc || image.src;
      const drawn = wanted.get(url);

      if (!drawn || images[url] || !image.complete || !image.naturalWidth) {
        continue;
      }

      // Twice the drawn size is enough for a 2x export, and keeps photos small.
      const longest = Math.max(image.naturalWidth, image.naturalHeight);
      const scale = Math.min(1, Math.max(16, Math.min(1600, drawn * 2)) / longest);
      const canvas = document.createElement('canvas');

      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

      try {
        canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);

        const data = canvas.toDataURL('image/png');

        // Skip an image that does not fit; smaller ones after it may still fit.
        if (bytes + data.length > 12 * 1024 * 1024) {
          continue;
        }

        bytes += data.length;
        images[url] = data;
      } catch {
        // A cross-origin image without CORS taints the canvas and stays unreadable.
      }
    }

    return { images };
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
      document: state.document,
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

  const reactElementProps = ['type', 'key', 'props'];

  function isReactElement(value: unknown) {
    const marker = ownValue(value, '$$typeof');
    return (
      marker === Symbol.for('react.element') || marker === Symbol.for('react.transitional.element')
    );
  }

  // A WeakMap lookup performs no reflection, so it cannot run an app's proxy
  // traps. Identities let the panel notice that a hidden value has moved.
  function identityOf(value: object) {
    let id = state.valueIds!.get(value);

    if (!id) {
      id = `o${++state.valueSequence!}`;
      state.valueIds!.set(value, id);
    }

    return id;
  }

  function entryIdentity(...parts: unknown[]) {
    return parts
      .map((part) =>
        part !== null && (typeof part === 'object' || typeof part === 'function')
          ? identityOf(part)
          : typeof part + ':' + String(part).slice(0, 200),
      )
      .join('|');
  }

  function propDescriptor(value: unknown, session?: PropSession): PropValue {
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
      } else if (isReactElement(value)) {
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

      if (!session) {
        return { type: kind, preview };
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

      return {
        type: kind,
        preview,
        handle,
        expandable: true,
        ...(typeof value === 'object' ? { identity: identityOf(value as object) } : {}),
      };
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
              // Each read wraps a Map entry in a new object; identify it by its parts.
              value:
                kind === 'map'
                  ? {
                      ...propDescriptor({ key: item.value[0], value: item.value[1] }, session),
                      identity: entryIdentity(item.value[0], item.value[1]),
                    }
                  : propDescriptor(item.value[0], session),
            });
          }
        }

        limited = total > limit;
      } else {
        // Do not follow React's private owner/Fiber graph through children props.
        keys =
          kind === 'react-element'
            ? reactElementProps
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

  // Read only the requested own properties. Never expand siblings or evaluate an accessor.
  if (request.action === 'prop-preview') {
    if (request.document !== undefined && request.document !== state.document) {
      return { ok: false, message: 'Document changed. Find the component again.' };
    }
    const fiber = currentFiber(request.id);
    if (!fiber) {
      return { ok: false, message: 'Component unavailable. Find the mounted component again.' };
    }
    if (!request.path.length || request.path.length > 12) {
      return { ok: false, message: 'Supply a path of 1 to 12 prop names.' };
    }
    let value = fiber.memoizedProps;
    try {
      for (const [index, key] of request.path.entries()) {
        if (value === null || typeof value !== 'object') {
          return { ok: false, message: 'Prop path has no inspectable child.' };
        }
        if (isReactElement(value) && !reactElementProps.includes(key)) {
          return { ok: false, message: 'Inspect type, key or props on a React element.' };
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable) {
          return { ok: false, message: 'Prop path was not found.' };
        }
        if (!('value' in descriptor)) {
          if (index !== request.path.length - 1) {
            return { ok: false, message: 'An accessor blocks this path.' };
          }
          return { ok: true, type: 'accessor', preview: '[Accessor — not evaluated]' };
        }
        value = descriptor.value;
      }
      return { ok: true, ...propDescriptor(value) };
    } catch {
      return { ok: false, message: 'This prop cannot be inspected.' };
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

  // Find same reference: which mounted components currently hold the selected
  // prop's value by identity. One synchronous, bounded pass keeps the answer
  // coherent, because React cannot commit halfway through it. Only own data
  // properties are compared, so no getter or callback runs, and equal
  // primitives never match. The compared values stay in the page.
  if (request.action === 'same-reference') {
    state.epoch ||= `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

    if (request.epoch && request.epoch !== state.epoch) {
      return {
        ok: false,
        message: 'The page was reloaded since this search. Select the prop and search again.',
      };
    }

    const source = currentFiber(request.id);
    const sourceName = source && componentName(source);

    if (!source || !sourceName) {
      return { ok: false, message: 'This component is no longer mounted. Capture the page again.' };
    }

    const prop = String(request.name).slice(0, 100);
    let target: unknown;

    try {
      const props = source.memoizedProps;
      let key: PropertyKey = String(request.name);

      if (props === null || typeof props !== 'object') {
        return { ok: false, message: 'This component has no props to match.' };
      }

      if (request.symbol) {
        const symbols = Reflect.ownKeys(props).filter(
          (candidate) => typeof candidate === 'symbol' && String(candidate) === request.name,
        );

        if (symbols.length !== 1) {
          return {
            ok: false,
            message: `This component no longer receives ${prop}. Refresh props.`,
          };
        }

        key = symbols[0];
      }

      const descriptor = Object.getOwnPropertyDescriptor(props, key);

      if (!descriptor) {
        return { ok: false, message: `This component no longer receives ${prop}. Refresh props.` };
      }

      if (!('value' in descriptor)) {
        return {
          ok: false,
          message: 'Accessor props are not evaluated, so they cannot be matched.',
        };
      }

      target = descriptor.value;
    } catch {
      return { ok: false, message: 'This value cannot be inspected.' };
    }

    if (target === null || (typeof target !== 'object' && typeof target !== 'function')) {
      return {
        ok: false,
        message: `Only objects, arrays, and functions have an identity to match. ${prop} now holds a primitive value.`,
      };
    }

    const scope = request.scopeId ? currentFiber(request.scopeId) : null;

    if (request.scopeId && !scope) {
      return {
        ok: false,
        message:
          'The focused component is no longer mounted. Return to Whole page and search again.',
      };
    }

    const maxComponents =
      typeof request.maxComponents === 'number' && request.maxComponents >= 1
        ? Math.min(Math.floor(request.maxComponents), 20000)
        : 5000;
    const maxFibers = 50000;
    const maxMatches = 200;
    const maxKeys = 500;
    const started = performance.now();
    const coverage: ReferenceCoverage = {
      components: 0,
      accessors: 0,
      unreadable: 0,
      keyLimited: 0,
      limit: null,
      ancestors: true,
      roots: 1,
    };
    const matches: ReferenceMatch[] = [];
    let matched = 0;
    let gaps = 0;
    let fibers = 0;
    let ancestorMatched = false;
    let sourceSeen = false;
    let nextClock = 64;

    // A current Fiber's `return` can point at either side of an alternate pair.
    // Use the chain only to recognize ancestors; read props from the current
    // tree, walking down from the root.
    const chain = new Set<Fiber>();
    let top = source;

    for (let fiber = source.return, steps = 0; fiber && steps++ < 1000; fiber = fiber.return) {
      chain.add(fiber);

      if (fiber.alternate) {
        chain.add(fiber.alternate);
      }

      top = fiber;
    }

    const sourceRoot =
      top.tag === 3 ? ((top.stateNode as FiberRoot | null)?.current ?? null) : null;

    const over = () => {
      if (!coverage.limit) {
        coverage.limit =
          coverage.components >= maxComponents
            ? 'components'
            : matched >= maxMatches
              ? 'matches'
              : fibers >= maxFibers
                ? 'fibers'
                : fibers >= nextClock && performance.now() - started > 30
                  ? 'time'
                  : null;

        if (fibers >= nextClock) {
          nextClock = fibers + 64;
        }
      }

      return !!coverage.limit;
    };

    const matching = (fiber: Fiber) => {
      const names: string[] = [];
      const props = fiber.memoizedProps;

      coverage.components++;

      if (props === null || typeof props !== 'object') {
        return names;
      }

      try {
        const keys = Reflect.ownKeys(props);

        if (keys.length > maxKeys) {
          coverage.keyLimited++;
        }

        for (const key of keys.slice(0, maxKeys)) {
          const descriptor = Object.getOwnPropertyDescriptor(props, key);

          if (!descriptor?.enumerable) {
            continue;
          }

          if (!('value' in descriptor)) {
            coverage.accessors++;
          } else if (descriptor.value === target) {
            names.push(String(key).slice(0, 100));
          }
        }
      } catch {
        coverage.unreadable++;
      }

      return names;
    };

    const record = (
      fiber: Fiber,
      name: string,
      names: string[],
      relation: ReferenceMatch['relation'],
      outside: boolean,
    ) => {
      const path: string[] = [];
      let pathTruncated = false;

      for (let parent = fiber.return, steps = 0; parent && steps++ < 1000; parent = parent.return) {
        const parentName = componentName(parent);

        if (!parentName) {
          continue;
        }

        if (path.length === 6) {
          pathTruncated = true;
          break;
        }

        path.unshift(String(parentName).slice(0, 150));
      }

      matches.push({
        id: fiberId(fiber),
        name: String(name).slice(0, 150),
        key: fiber.key === null ? null : String(fiber.key).slice(0, 100),
        props: names.slice(0, 8),
        moreProps: Math.max(0, names.length - 8),
        path,
        pathTruncated,
        relation,
        outside,
      });
    };

    const visit = (fiber: Fiber, inside: boolean, outside: boolean) => {
      const name = componentName(fiber);

      fibers++;

      if (!name) {
        return;
      }

      const relation =
        fiber === source
          ? 'source'
          : chain.has(fiber)
            ? 'ancestor'
            : inside
              ? 'descendant'
              : 'other';
      const names = matching(fiber);

      sourceSeen ||= fiber === source;

      if (names.length) {
        matched++;
        ancestorMatched ||= relation === 'ancestor';
        record(fiber, name, names, relation, outside);
      } else if (relation === 'ancestor' && ancestorMatched && gaps++ < 20) {
        record(fiber, name, [], 'gap', outside);
      }
    };

    const queue: { fiber: Fiber; inside: boolean }[] = [];

    if (scope) {
      // Ancestors above the focused subtree still show where the reference is
      // held on the way down to the selected instance.
      let fiber: Fiber | null = sourceRoot;

      coverage.ancestors = !!fiber;

      while (fiber && fiber !== scope && !over()) {
        visit(fiber, false, true);

        if (fiber === source) {
          break;
        }

        let next: Fiber | null = null;

        for (
          let child: Fiber | null = fiber.child;
          child && fibers++ < maxFibers;
          child = child.sibling
        ) {
          if (child === source || child === scope || chain.has(child)) {
            next = child;
            break;
          }
        }

        coverage.ancestors = !!next;
        fiber = next;
      }

      let inside = false;
      for (let parent = scope.return; parent && !over(); parent = parent.return) {
        fibers++;
        if (parent === source || parent === source.alternate) {
          inside = true;
          break;
        }
      }
      queue.push({ fiber: scope, inside });
    } else {
      const roots = new Set<Fiber>(sourceRoot ? [sourceRoot] : []);

      for (const handle of state.rootHandles) {
        if (handle.current) {
          roots.add(handle.current);
        }
      }

      coverage.roots = roots.size;
      queue.push(...Array.from(roots, (fiber) => ({ fiber, inside: false })).reverse());
    }

    // Depth first, in the order the component tree lists its rows.
    while (queue.length && !over()) {
      const { fiber, inside } = queue.pop()!;
      const children: Fiber[] = [];

      visit(fiber, inside, false);

      for (let child = fiber.child; child; child = child.sibling) {
        if (queue.length + children.length + fibers >= maxFibers) {
          coverage.limit ||= 'fibers';
          break;
        }

        children.push(child);
      }

      for (let index = children.length - 1; index >= 0; index--) {
        queue.push({ fiber: children[index], inside: inside || fiber === source });
      }
    }

    if (!sourceSeen) {
      record(source, sourceName, matching(source), 'source', !!scope);
    }

    const described = propDescriptor(target, {
      id: request.id,
      props: null,
      values: new Map(),
      seen: new WeakMap(),
    });

    return {
      ok: true,
      epoch: state.epoch,
      observedAt: Date.now(),
      source: {
        id: request.id,
        name: String(sourceName).slice(0, 150),
        key: source.key === null ? null : String(source.key).slice(0, 100),
        prop,
        type: described.type,
        preview: described.preview,
      },
      scope: scope
        ? { id: request.scopeId!, name: String(componentName(scope) || 'Anonymous').slice(0, 150) }
        : null,
      matches,
      coverage,
    };
  }

  // Context readers. A Fiber lists the contexts it read in its latest render,
  // so readers come from React's own dependency lists. Each is matched to the
  // nearest provider above it by context object identity, never by name: an
  // alias is the same context, and two contexts can share a display name.
  type ProviderScope = {
    context: object;
    fiber: Fiber;
    changed: boolean;
    parent: ProviderScope | null;
  };

  function providedContext(fiber: Fiber): object | null {
    if (fiber.tag !== 10) {
      return null;
    }

    // React 19 renders the context object itself. Earlier versions render a
    // Provider object that points to it.
    const type = fiber.type as unknown as { _context?: unknown } | null;
    const context = type && typeof type === 'object' ? (type._context ?? type) : null;

    return context && typeof context === 'object' ? context : null;
  }

  function providerOf(scope: ProviderScope | null, context: object) {
    for (let steps = 0; scope && steps++ < 1000; scope = scope.parent) {
      if (scope.context === context) {
        return scope;
      }
    }

    return null;
  }

  // React adds an entry for every read, so a component that reads one context
  // many times has a long list of few contexts. Each context is returned once.
  // A list too long to finish is marked: what it contains is still evidence of
  // a read, but it is no evidence that anything else was not read.
  function dependenciesOf(fiber: Fiber) {
    const list: ContextDependency[] & { truncated?: boolean } = [];
    const seen = new Set<object>();
    let dependency = fiber.dependencies?.firstContext;
    let steps = 0;

    while (dependency && typeof dependency === 'object') {
      if (++steps > 5000 || list.length >= 200) {
        list.truncated = true;

        break;
      }

      if (
        dependency.context &&
        typeof dependency.context === 'object' &&
        !seen.has(dependency.context)
      ) {
        seen.add(dependency.context);
        list.push(dependency);
      }

      dependency = dependency.next;
    }

    return list;
  }

  function contextId(context: object) {
    state.contextIds ||= new WeakMap();

    let id = state.contextIds.get(context);

    if (!id) {
      id = `x${(state.contextSequence = (state.contextSequence || 0) + 1)}`;
      state.contextIds.set(context, id);
    }

    return id;
  }

  function contextName(context: object) {
    try {
      const name = ownValue(context, 'displayName');

      return typeof name === 'string' && name ? name.slice(0, 150) : null;
    } catch {
      return null;
    }
  }

  function providedValue(fiber: Fiber): unknown {
    try {
      return ownValue(fiber.memoizedProps, 'value');
    } catch {
      return undefined;
    }
  }

  // Samples compare identity, as React does, without sending values anywhere
  // or keeping app objects alive: objects get a weakly held token.
  function valueToken(value: unknown) {
    const values = (state.contextValues ||= {
      epoch: `${Date.now()}-${Math.random()}`,
      sequence: 0,
      objects: new WeakMap(),
      primitives: new Map(),
    });

    if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
      let token = values.objects.get(value);

      if (!token) {
        token = `o${++values.sequence}`;
        values.objects.set(value, token);
      }

      return token;
    }

    // Map keys treat -0 as 0. React's Object.is comparison does not.
    if (Object.is(value, -0)) {
      return 'negative-zero';
    }

    let token = values.primitives.get(value);

    if (!token) {
      if (values.primitives.size >= 2000) {
        values.primitives.clear();
        values.epoch = `${Date.now()}-${Math.random()}`;
      }

      token = `p${++values.sequence}`;
      values.primitives.set(value, token);
    }

    return token;
  }

  function knownId(fiber: Fiber) {
    return (
      state.fiberIds.get(fiber) ||
      (fiber.alternate ? state.fiberIds.get(fiber.alternate) : undefined)
    );
  }

  function ownerOf(fiber: Fiber | null) {
    const name = fiber ? componentName(fiber) : null;

    return fiber && name ? { id: fiberId(fiber), name: String(name).slice(0, 150) } : null;
  }

  function isMemo(fiber: Fiber) {
    return fiber.tag === 15 || fiber.return?.tag === 14;
  }

  // React reports each commit to a DevTools-style hook when one existed before
  // React loaded. Count renders from those commit reports.
  function commitHook() {
    try {
      const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;

      return hook &&
        typeof hook.onCommitFiberRoot === 'function' &&
        Number(hook.renderers?.size) > 0
        ? hook
        : null;
    } catch {
      return null;
    }
  }

  function recordingStatus(): ContextRecording {
    const recorder = state.contextRecorder;

    return {
      capability: commitHook() ? 'ready' : 'unavailable',
      active: !!recorder?.active,
      recorded: !!recorder,
      commits: recorder?.commits ?? 0,
      startedAt: recorder?.startedAt,
      stoppedAt: recorder?.stoppedAt,
      limited: !!recorder?.limited,
    };
  }

  if (request.action === 'context-record') {
    if (request.command !== 'start') {
      state.contextRecorder?.stop();

      if (request.command === 'clear') {
        state.contextRecorder = undefined;
      }

      return { ok: true, recording: recordingStatus() };
    }

    const hook = commitHook();

    if (!hook) {
      return {
        ok: false,
        message:
          'React is not reporting commits on this page. Reload the page from this panel to measure renders.',
      };
    }

    state.contextRecorder?.stop();

    const original = hook.onCommitFiberRoot!;
    const recorder: ContextRecorder = {
      active: true,
      startedAt: Date.now(),
      commits: 0,
      limited: false,
      renders: new Map(),
      valueChanges: new Map(),
      stop() {
        if (!recorder.active) {
          return;
        }

        recorder.active = false;
        recorder.stoppedAt = Date.now();

        // Another tool may have wrapped the hook since. Then this wrapper
        // stays in place and only forwards.
        if (hook.onCommitFiberRoot === reportCommit) {
          hook.onCommitFiberRoot = original;
        }
      },
    };

    // Mirrors how React DevTools walks a commit: React replaces the child
    // pointer of every Fiber it worked below, clears the flags of each Fiber
    // it revisits, and sets PerformedWork (1) on those whose component ran.
    // The walk therefore costs about as much as the commit itself did.
    const recordCommit = (root: FiberRoot | null | undefined) => {
      const current = root?.current;

      if (!current) {
        return;
      }

      if (++recorder.commits >= 10000) {
        recorder.limited = true;
        recorder.stop();
      }

      const stack: { fiber: Fiber; scope: ProviderScope | null; mounted: boolean }[] = [
        { fiber: current, scope: null, mounted: false },
      ];
      let visits = 0;

      while (stack.length) {
        if (++visits > 20000) {
          recorder.limited = true;

          break;
        }

        const { fiber, scope: inherited, mounted } = stack.pop()!;
        const previous = mounted ? null : fiber.alternate;
        const context = providedContext(fiber);
        let scope = inherited;

        if (context) {
          const changed = !!previous && !Object.is(providedValue(previous), providedValue(fiber));

          if (changed) {
            const id = fiberId(fiber);

            recorder.valueChanges.set(id, (recorder.valueChanges.get(id) || 0) + 1);
          }

          scope = { context, fiber, changed, parent: inherited };
        }

        if (
          [0, 1, 2, 9, 11, 15].includes(fiber.tag) &&
          (mounted || ((fiber.flags ?? fiber.effectTag ?? 0) & 1) === 1)
        ) {
          const id = fiberId(fiber);
          let record = recorder.renders.get(id);

          if (!record && recorder.renders.size < 20000) {
            record = { renders: 0, mounted: false, withNewValue: {} };
            recorder.renders.set(id, record);
          }

          if (!record) {
            recorder.limited = true;
          } else {
            record.renders++;
            record.mounted ||= mounted;

            if (!mounted && fiber.dependencies?.firstContext) {
              const dependencies = dependenciesOf(fiber);

              // An unfinished list may hide a read of a provider that changed.
              recorder.limited ||= !!dependencies.truncated;

              for (const dependency of dependencies) {
                if (providerOf(inherited, dependency.context)?.changed) {
                  const key = contextId(dependency.context);

                  record.withNewValue[key] = (record.withNewValue[key] || 0) + 1;
                }
              }
            }
          }
        }

        if (!previous || fiber.child !== previous.child) {
          for (let child = fiber.child; child; child = child.sibling) {
            stack.push({ fiber: child, scope, mounted: mounted || !child.alternate });
          }
        }
      }
    };

    function reportCommit(this: unknown, ...args: unknown[]) {
      if (recorder.active) {
        try {
          recordCommit(args[1] as FiberRoot);
        } catch {
          recorder.limited = true;
        }
      }

      return original.apply(this, args);
    }

    hook.onCommitFiberRoot = reportCommit;
    state.contextRecorder = recorder;

    return { ok: true, recording: recordingStatus() };
  }

  if (request.action === 'contexts') {
    type Group = {
      key: string | null;
      context: object;
      fiber: Fiber | null;
      owner: Fiber | null;
      shadows: Fiber | null;
      root: number;
      readers: Set<Fiber>;
      atLeast: boolean;
    };

    const started = performance.now();
    const groups = new Map<Fiber | string, Group>();
    const reads = new Set<Group>();
    const uncertainRoots = new Set<number>();
    let above: Fiber[] = [];
    let limited = false;
    let visits = 0;
    const stack: {
      fiber: Fiber;
      scope: ProviderScope | null;
      owner: Fiber | null;
      root: number;
    }[] = [];

    for (let root = state.rootHandles.length - 1; root >= 0; root--) {
      const fiber = state.rootHandles[root].current;

      if (fiber) {
        stack.push({ fiber, scope: null, owner: null, root });
      }
    }

    // One bounded, synchronous pass: every provider and reader is read from
    // the same committed tree.
    while (stack.length) {
      if (++visits > 50000 || (visits % 256 === 0 && performance.now() - started > 50)) {
        limited = true;

        break;
      }

      const entry = stack.pop()!;
      const { fiber, root } = entry;
      const named = !!componentName(fiber);
      const attributed = named ? fiber : entry.owner;
      const context = providedContext(fiber);
      let scope = entry.scope;

      if (request.id && knownId(fiber) === request.id) {
        for (let outer = entry.scope; outer; outer = outer.parent) {
          above.push(outer.fiber);
        }
      }

      if (context) {
        if (groups.size < 300) {
          groups.set(fiber, {
            key: null,
            context,
            fiber,
            owner: entry.owner,
            shadows: providerOf(entry.scope, context)?.fiber || null,
            root,
            readers: new Set(),
            atLeast: false,
          });
        } else {
          limited = true;
        }

        scope = { context, fiber, changed: false, parent: entry.scope };
      }

      if (fiber.dependencies?.firstContext && attributed) {
        const dependencies = dependenciesOf(fiber);

        if (dependencies.truncated) {
          // This component may also read any provider above it, or a default.
          uncertainRoots.add(root);

          for (let outer = entry.scope; outer; outer = outer.parent) {
            const group = groups.get(outer.fiber);

            if (group) {
              group.atLeast = true;
            }
          }
        }

        for (const dependency of dependencies) {
          const provider = providerOf(entry.scope, dependency.context)?.fiber;
          // Roots share no providers, so each root has its own default-value readers.
          const unprovided = `default:${contextId(dependency.context)}@${root}`;
          let group = groups.get(provider || unprovided);

          if (!group && !provider && groups.size < 300) {
            group = {
              key: null,
              context: dependency.context,
              fiber: null,
              owner: null,
              shadows: null,
              root,
              readers: new Set(),
              atLeast: false,
            };
            groups.set(unprovided, group);
          }

          if (!group) {
            limited = true;

            continue;
          }

          group.readers.add(attributed);

          if (request.id && knownId(attributed) === request.id) {
            reads.add(group);
          }
        }
      }

      if (fiber.sibling) {
        stack.push({ fiber: fiber.sibling, scope: entry.scope, owner: entry.owner, root });
      }

      if (fiber.child) {
        stack.push({ fiber: fiber.child, scope, owner: attributed, root });
      }
    }

    const keyOf = (group: Group) =>
      (group.key ||= group.fiber
        ? fiberId(group.fiber)
        : `default:${contextId(group.context)}@${group.root}`);

    above = above.filter((fiber) => groups.has(fiber));

    return {
      providers: Array.from(groups.values(), (group) => ({
        key: keyOf(group),
        kind: group.fiber ? 'provider' : 'default',
        contextId: contextId(group.context),
        name: contextName(group.context),
        owner: ownerOf(group.owner),
        readers: group.readers.size,
        atLeast: limited || group.atLeast || (!group.fiber && uncertainRoots.has(group.root)),
        shadows:
          group.shadows && groups.has(group.shadows) ? keyOf(groups.get(group.shadows)!) : null,
        root: group.root,
      })),
      reads: Array.from(reads, keyOf),
      above: above.map((fiber) => keyOf(groups.get(fiber)!)),
      roots: state.rootHandles.length,
      session: (state.contextSession ||= `${Date.now()}-${Math.random()}`),
      limited,
      recording: recordingStatus(),
      readAt: Date.now(),
    };
  }

  if (request.action === 'context-readers') {
    const key = String(request.key);
    const fallback = key.startsWith('default:');
    const provider = fallback ? null : currentFiber(key);
    const context = provider ? providedContext(provider) : null;

    if (!fallback && !context) {
      return {
        ok: false,
        message: 'This provider is no longer mounted. Refresh the context list.',
      };
    }

    const [, defaultContext = '', defaultRoot = ''] = /^default:([^@]+)@(\d+)$/.exec(key) || [];
    const unprovidedRoot = fallback ? state.rootHandles[Number(defaultRoot)]?.current : null;

    if (fallback && !unprovidedRoot) {
      return {
        ok: false,
        message: 'This React root is no longer mounted. Refresh the context list.',
      };
    }

    const wanted = context ? contextId(context) : defaultContext;
    let matched: object | null = context;
    const matches = (candidate: object) =>
      context ? candidate === context : state.contextIds?.get(candidate) === wanted;

    type Draft = {
      fiber: Fiber;
      counted: Fiber;
      via: 'component' | 'consumer';
      dependency: ContextDependency;
      portal: boolean;
    };

    const started = performance.now();
    const readers = new Map<Fiber, Draft>();
    const nested = new Map<Fiber, Set<Fiber>>();
    const shadowed = new Set<Fiber>();
    const others = new Set<Fiber>();
    const unchecked = new Set<Fiber>();
    let limited = false;
    let visits = 0;
    let above: Fiber | null = null;
    const stack: { fiber: Fiber; shadow: Fiber | null; owner: Fiber | null; portal: boolean }[] =
      [];

    if (provider) {
      for (let fiber = provider.return, steps = 0; fiber && steps++ < 1000; fiber = fiber.return) {
        if (componentName(fiber)) {
          above = fiber;

          break;
        }
      }

      if (provider.child) {
        stack.push({ fiber: provider.child, shadow: null, owner: above, portal: false });
      }
    } else if (unprovidedRoot) {
      stack.push({ fiber: unprovidedRoot, shadow: null, owner: null, portal: false });
    }

    while (stack.length) {
      if (++visits > 50000 || (visits % 256 === 0 && performance.now() - started > 50)) {
        limited = true;

        break;
      }

      const entry = stack.pop()!;
      const { fiber } = entry;
      const named = !!componentName(fiber);
      const attributed = named ? fiber : entry.owner;
      const provided = providedContext(fiber);
      let shadow = entry.shadow;
      let descend = true;

      if (provided && matches(provided)) {
        // Below another provider of this context, readers read that provider.
        if (provider) {
          shadow = fiber;
          nested.set(fiber, new Set());
        } else {
          descend = false;
        }
      }

      const dependencies = fiber.dependencies?.firstContext ? dependenciesOf(fiber) : undefined;
      const dependency = dependencies?.find((item) => matches(item.context));

      if (dependency && attributed) {
        matched ||= dependency.context;

        if (entry.shadow) {
          nested.get(entry.shadow)!.add(attributed);
          shadowed.add(attributed);
        } else if (readers.size >= 1000 && !readers.has(attributed)) {
          limited = true;
        } else if (!readers.has(attributed) || named) {
          readers.set(attributed, {
            fiber: attributed,
            counted: fiber,
            via: named ? 'component' : 'consumer',
            dependency,
            portal: entry.portal,
          });
        }
      } else if (dependencies?.truncated) {
        // Not found in an unfinished list: neither a reader nor known not to be one.
        unchecked.add(attributed || fiber);
      } else if (named && fiber.tag !== 14 && provider) {
        // A memo wrapper with a comparator only forwards to the component below it.
        if (others.size < 2000) {
          others.add(fiber);
        } else {
          limited = true;
        }
      }

      if (fiber.sibling) {
        stack.push({ ...entry, fiber: fiber.sibling });
      }

      if (fiber.child && descend) {
        stack.push({
          fiber: fiber.child,
          shadow,
          owner: attributed,
          portal: entry.portal || fiber.tag === 4,
        });
      }
    }

    const value = provider ? providedValue(provider) : undefined;
    const recorder = state.contextRecorder;
    const measured = (fiber: Fiber) => {
      if (!recorder) {
        return {};
      }

      const record = recorder.renders.get(knownId(fiber) ?? '');

      return {
        measured: {
          renders: record?.renders ?? 0,
          withNewValue: record?.withNewValue[wanted] ?? 0,
          mounted: !!record?.mounted,
        },
      };
    };
    const describe = (fiber: Fiber) => ({
      id: fiberId(fiber),
      name: String(componentName(fiber)).slice(0, 150),
      key: fiber.key === null ? null : String(fiber.key).slice(0, 100),
      memo: isMemo(fiber),
    });
    const bystanders = Array.from(others).filter(
      (fiber) => !readers.has(fiber) && !shadowed.has(fiber) && !unchecked.has(fiber),
    );
    const undecided = Array.from(unchecked).filter(
      (fiber) => !readers.has(fiber) && !shadowed.has(fiber),
    ).length;
    const preview = provider
      ? propDescriptor(value, { id: key, props: null, values: new Map(), seen: new WeakMap() })
      : null;
    const epochBefore = state.contextValues?.epoch;
    const result: ContextReaders = {
      provider: {
        key,
        kind: provider ? 'provider' : 'default',
        contextId: wanted,
        name: matched ? contextName(matched) : null,
        owner: ownerOf(above),
        value: preview && { type: preview.type, preview: preview.preview },
        valueToken: provider ? valueToken(value) : null,
        ...(recorder && provider
          ? { valueChanges: recorder.valueChanges.get(knownId(provider) ?? '') ?? 0 }
          : {}),
      },
      readers: Array.from(readers.values())
        .slice(0, 300)
        .map((draft) => ({
          ...describe(draft.fiber),
          via: draft.via,
          portal: draft.portal,
          // React 18 and later keep the value each reader last read.
          ...('memoizedValue' in draft.dependency
            ? {
                valueToken: valueToken(draft.dependency.memoizedValue),
                ...(provider ? { current: Object.is(draft.dependency.memoizedValue, value) } : {}),
              }
            : {}),
          ...measured(draft.counted),
        })),
      nested: Array.from(nested, ([fiber, below]) => ({
        key: fiberId(fiber),
        owner: ownerOf(
          (() => {
            for (let up = fiber.return, steps = 0; up && steps++ < 1000; up = up.return) {
              if (componentName(up)) {
                return up;
              }
            }

            return null;
          })(),
        ),
        readers: below.size,
      })).slice(0, 50),
      bystanders: provider
        ? bystanders.slice(0, 300).map((fiber) => ({ ...describe(fiber), ...measured(fiber) }))
        : null,
      totals: { readers: readers.size, bystanders: bystanders.length, unchecked: undecided },
      epoch: state.contextValues?.epoch ?? '',
      // Tokens issued before the primitive table was reset are not comparable.
      limited: limited || (!!epochBefore && epochBefore !== state.contextValues?.epoch),
      recording: recordingStatus(),
      readAt: Date.now(),
    };

    return { ok: true, ...result };
  }

  // Source evidence for "Trace in source". An opt-in build records, for each
  // component element, the file, text hash, and offset it was written at, in a
  // WeakMap keyed by the element's props object. This reads those records for
  // the selected component and the components around it. It returns positions,
  // hashes, and prop names; prop values never leave the page. All walks are
  // bounded, and nothing is retained between requests.
  if (request.action === 'source-evidence') {
    const fiber = currentFiber(request.id);

    if (!fiber) {
      return { ok: false, message: 'This component is no longer mounted. Capture the page again.' };
    }

    let sites: unknown;
    let builtFiles: unknown;

    try {
      const registry = ownValue(window, '__REACT_ANATOMY_SOURCE_V1__');

      if (registry !== null && typeof registry === 'object') {
        sites = ownValue(registry, 'sites');
        builtFiles = ownValue(registry, 'files');
      }
    } catch {
      sites = undefined;
    }

    const metadata = sites instanceof WeakMap;
    const text = (value: unknown, limit: number) =>
      typeof value === 'string' && value.length <= limit ? value : null;
    const stampOf = (target: Fiber) => {
      const props = target.memoizedProps;

      if (!metadata || props === null || typeof props !== 'object') {
        return null;
      }

      // A component that hands its own props object to another one shares the
      // record of the element it was created from. Only React's memo wrapper
      // legitimately shares it with the component it wraps.
      for (let parent = target.return, steps = 0; parent && steps < 200; parent = parent.return) {
        steps++;

        if (componentName(parent) !== null) {
          if (parent.memoizedProps === props && !(parent.tag === 14 && target.return === parent)) {
            return null;
          }

          break;
        }
      }

      try {
        // The page owns this map; call the built-in so a replaced method cannot run.
        const stamp: unknown = WeakMap.prototype.get.call(sites, props);

        if (stamp === null || typeof stamp !== 'object') {
          return null;
        }

        const file = text(ownValue(stamp, 'file'), 400);
        const hash = text(ownValue(stamp, 'hash'), 80);
        const at = ownValue(stamp, 'at');

        return file !== null && hash !== null && typeof at === 'number' && Number.isSafeInteger(at)
          ? { file, hash, at }
          : null;
      } catch {
        return null;
      }
    };
    const files: Record<string, string> = {};
    const propNames: string[] = [];
    let propNamesLimited = false;

    try {
      if (builtFiles !== null && typeof builtFiles === 'object') {
        const paths = Object.keys(builtFiles);

        for (const path of paths.slice(0, 5000)) {
          const hash = text(ownValue(builtFiles, path), 80);

          if (path.length <= 400 && hash !== null) {
            files[path] = hash;
          }
        }
      }

      if (fiber.memoizedProps !== null && typeof fiber.memoizedProps === 'object') {
        const names = Object.keys(fiber.memoizedProps);

        propNames.push(...names.slice(0, 200).filter((name) => name.length <= 200));
        propNamesLimited = propNames.length < names.length;
      }
    } catch {
      propNamesLimited = true;
    }

    return {
      ok: true,
      metadata,
      self: stampOf(fiber),
      propNames,
      propNamesLimited,
      files,
    };
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
    // A coarse or frozen page clock must still yield control for cancellation.
    do {
      step = job.iterator.next();
      if (step.done) {
        state.captureJob = undefined;
        return { done: true, snapshot: step.value };
      }
    } while (++count < 2000 && performance.now() - started < 8);
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
    const scopePath: SearchMatch[] = [];
    if (scoped) {
      for (
        let fiber: Fiber | null = scoped, steps = 0;
        fiber && steps++ < 1000;
        fiber = fiber.return
      ) {
        const name = componentName(fiber);
        if (name) {
          scopePath.unshift({
            id: fiberId(fiber),
            name: String(name).slice(0, 150),
            key: fiber.key == null ? null : String(fiber.key).slice(0, 100),
          });
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
      document: state.document,
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
    const styleTable: string[] = [];
    const styles = new Map<string, { index: number; byteLength: number }>();
    let remainingStyleChars = maxBytes / 2;

    function writeStyle(copy: Element & ElementCSSInlineStyle, declarations: string) {
      const cached = styles.get(declarations);
      let index: number;
      if (cached) {
        bytes += cached.byteLength;
        index = cached.index;
        if (styleTable[index].length > remainingStyleChars) {
          copy.setAttribute('style', styleTable[index]);
          return;
        }
      } else {
        copy.style.cssText = declarations;
        const byteLength = copy.style.cssText.length * 2;
        // Charge the same normalized declarations for every element, including cache hits.
        bytes += byteLength;
        copy.style.setProperty('pointer-events', 'none', 'important');
        copy.style.setProperty('animation', 'none', 'important');
        copy.style.setProperty('transition', 'none', 'important');
        const css = copy.getAttribute('style')!;
        // Keep overflow inline so a valid final element survives the decoder's expansion limit.
        if (css.length > remainingStyleChars) {
          return;
        }
        index = styleTable.length;
        styleTable.push(css);
        styles.set(declarations, { index, byteLength });
        copy.removeAttribute('style');
      }
      remainingStyleChars -= styleTable[index].length;
      copy.setAttribute('data-anatomy-style', String(index));
    }

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

      copy.setAttribute('data-anatomy-host', hostId(el));

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

      writeStyle(copy, declarations.join(';'));

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
        canvas.setAttribute('data-anatomy-overlay', '');
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
        (forbidden.has(el.tagName.toUpperCase()) || el.hasAttribute('data-anatomy-overlay'))
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
          placeholder.setAttribute('data-anatomy-host', hostId(el));
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
          placeholder.setAttribute('data-anatomy-host', hostId(el));
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
      styleTable,
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

import type {
  AgentState,
  Fiber,
  FiberRoot,
  PropSession,
  StoredPropEntry,
} from './page-agent-types.ts';
import type {
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

  if (request.action !== 'capture') {
    return { ok: false, message: 'Unknown inspection action.' };
  }

  stopPicking();
  clearHighlight();
  observe();

  const start = performance.now();

  // Keep defaults and bounds inside this function: it is serialized into the
  // inspected page and cannot reference an imported configuration module.
  const budget = (value: number | undefined, fallback: number, maximum: number) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.min(Math.floor(value), maximum) || fallback
      : fallback;

  const maxComponents = budget(request.maxComponents, 2000, 10000);
  const maxDepth = budget(request.maxDepth, 300, 1000);
  const limits = {
    components: maxComponents,
    depth: maxDepth,
    maximum: { components: 10000, depth: 1000 },
    hit: { components: false, depth: false },
  };
  const maxElements = 12000;
  const warnings = new Set<string>();
  let truncated = false;
  const roots = new Set<Fiber>();
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;

  // Cooperate with React DevTools when installed. Never replace its hook.
  if (hook?.renderers && typeof hook.getFiberRoots === 'function') {
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
    el && scanned++ < maxElements;
    el = walker.nextNode()
  ) {
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

  state.rootHandles = Array.from(roots, (root) => root.stateNode as FiberRoot).filter(Boolean);

  const meta = {
    url: location.href,
    title: document.title,
    capturedAt: Date.now(),
    revision: state.revision,
    viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
    rootCount: roots.size,
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

  if (scanned >= maxElements) {
    warnings.add('DOM discovery stopped at 12,000 elements. Some roots may be missing.');
  }

  const nodes: ComponentNode[] = [];
  const allHosts = new Set<Element>();
  const hostRects: Record<string, Frame> = {};

  state.elements = new Map();
  state.owners = new WeakMap();

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

  function visit(fiber: Fiber | null, parent: ComponentNode | null, portal = false, steps = 0) {
    if (!fiber) {
      return;
    }

    if (steps > maxDepth) {
      truncated = true;
      limits.hit.depth = true;
      warnings.add(
        `Hierarchy capture stopped beyond ${maxDepth} nested levels. ${maxDepth < limits.maximum.depth ? 'Use Capture more to increase the limit.' : 'The maximum supported nesting depth was reached.'}`,
      );

      return;
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
          `Hierarchy capture stopped at ${maxComponents} components. ${maxComponents < limits.maximum.components ? 'Use Capture more to increase the limit.' : 'The maximum supported component count was reached.'}`,
        );

        return;
      }

      const output = hostsOf(fiber);
      const hosts = output.filter((el) => el.isConnected);
      const rects = hosts
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0);
      let bounds: Frame | null = null;
      let frame: Frame | null = null;

      if (rects.length) {
        const x = Math.min(...rects.map((r) => r.left));
        const y = Math.min(...rects.map((r) => r.top));
        const right = Math.max(...rects.map((r) => r.right));
        const bottom = Math.max(...rects.map((r) => r.bottom));

        bounds = { x, y, w: right - x, h: bottom - y };

        const left = Math.max(0, x);
        const top = Math.max(0, y);
        const r = Math.min(innerWidth, right);
        const b = Math.min(innerHeight, bottom);

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

      state.elements.set(owner.id, hosts);

      for (const host of hosts) {
        allHosts.add(host);
        state.owners.set(host, owner.id);

        const rect = host.getBoundingClientRect();

        hostRects[hostId(host)] = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
      }
    }

    for (let child = fiber.child; child; child = child.sibling) {
      visit(child, owner, portal || fiber.tag === 4, steps + 1);
    }
  }

  for (const root of roots) {
    visit(root, null);
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

  function clone(el: Node): Node {
    if (el.nodeType === Node.TEXT_NODE) {
      return document.createTextNode((el.textContent ?? '').slice(0, 20000));
    }

    if (
      !(el instanceof Element) ||
      forbidden.has(el.tagName.toUpperCase()) ||
      cloned++ >= maxElements
    ) {
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
      copy = el.cloneNode(false) as Element & ElementCSSInlineStyle;

      for (const attribute of Array.from(copy.attributes)) {
        if (!safeAttributes.has(attribute.name)) {
          copy.removeAttribute(attribute.name);
        }
      }
    }

    copy.setAttribute('data-strata-host', hostId(el));

    const computed = getComputedStyle(el);

    for (const prop of computed) {
      if (prop.startsWith('--') || prop.startsWith('animation') || prop.startsWith('transition')) {
        continue;
      }

      let value = computed.getPropertyValue(prop);

      value = value.replace(
        /url\(["']?([^"')]+)["']?\)/g,
        (_, url) => `url("${safeAsset(url).replace(/"/g, '%22')}")`,
      );
      copy.style.setProperty(prop, value);
    }

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

    if (!(el instanceof HTMLCanvasElement) && !(el instanceof HTMLTextAreaElement)) {
      for (const child of el.childNodes) {
        copy.appendChild(clone(child));
      }
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
  const holder = document.createElement('div');

  for (const el of topHosts) {
    holder.appendChild(clone(el));
  }

  if (cloned >= maxElements) {
    warnings.add('Visual capture stopped at 12,000 DOM elements.');
  }

  const fontRules: string[] = [];

  function collectFonts(rules: CSSRuleList, base: string) {
    for (const rule of rules) {
      if (rule.type === CSSRule.FONT_FACE_RULE) {
        const css = rule.cssText.replace(
          /url\(["']?([^"')]+)["']?\)/g,
          (_, url) => `url("${safeAsset(url, base).replace(/"/g, '%22')}")`,
        );

        fontRules.push(css);
      } else if ('cssRules' in rule && rule.cssRules) {
        collectFonts((rule as CSSGroupingRule).cssRules, base);
      }
    }
  }

  for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) {
    try {
      collectFonts(sheet.cssRules, sheet.href || location.href);
    } catch {
      warnings.add(
        'Some cross-origin font definitions are unavailable; those fonts may use a fallback.',
      );
    }
  }

  return {
    version,
    status: 'ready',
    ...meta,
    nodes,
    html: holder.innerHTML,
    fonts: fontRules.join('\n'),
    hostRects,
    warnings: [...warnings],
    truncated,
    limits,
    captureMs: Math.round(performance.now() - start),
    elementCount: cloned,
  };
}

import type { Root } from 'react-dom/client';
import type { Fiber, FiberRoot } from './inspector/page-agent-types.ts';

export interface PrototypeNode {
  id: string;
  name: string;
  parent: string | null;
  depth: number;
  children: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  hosts: Element[];
  props: Record<string, unknown> & { project?: { name?: string }; label?: string; name?: string };
}

// Prototype adapter: inspect our own React root, then measure its host output.
// This intentionally uses React internals; it is not a general browser extension.
export function captureReactRoot(root: Root, container: Element) {
  const origin = container.getBoundingClientRect();
  const nodes: PrototypeNode[] = [];
  let nextId = 0;

  function topHost(fiber: Fiber, list: Element[] = []) {
    if (fiber.stateNode instanceof Element) {
      list.push(fiber.stateNode);

      return list;
    }

    for (let child = fiber.child; child; child = child.sibling) {
      topHost(child, list);
    }

    return list;
  }

  function visit(fiber: Fiber | null, parent: PrototypeNode | null) {
    if (!fiber) {
      return;
    }

    const type = fiber.type;
    const name = typeof type === 'function' ? type.displayName || type.name : null;
    let owner = parent;

    if (name) {
      const hosts = topHost(fiber);
      const rects = hosts
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width && r.height);

      if (rects.length) {
        const x = Math.min(...rects.map((r) => r.left));
        const y = Math.min(...rects.map((r) => r.top));
        const right = Math.max(...rects.map((r) => r.right));
        const bottom = Math.max(...rects.map((r) => r.bottom));
        const props: PrototypeNode['props'] = {};

        for (const [key, value] of Object.entries(fiber.memoizedProps || {})) {
          if (key === 'children' || typeof value === 'function') {
            continue;
          }

          try {
            props[key] = JSON.parse(JSON.stringify(value));
          } catch {
            props[key] = '[complex value]';
          }
        }

        owner = {
          id: `c${nextId++}`,
          name,
          parent: parent?.id || null,
          depth: parent ? parent.depth + 1 : 0,
          children: [],
          x: x - origin.left,
          y: y - origin.top,
          w: right - x,
          h: bottom - y,
          hosts,
          props,
        };
        nodes.push(owner);

        if (parent) {
          parent.children.push(owner.id);
        }
      }
    }

    for (let child = fiber.child; child; child = child.sibling) {
      visit(child, owner);
    }
  }

  visit((root as Root & { _internalRoot: FiberRoot })._internalRoot.current, null);

  return nodes;
}

// Split real DOM content at component boundaries. Hidden children keep their
// layout space; their independent copies occupy the next visual plane.
export function captureMarkup(node: PrototypeNode, splitChildren: PrototypeNode[]) {
  const hidden = new Set(splitChildren.flatMap((child) => child.hosts));
  const wrapper = document.createElement('div');

  Object.assign(wrapper.style, {
    position: 'relative',
    width: node.w + 'px',
    height: node.h + 'px',
    pointerEvents: 'none',
  });

  function cloneStyled(el: Node): Node {
    if (!(el instanceof Element)) {
      return el.cloneNode(true);
    }

    const clone = el.cloneNode(false) as Element & ElementCSSInlineStyle;
    const css = getComputedStyle(el);

    for (const name of css) {
      clone.style.setProperty(name, css.getPropertyValue(name));
    }

    clone.removeAttribute('id');

    if (hidden.has(el)) {
      clone.style.setProperty('visibility', 'hidden', 'important');
    }

    // visibility inherits, but skip descendants entirely to avoid overrides.
    if (!hidden.has(el)) {
      for (const child of el.childNodes) {
        clone.appendChild(cloneStyled(child));
      }
    }

    return clone;
  }

  for (const host of node.hosts) {
    const clone = cloneStyled(host) as Element & ElementCSSInlineStyle;
    const rect = host.getBoundingClientRect();
    const origin = node.hosts[0].getBoundingClientRect();

    Object.assign(clone.style, {
      position: 'absolute',
      left: rect.left - origin.left + 'px',
      top: rect.top - origin.top + 'px',
      margin: '0',
      width: rect.width + 'px',
      height: rect.height + 'px',
      transform: 'none',
    });
    wrapper.appendChild(clone);
  }

  return wrapper.outerHTML;
}

import type { Snapshot, ComponentNode } from './types.ts';

export function makeSnapshotRenderer(
  snapshot: Pick<Snapshot, 'html' | 'hostRects' | 'backgroundColor'>,
) {
  const template = document.createElement('template');

  template.innerHTML = snapshot.html || '';

  // The inspected page is untrusted, including its DOM APIs. Re-check the
  // serialized markup in the extension before inserting it into our document.
  const forbidden = new Set([
    'SCRIPT',
    'STYLE',
    'LINK',
    'META',
    'BASE',
    'IFRAME',
    'OBJECT',
    'EMBED',
    'TEMPLATE',
    'NOSCRIPT',
  ]);
  const attributes = new Set([
    'style',
    'data-anatomy-host',
    'src',
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
    'value',
    'checked',
    'disabled',
  ]);

  for (const el of template.content.querySelectorAll('*')) {
    if (forbidden.has(el.tagName.toUpperCase())) {
      el.remove();
      continue;
    }

    for (const attr of Array.from(el.attributes)) {
      if (!attributes.has(attr.name)) {
        el.removeAttribute(attr.name);
      }
    }

    if (el.hasAttribute('src') && !/^(https?:|data:image\/)/i.test(el.getAttribute('src') ?? '')) {
      el.removeAttribute('src');
    }

    if (el instanceof HTMLInputElement && (el.type === 'password' || el.type === 'file')) {
      el.value = '';
      el.removeAttribute('value');
    }
  }

  const hosts = new Map(
    Array.from(
      template.content.querySelectorAll<HTMLElement | SVGElement>('[data-anatomy-host]'),
    ).map((el) => [el.getAttribute('data-anatomy-host'), el]),
  );
  const cache = new Map<string, string>();

  return (
    node: Pick<ComponentNode, 'id' | 'hosts' | 'frame'>,
    children: Pick<ComponentNode, 'id' | 'hosts' | 'frame'>[],
    backdrop = false,
  ) => {
    if (!node.frame) {
      return '';
    }

    const key = node.id + ':' + children.map((n) => n.id).join(',') + ':' + backdrop;

    if (cache.has(key)) {
      return cache.get(key)!;
    }

    const hidden = new Set(children.flatMap((n) => n.hosts));
    const wrapper = document.createElement('div');

    wrapper.style.cssText = `position:relative;width:${node.frame.w}px;height:${node.frame.h}px;overflow:hidden;pointer-events:none;`;
    if (backdrop && snapshot.backgroundColor) {
      wrapper.style.backgroundColor = snapshot.backgroundColor;
    }

    for (const hostId of node.hosts) {
      const original = hosts.get(hostId);
      const rect = snapshot.hostRects?.[hostId];

      if (!original || !rect) {
        continue;
      }

      // A child plane supplies this region. Keep its measured layout box in
      // the parent, but do not duplicate its hidden descendants in every plane.
      const copy = original.cloneNode(false) as HTMLElement | SVGElement;
      const pending = [{ source: original as Node, target: copy as Node }];
      while (pending.length) {
        const { source, target } = pending.pop()!;
        if (target instanceof HTMLElement || target instanceof SVGElement) {
          if (hidden.has(target.getAttribute('data-anatomy-host') ?? '')) {
            target.style.setProperty('visibility', 'hidden', 'important');
            continue;
          }
        }
        for (const child of source.childNodes) {
          const cloned = child.cloneNode(false);
          target.appendChild(cloned);
          if (child.childNodes.length) {
            pending.push({ source: child, target: cloned });
          } else if (cloned instanceof HTMLElement || cloned instanceof SVGElement) {
            if (hidden.has(cloned.getAttribute('data-anatomy-host') ?? '')) {
              cloned.style.setProperty('visibility', 'hidden', 'important');
            }
          }
        }
      }

      let positioned = copy;
      // Rows, cells and table sections cannot be serialized under a div: the
      // HTML parser discards their tags, taking borders and column layout with
      // them. Preserve their table context and position that context instead.
      const tableParents: Record<string, string[]> = {
        TR: ['tbody'],
        TD: ['tbody', 'tr'],
        TH: ['tbody', 'tr'],
        TBODY: [],
        THEAD: [],
        TFOOT: [],
        CAPTION: [],
        COLGROUP: [],
        COL: ['colgroup'],
      };
      const parents = Object.hasOwn(tableParents, copy.tagName)
        ? tableParents[copy.tagName]
        : undefined;
      if (parents) {
        const table = document.createElement('table');
        table.style.cssText =
          'border:0;padding:0;margin:0;table-layout:fixed;box-sizing:border-box;';
        table.style.borderCollapse = copy.style.borderCollapse || 'separate';
        table.style.borderSpacing = copy.style.borderSpacing || '0';
        let parent: HTMLElement = table;
        for (const tag of parents) {
          const child = document.createElement(tag);
          parent.appendChild(child);
          parent = child;
        }
        copy.style.position = 'static';
        copy.style.transform = 'none';
        parent.appendChild(copy);
        positioned = table;
      }

      // Logical insets copied from a fixed/absolute host otherwise override the
      // new plane-relative physical coordinates (and can clip the entire host).
      for (const prop of [
        'inset-block-start',
        'inset-block-end',
        'inset-inline-start',
        'inset-inline-end',
      ]) {
        positioned.style.removeProperty(prop);
      }

      Object.assign(positioned.style, {
        right: 'auto',
        bottom: 'auto',
        position: 'absolute',
        left: rect.x - node.frame.x + 'px',
        top: rect.y - node.frame.y + 'px',
        margin: '0',
        width: rect.w + 'px',
        height: rect.h + 'px',
        transform: 'none',
      });
      wrapper.appendChild(positioned);
    }

    const html = wrapper.outerHTML;

    cache.set(key, html);

    return html;
  };
}

export function fontFacesOnly(css: string | undefined) {
  const sheet = new CSSStyleSheet();

  try {
    sheet.replaceSync(css || '');
  } catch {
    return '';
  }

  return Array.from(sheet.cssRules)
    .filter((rule) => rule.type === CSSRule.FONT_FACE_RULE)
    .map((rule) => rule.cssText)
    .join('\n');
}

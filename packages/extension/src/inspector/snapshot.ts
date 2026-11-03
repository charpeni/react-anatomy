import type { Snapshot, ComponentNode } from './types.ts';

export function makeSnapshotRenderer(snapshot: Pick<Snapshot, 'html' | 'hostRects'>) {
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
    'data-strata-host',
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
      template.content.querySelectorAll<HTMLElement | SVGElement>('[data-strata-host]'),
    ).map((el) => [el.getAttribute('data-strata-host'), el]),
  );
  const cache = new Map<string, string>();

  return (
    node: Pick<ComponentNode, 'id' | 'hosts' | 'frame'>,
    children: Pick<ComponentNode, 'id' | 'hosts' | 'frame'>[],
  ) => {
    if (!node.frame) {
      return '';
    }

    const key = node.id + ':' + children.map((n) => n.id).join(',');

    if (cache.has(key)) {
      return cache.get(key)!;
    }

    const hidden = new Set(children.flatMap((n) => n.hosts));
    const wrapper = document.createElement('div');

    wrapper.style.cssText = `position:relative;width:${node.frame.w}px;height:${node.frame.h}px;overflow:hidden;pointer-events:none;`;

    for (const hostId of node.hosts) {
      const original = hosts.get(hostId);
      const rect = snapshot.hostRects?.[hostId];

      if (!original || !rect) {
        continue;
      }

      const copy = original.cloneNode(true) as HTMLElement | SVGElement;

      for (const el of [
        copy,
        ...copy.querySelectorAll<HTMLElement | SVGElement>('[data-strata-host]'),
      ]) {
        if (hidden.has(el.getAttribute('data-strata-host') ?? '')) {
          el.style.setProperty('visibility', 'hidden', 'important');
        }
      }

      // A child component can own the same host as its parent. Hide that whole
      // parent copy, then let the child's plane supply the shared output.
      for (const el of copy.querySelectorAll<HTMLElement | SVGElement>('[data-strata-host]')) {
        for (let p = el.parentElement; p && p !== wrapper; p = p.parentElement) {
          if (hidden.has(p.getAttribute('data-strata-host') ?? '')) {
            el.style.setProperty('visibility', 'hidden', 'important');
            break;
          }
        }
      }

      // Logical insets copied from a fixed/absolute host otherwise override the
      // new plane-relative physical coordinates (and can clip the entire host).
      for (const prop of [
        'inset-block-start',
        'inset-block-end',
        'inset-inline-start',
        'inset-inline-end',
      ]) {
        copy.style.removeProperty(prop);
      }

      Object.assign(copy.style, {
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
      wrapper.appendChild(copy);
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

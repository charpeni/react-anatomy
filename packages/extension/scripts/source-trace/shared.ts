import ts from 'typescript';
import { createHash } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';

// The analyzer and the build instrumentation must agree on three things for a
// running element to be joined to its source: the file's path relative to the
// project root, the hash of its text, and the offset of each JSX element.

export const SOURCE_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js', '.mts', '.mjs'];

export function isSourcePath(path: string) {
  return (
    SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension)) &&
    !path.endsWith('.d.ts') &&
    !path.endsWith('.d.mts') &&
    !path.split(/[\\/]/).includes('node_modules')
  );
}

export function fileHash(text: string) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export function stripBom(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function projectPath(root: string, file: string) {
  return relative(resolve(root), resolve(file)).split(sep).join('/');
}

export function scriptKind(path: string) {
  return path.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : path.endsWith('.jsx') || path.endsWith('.js') || path.endsWith('.mjs')
      ? ts.ScriptKind.JSX
      : ts.ScriptKind.TS;
}

export type JsxSiteNode = ts.JsxElement | ts.JsxSelfClosingElement;

export function openingOf(node: JsxSiteNode) {
  return ts.isJsxElement(node) ? node.openingElement : node;
}

/** `<div>` and `<my-element>` are host elements; `<Row>` and `<ui.Row>` render components. */
export function isComponentTag(tag: ts.JsxTagNameExpression) {
  if (ts.isIdentifier(tag)) {
    return !/^[a-z]/.test(tag.text) && !tag.text.includes('-');
  }

  return !ts.isJsxNamespacedName(tag);
}

export function isComponentSite(node: ts.Node): node is JsxSiteNode {
  return (
    (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) &&
    isComponentTag(openingOf(node).tagName)
  );
}

import ts from 'typescript';
import { SOURCE_REGISTRY_KEY } from '../../src/source-trace/report.ts';
import { fileHash, isComponentSite, scriptKind } from './shared.ts';

// Optional development-build metadata. Each JSX element that renders a
// component is passed through a small function that remembers where the
// element was written:
//
//   <Row item={project} />   becomes   __reactAnatomySite(<Row item={project} />, 412)
//
// The record is kept in a WeakMap keyed by the element's props object, so it
// adds no prop, changes no value the app can observe, and is collected with
// the element. React keeps that same props object on the mounted component,
// which is how the inspector finds the call site of the instance you selected.
//
// Every record carries the hash of the file's text. An analysis made from
// different text has a different hash, so a stale build is detected instead of
// being matched by position.

const HELPER = '__reactAnatomySite';

function prelude(path: string, hash: string, helper: string | null) {
  const registry =
    `const g=globalThis,k=${JSON.stringify(SOURCE_REGISTRY_KEY)};let r=g[k];` +
    `if(!r||r.version!==1){r={version:1,sites:new WeakMap(),files:Object.create(null)};` +
    `try{Object.defineProperty(g,k,{value:r,configurable:true})}catch{}}` +
    `const file=${JSON.stringify(path)},hash=${JSON.stringify(hash)};r.files[file]=hash;`;

  // A file without component elements still records which text was built, so
  // an edited leaf component is noticed through its own file.
  // The leading semicolon matters: after a directive written without one,
  // `'use client'` followed by `(` would be read as a call.
  if (!helper) {
    return `;(()=>{${registry}})();`;
  }

  return (
    `;const ${helper}=(()=>{${registry}const stamps=new Map();` +
    `return(element,at)=>{const props=element&&typeof element==="object"?element.props:null;` +
    `if(props&&typeof props==="object"){let stamp=stamps.get(at);` +
    `if(!stamp){stamp={file,hash,at};stamps.set(at,stamp)}r.sites.set(props,stamp)}return element}})();`
  );
}

export function instrumentSource(
  text: string,
  options: {
    /** The absolute or relative file name; only its extension matters. */
    fileName: string;
    /** The project-relative path, matching the analysis. */
    path: string;
  },
) {
  const sourceFile = ts.createSourceFile(
    options.fileName,
    text,
    ts.ScriptTarget.ESNext,
    true,
    scriptKind(options.fileName),
  );
  const inserts: { at: number; order: number; text: string }[] = [];
  let helper = HELPER;
  let sites = 0;

  // The source may already use the name.
  for (let suffix = 1; text.includes(helper); suffix++) {
    helper = `${HELPER}_${suffix}`;
  }

  const visit = (node: ts.Node) => {
    if (isComponentSite(node)) {
      const start = node.getStart(sourceFile);
      // Inside JSX children or as a bare attribute value, a call needs braces.
      const braces =
        ts.isJsxElement(node.parent) ||
        ts.isJsxFragment(node.parent) ||
        ts.isJsxAttribute(node.parent);

      sites++;
      inserts.push(
        { at: start, order: 2, text: `${braces ? '{' : ''}${helper}(` },
        { at: node.getEnd(), order: 0, text: `,${start})${braces ? '}' : ''}` },
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  // Directives such as 'use client' must stay first.
  const first = sourceFile.statements.find(
    (statement) =>
      !(ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)),
  );

  inserts.push({
    at: first ? first.getStart(sourceFile) : text.length,
    order: 1,
    text: prelude(options.path, fileHash(text), sites ? helper : null),
  });
  inserts.sort((a, b) => a.at - b.at || a.order - b.order);

  let code = '';
  let position = 0;

  for (const insert of inserts) {
    code += text.slice(position, insert.at) + insert.text;
    position = insert.at;
  }

  // No line is added, so line numbers in errors and stack traces are unchanged.
  return { code: code + text.slice(position), sites };
}

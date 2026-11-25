import type {
  DeriveHow,
  Flow,
  Origin,
  Phase,
  ReportComponent,
  ReportSite,
  SiteAttribute,
  SourceReport,
  Span,
  SpreadSource,
  UnknownReason,
  UseHow,
} from '../../src/source-trace/report.ts';
import ts from 'typescript';
import { resolve } from 'node:path';
import { REPORT_FORMAT, REPORT_VERSION, siteId } from '../../src/source-trace/report.ts';
import {
  type JsxSiteNode,
  fileHash,
  isComponentSite,
  isComponentTag,
  openingOf,
  projectPath,
} from './shared.ts';

// A binding-aware pass over function components. For every component it
// records what the code does with each incoming prop, and for every JSX element
// that renders a component it records where each attribute's value came from.
//
// The pass prefers "unknown" to a guess. A props object that reaches a call, a
// spread whose keys cannot be listed, a component chosen at runtime, and an
// implementation outside the analyzed files are all recorded as boundaries, so
// that "unused" and "no consumer" are only reported when every path is closed.

export interface AnalyzeOptions {
  /** Paths in the report are relative to this directory. */
  root: string;
  /** The files to analyze. Imports that resolve outside this list stay unknown. */
  files: string[];
  label?: string;
  /** Optional TypeScript config for resolving project imports. */
  tsconfig?: string;
}

type FunctionNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

type Alias =
  | { type: 'value'; key: string }
  | { type: 'object'; exclude: string[] }
  | { type: 'derived'; keys: string[]; how: 'item' | 'projection' | 'transform' };

type Resolution =
  | { fn: FunctionNode; wrappers: string[]; comparator?: ts.Node }
  | { reason: UnknownReason; detail: string };

type Outcome =
  | {
      type: 'forward' | 'derive';
      element: JsxSiteNode;
      attr: string;
      via: 'attribute' | 'spread' | 'children';
      how: DeriveHow;
      conditional: boolean;
      at: ts.Node;
    }
  | { type: 'use'; how: UseHow; detail: string; through?: string; at: ts.Node; phase?: Phase }
  | { type: 'alias'; name: ts.Identifier }
  | { type: 'binding'; name: ts.Identifier; projection: boolean; at: ts.Node }
  | { type: 'destructure'; pattern: ts.BindingPattern; at: ts.Node }
  | { type: 'iterate'; call: ts.CallExpression; method: string };

const ITERATORS = new Set([
  'map',
  'flatMap',
  'forEach',
  'filter',
  'find',
  'findLast',
  'findIndex',
  'some',
  'every',
  'reduce',
  'reduceRight',
]);
const EFFECT_HOOKS = new Set(['useEffect', 'useLayoutEffect', 'useInsertionEffect']);
const RENDER_HOOKS = new Set(['useMemo', 'useState', 'useReducer']);
const BUILTINS = new Set(['Fragment', 'StrictMode', 'Suspense', 'Profiler', 'Activity']);
const PHASE_ORDER: Record<Phase, number> = { render: 0, closure: 1, effect: 2, event: 3 };

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function isTransparent(node: ts.Node) {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  );
}

/** A default value that cannot run code when it is evaluated. */
function inert(expression: ts.Expression): boolean {
  const target = unwrap(expression);

  if (ts.isArrayLiteralExpression(target)) {
    return target.elements.every((element) => !ts.isSpreadElement(element) && inert(element));
  }

  if (ts.isObjectLiteralExpression(target)) {
    return target.properties.every(
      (property) =>
        ts.isPropertyAssignment(property) &&
        !ts.isComputedPropertyName(property.name) &&
        inert(property.initializer),
    );
  }

  return (
    ts.isLiteralExpression(target) ||
    ts.isArrowFunction(target) ||
    ts.isFunctionExpression(target) ||
    target.kind === ts.SyntaxKind.TrueKeyword ||
    target.kind === ts.SyntaxKind.FalseKeyword ||
    target.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(target) && target.text === 'undefined') ||
    (ts.isPrefixUnaryExpression(target) && ts.isNumericLiteral(target.operand))
  );
}

function propsParameter(fn: FunctionNode) {
  // TypeScript erases a leading `this` parameter before React calls the component.
  return fn.parameters.find(
    (param) => !(ts.isIdentifier(param.name) && param.name.text === 'this'),
  );
}

function isFunctionNode(node: ts.Node): node is FunctionNode {
  return (
    ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
  );
}

function callee(call: ts.CallExpression | ts.NewExpression) {
  const expression = unwrap(call.expression);

  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  return '';
}

function shorten(text: string, limit = 60) {
  const flat = text.replace(/\s+/g, ' ');

  return flat.length > limit ? flat.slice(0, limit - 1) + '…' : flat;
}

function propertyKey(name: ts.PropertyName | undefined) {
  if (!name) {
    return null;
  }

  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return null;
}

function meaningfulChildren(element: ts.JsxElement | ts.JsxFragment) {
  return element.children.filter(
    (child) =>
      !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces) &&
      !(ts.isJsxExpression(child) && !child.expression),
  );
}

// Only import-resolution settings are copied from the app's compilerOptions.
// Locate the option in its own config file so this also works for inherited
// settings, without depending on TypeScript's diagnostic codes or wording.
function isIgnoredCompilerOption({ file, start }: ts.Diagnostic) {
  const statement = file?.statements[0];
  if (
    !statement ||
    start === undefined ||
    !ts.isExpressionStatement(statement) ||
    !ts.isObjectLiteralExpression(statement.expression)
  ) {
    return false;
  }

  for (const field of statement.expression.properties) {
    if (
      !ts.isPropertyAssignment(field) ||
      !ts.isStringLiteral(field.name) ||
      field.name.text !== 'compilerOptions' ||
      !ts.isObjectLiteralExpression(field.initializer)
    ) {
      continue;
    }
    return field.initializer.properties.some(
      (option) =>
        ts.isPropertyAssignment(option) &&
        ts.isStringLiteral(option.name) &&
        option.getStart(file) <= start &&
        start < option.end &&
        !['baseUrl', 'paths', 'rootDirs'].includes(option.name.text),
    );
  }
  return false;
}

export function analyzeSources(options: AnalyzeOptions): SourceReport {
  const root = resolve(options.root);
  const rootNames = options.files.map((file) => resolve(file));
  const configPath = options.tsconfig
    ? resolve(options.tsconfig)
    : ts.findConfigFile(root, ts.sys.fileExists);
  let resolverOptions: ts.CompilerOptions = {};
  if (configPath) {
    const message = (diagnostic: ts.Diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    const config = ts.getParsedCommandLineOfConfigFile(
      configPath,
      {},
      {
        ...ts.sys,
        // Only the explicit analysis inputs become roots.
        readDirectory: () => [],
        onUnRecoverableConfigFileDiagnostic(diagnostic) {
          throw new Error(message(diagnostic));
        },
      },
    );
    const error = config?.errors.find(
      (diagnostic) =>
        diagnostic.code !== 18003 &&
        diagnostic.code !== 18002 &&
        !isIgnoredCompilerOption(diagnostic),
    );
    if (error) {
      throw new Error(message(error));
    }
    if (config) {
      const { baseUrl, paths, pathsBasePath, rootDirs } = config.options;
      resolverOptions = { baseUrl, paths, pathsBasePath, rootDirs };
    }
  }
  const program = ts.createProgram({
    rootNames,
    options: {
      ...resolverOptions,
      allowJs: true,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
      noEmit: true,
      noLib: true,
      types: [],
      skipLibCheck: true,
    },
  });
  const checker = program.getTypeChecker();
  const analyzed = new Map<ts.SourceFile, number>();
  const files: SourceReport['files'] = [];
  const notes: string[] = [];

  for (const name of rootNames) {
    const sourceFile = program.getSourceFile(name);

    if (!sourceFile) {
      notes.push(`${projectPath(root, name)} could not be read and was skipped.`);
      continue;
    }

    if (!analyzed.has(sourceFile)) {
      analyzed.set(sourceFile, files.length);
      files.push({ path: projectPath(root, name), hash: fileHash(sourceFile.text) });
    }
  }

  function span(node: ts.Node): Span {
    const sourceFile = node.getSourceFile();
    const start = node.getStart(sourceFile);
    const position = sourceFile.getLineAndCharacterOfPosition(start);
    const lineStart = sourceFile.getLineStarts()[position.line];
    const nextLine = sourceFile.getLineStarts()[position.line + 1] ?? sourceFile.text.length + 1;
    const line = sourceFile.text.slice(lineStart, nextLine).replace(/[\r\n]+$/, '');
    const indent = line.length - line.trimStart().length;
    const text = line.slice(indent, indent + 240);
    const from = Math.min(position.character - indent, text.length);
    const to = Math.max(from, Math.min(node.getEnd() - lineStart - indent, text.length));

    return {
      file: analyzed.get(sourceFile) ?? 0,
      line: position.line + 1,
      column: position.character + 1,
      text,
      mark: [from, to],
    };
  }

  function symbolOf(identifier: ts.Identifier) {
    const parent = identifier.parent;

    if (ts.isShorthandPropertyAssignment(parent) && parent.name === identifier) {
      return checker.getShorthandAssignmentValueSymbol(parent);
    }

    return checker.getSymbolAtLocation(identifier);
  }

  // While one tag is being resolved: the analyzed files whose declarations
  // were read, and the first file on the way that was not analyzed.
  let consulted: Set<number> | null = null;
  let unanalyzed: string | null = null;

  const note = (sourceFile: ts.SourceFile) => {
    const file = analyzed.get(sourceFile);

    if (file !== undefined) {
      consulted?.add(file);
    } else if (consulted) {
      unanalyzed ??= projectPath(root, sourceFile.fileName);
    }
  };

  /** Notes every module that takes part in exporting `name` from `module`. */
  function noteExport(specifier: ts.Expression, name: string, depth = 0) {
    const moduleFile = checker
      .getSymbolAtLocation(specifier)
      ?.declarations?.find((declaration) => ts.isSourceFile(declaration));

    if (!moduleFile || !ts.isSourceFile(moduleFile) || depth > 20) {
      return;
    }

    note(moduleFile);

    for (const statement of moduleFile.statements) {
      if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier) {
        continue;
      }

      if (!statement.exportClause) {
        // `export * from`: followed only where it provides the name.
        const target = checker.getSymbolAtLocation(statement.moduleSpecifier);

        if (target && checker.getExportsOfModule(target).some((entry) => entry.name === name)) {
          noteExport(statement.moduleSpecifier, name, depth + 1);
        }
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (element.name.text === name) {
            noteExport(
              statement.moduleSpecifier,
              (element.propertyName ?? element.name).text,
              depth + 1,
            );
          }
        }
      }
    }
  }

  function resolvedSymbol(identifier: ts.Identifier) {
    let symbol = symbolOf(identifier);

    // Step through imports and re-exports one at a time, so that a barrel file
    // between the element and the component is part of the recorded path.
    for (let depth = 0; symbol && symbol.flags & ts.SymbolFlags.Alias && depth < 40; depth++) {
      for (const declaration of consulted ? (symbol.declarations ?? []) : []) {
        const statement = ts.findAncestor(
          declaration,
          (node): node is ts.ImportDeclaration | ts.ExportDeclaration =>
            ts.isImportDeclaration(node) || ts.isExportDeclaration(node),
        );

        note(declaration.getSourceFile());

        if (statement?.moduleSpecifier) {
          noteExport(
            statement.moduleSpecifier,
            ts.isImportSpecifier(declaration) || ts.isExportSpecifier(declaration)
              ? (declaration.propertyName ?? declaration.name).text
              : ts.isImportClause(declaration)
                ? 'default'
                : '',
          );
        }
      }

      let next: ts.Symbol | undefined;

      try {
        next = checker.getImmediateAliasedSymbol(symbol);
      } catch {
        return undefined;
      }

      if (!next || next === symbol) {
        break;
      }

      symbol = next;
    }

    return symbol && symbol.flags & ts.SymbolFlags.Alias ? undefined : symbol;
  }

  function declarationOf(identifier: ts.Identifier) {
    const symbol = resolvedSymbol(identifier);

    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  }

  // Every binding that is written after its declaration. A reassigned binding
  // does not reliably hold what it was declared with, so nothing is resolved
  // or followed through one.
  const assigned = new Set<ts.Symbol>();

  const markAssigned = (target: ts.Node) => {
    let node = target;

    while (isTransparent(node)) {
      node = (node as ts.ParenthesizedExpression).expression;
    }

    if (ts.isIdentifier(node)) {
      const symbol = symbolOf(node);

      if (symbol) {
        assigned.add(symbol);
      }
    } else if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach((element) =>
        markAssigned(ts.isSpreadElement(element) ? element.expression : element),
      );
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          markAssigned(property.name);
        } else if (ts.isPropertyAssignment(property)) {
          markAssigned(property.initializer);
        } else if (ts.isSpreadAssignment(property)) {
          markAssigned(property.expression);
        }
      }
    } else if (ts.isBinaryExpression(node)) {
      // A default inside a destructuring assignment: `[a = 1] = value`.
      markAssigned(node.left);
    }
  };

  for (const sourceFile of analyzed.keys()) {
    const visit = (node: ts.Node) => {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        markAssigned(node.left);
      } else if (
        (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken)
      ) {
        markAssigned(node.operand);
      } else if (
        (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
        !ts.isVariableDeclarationList(node.initializer)
      ) {
        markAssigned(node.initializer);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  // ---- Components ----------------------------------------------------------

  const components = new Map<FunctionNode, ReportComponent>();
  const aliasesByComponent = new Map<FunctionNode, Map<ts.Symbol, Alias>>();
  const usedIds = new Set<string>();

  function register(fn: FunctionNode, name: string, wrappers: string[]) {
    const existing = components.get(fn);

    if (existing) {
      return existing;
    }

    const sourceFile = fn.getSourceFile();
    const path = files[analyzed.get(sourceFile)!].path;
    let id = `${path}#${name}`;

    if (usedIds.has(id)) {
      id += `@${fn.getStart(sourceFile)}`;
    }

    usedIds.add(id);

    const head = ts.isFunctionDeclaration(fn) && fn.name ? fn.name : fn;
    const parameter = propsParameter(fn);
    const record: ReportComponent = {
      id,
      name,
      span: span(
        !ts.isFunctionDeclaration(fn) &&
          ts.isVariableDeclaration(fn.parent) &&
          ts.isIdentifier(fn.parent.name)
          ? fn.parent.name
          : head,
      ),
      params: !parameter
        ? 'none'
        : ts.isObjectBindingPattern(parameter.name)
          ? 'destructured'
          : 'object',
      wrappers,
      props: {},
      objects: [],
    };

    components.set(fn, record);

    return record;
  }

  function isLibrary(expression: ts.Expression) {
    const target = unwrap(expression);
    const identifier = ts.isPropertyAccessExpression(target) ? target.name : target;

    if (!ts.isIdentifier(identifier)) {
      return false;
    }

    // Looking up `memo` itself is not a step on the component's path.
    const path = consulted;

    consulted = null;

    const declaration = declarationOf(identifier);

    consulted = path;

    return !declaration || !analyzed.has(declaration.getSourceFile());
  }

  function resolveInitializer(expression: ts.Expression, depth: number): Resolution {
    const target = unwrap(expression);

    if (depth > 8) {
      return { reason: 'dynamic-component', detail: 'The component alias chain is too long.' };
    }

    if (ts.isArrowFunction(target) || ts.isFunctionExpression(target)) {
      return { fn: target, wrappers: [] };
    }

    if (ts.isIdentifier(target)) {
      return resolveIdentifier(target, depth + 1);
    }

    if (ts.isCallExpression(target)) {
      const name = callee(target);

      if ((name === 'memo' || name === 'forwardRef') && isLibrary(target.expression)) {
        const inner = target.arguments[0];

        if (!inner) {
          return { reason: 'wrapper', detail: `${name}() is called without a component.` };
        }

        const resolved = resolveInitializer(inner, depth + 1);

        if (!('fn' in resolved)) {
          return resolved;
        }

        return {
          fn: resolved.fn,
          wrappers: [name, ...resolved.wrappers],
          comparator: (name === 'memo' ? target.arguments[1] : undefined) ?? resolved.comparator,
        };
      }

      if (name === 'lazy') {
        return { reason: 'lazy', detail: 'The component is loaded with lazy().' };
      }

      return {
        reason: 'wrapper',
        detail: `The component is produced by ${shorten(target.expression.getText(), 40)}(…), which is not followed.`,
      };
    }

    return {
      reason: 'dynamic-component',
      detail: `The component is chosen by an expression: ${shorten(target.getText())}`,
    };
  }

  function resolveIdentifier(identifier: ts.Identifier, depth = 0): Resolution {
    const symbol = resolvedSymbol(identifier);
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    const name = identifier.text;

    if (!symbol || !declaration) {
      return {
        reason: 'no-source',
        detail: `${name} could not be resolved to a declaration in the analyzed files.`,
      };
    }

    if (!analyzed.has(declaration.getSourceFile())) {
      return {
        reason: 'no-source',
        detail: `${name} is implemented outside the analyzed files.`,
      };
    }

    note(declaration.getSourceFile());

    if (assigned.has(symbol)) {
      return {
        reason: 'dynamic-component',
        detail: `${name} is reassigned, so the component it holds is only known at runtime.`,
      };
    }

    if (ts.isFunctionDeclaration(declaration)) {
      return declaration.body
        ? { fn: declaration, wrappers: [] }
        : { reason: 'no-source', detail: `${name} is declared without an implementation.` };
    }

    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      // `let` and `var` bindings can be written from code that is not analyzed.
      if (!(declaration.parent.flags & ts.NodeFlags.Const)) {
        return {
          reason: 'dynamic-component',
          detail: `${name} is not declared with const, so the component it holds is only known at runtime.`,
        };
      }

      return resolveInitializer(declaration.initializer, depth);
    }

    if (ts.isExportAssignment(declaration)) {
      return resolveInitializer(declaration.expression, depth);
    }

    if (ts.isClassDeclaration(declaration)) {
      return {
        reason: 'class-component',
        detail: `${name} is a class component. Classes are not analyzed.`,
      };
    }

    return {
      reason: 'dynamic-component',
      detail: `${name} is a component chosen at runtime.`,
    };
  }

  function resolveTag(tag: ts.JsxTagNameExpression): Resolution {
    const text = tag.getText();
    const last = text.split('.').pop()!;

    if (ts.isIdentifier(tag)) {
      const resolved = resolveIdentifier(tag);

      if (!('fn' in resolved) && resolved.reason === 'no-source' && BUILTINS.has(last)) {
        return { reason: 'react-builtin', detail: `${text} is a React built-in.` };
      }

      return resolved;
    }

    if (BUILTINS.has(last) && isLibrary(tag as ts.Expression)) {
      return { reason: 'react-builtin', detail: `${text} is a React built-in.` };
    }

    return {
      reason: last === 'Provider' ? 'no-source' : 'dynamic-component',
      detail:
        last === 'Provider'
          ? `${text} hands its value to context readers, which are not followed.`
          : `${text} is read from an object at runtime.`,
    };
  }

  function candidateName(fn: FunctionNode) {
    if (ts.isFunctionDeclaration(fn)) {
      return fn.name?.text ?? null;
    }

    let node: ts.Node = fn;
    const wrappers: string[] = [];

    while (
      isTransparent(node.parent) ||
      (ts.isCallExpression(node.parent) &&
        node.parent.arguments[0] === node &&
        ['memo', 'forwardRef'].includes(callee(node.parent)))
    ) {
      node = node.parent;

      if (ts.isCallExpression(node)) {
        wrappers.unshift(callee(node));
      }
    }

    if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
      return node.parent.name.text;
    }

    if (ts.isExportAssignment(node.parent)) {
      return ts.isFunctionExpression(fn) && fn.name ? fn.name.text : 'Default';
    }

    return null;
  }

  function wrappersOf(fn: FunctionNode) {
    const wrappers: string[] = [];

    for (let node: ts.Node = fn; node.parent; node = node.parent) {
      if (isTransparent(node.parent)) {
        continue;
      }

      if (
        ts.isCallExpression(node.parent) &&
        node.parent.arguments[0] === node &&
        ['memo', 'forwardRef'].includes(callee(node.parent))
      ) {
        wrappers.unshift(callee(node.parent));
        continue;
      }

      break;
    }

    return wrappers;
  }

  // Register every capitalized function first so that ids are stable and each
  // JSX element can name the component whose code creates it.
  for (const sourceFile of analyzed.keys()) {
    const visit = (node: ts.Node) => {
      if (isFunctionNode(node) && node.body) {
        const name = candidateName(node);

        if (name && /^[A-Z]/.test(name)) {
          register(node, name, wrappersOf(node));
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  function owningComponent(node: ts.Node) {
    for (let current = node.parent; current; current = current.parent) {
      if (isFunctionNode(current) && components.has(current)) {
        return current;
      }
    }

    return null;
  }

  // ---- Sites ---------------------------------------------------------------

  const siteNodes: JsxSiteNode[] = [];
  const siteIds = new Map<JsxSiteNode, string>();

  for (const [sourceFile, index] of analyzed) {
    const visit = (node: ts.Node) => {
      if (isComponentSite(node)) {
        siteNodes.push(node);
        siteIds.set(node, siteId(files[index].path, node.getStart(sourceFile)));
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  function elementOf(attribute: ts.JsxAttribute | ts.JsxSpreadAttribute) {
    const opening = attribute.parent.parent;

    return ts.isJsxOpeningElement(opening) ? opening.parent : opening;
  }

  /** Host elements, fragments and React built-ins render what they are given. */
  function rendersDirectly(element: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment) {
    if (ts.isJsxFragment(element)) {
      return true;
    }

    const tag = openingOf(element).tagName;

    if (!isComponentTag(tag)) {
      return true;
    }

    const resolved = resolveTag(tag);

    return !('fn' in resolved) && resolved.reason === 'react-builtin';
  }

  function tagText(element: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment) {
    return ts.isJsxFragment(element) ? '<>' : `<${openingOf(element).tagName.getText()}>`;
  }

  // ---- One component -------------------------------------------------------

  function analyzeComponent(fn: FunctionNode, component: ReportComponent) {
    const aliases = new Map<ts.Symbol, Alias>();
    const references = new Map<ts.Symbol, ts.Identifier[]>();
    const queue: ts.Symbol[] = [];

    aliasesByComponent.set(fn, aliases);

    const emit = (key: string, flow: Flow) => {
      // Own data properties only: a prop may be named `constructor`.
      if (!Object.hasOwn(component.props, key)) {
        component.props[key] = [];
      }

      component.props[key].push(flow);
    };

    const addAlias = (name: ts.Identifier, alias: Alias) => {
      const symbol = checker.getSymbolAtLocation(name);

      if (!symbol || aliases.has(symbol)) {
        return;
      }

      aliases.set(symbol, alias);

      // After a write, a read of the binding is no longer a read of the prop.
      // Its references are not followed: the only finding is the boundary.
      if (assigned.has(symbol) && alias.type !== 'derived') {
        const flow: Flow = {
          kind: 'unknown',
          reason: 'reassigned',
          detail: `${name.text} is reassigned in ${component.name}, so reads of it may not be the prop.`,
          span: span(name),
        };

        if (alias.type === 'value') {
          emit(alias.key, flow);
        } else {
          component.objects.push({ exclude: alias.exclude, flow });
        }

        return;
      }

      queue.push(symbol);
    };

    const collect = (node: ts.Node) => {
      if (ts.isTypeNode(node)) {
        return;
      }

      if (ts.isIdentifier(node)) {
        const parent = node.parent;
        const isName =
          (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
          (ts.isPropertyAssignment(parent) && parent.name === node) ||
          (ts.isJsxAttribute(parent) && parent.name === node) ||
          (ts.isBindingElement(parent) && (parent.propertyName === node || parent.name === node)) ||
          ((ts.isVariableDeclaration(parent) ||
            ts.isParameter(parent) ||
            ts.isFunctionDeclaration(parent) ||
            ts.isFunctionExpression(parent)) &&
            parent.name === node) ||
          ts.isJsxClosingElement(parent);

        if (!isName) {
          const symbol = symbolOf(node);

          if (symbol) {
            const list = references.get(symbol);

            list ? list.push(node) : references.set(symbol, [node]);
          }
        }
      }

      ts.forEachChild(node, collect);
    };

    collect(fn);

    const enclosing = (node: ts.Node) => {
      for (let current = node.parent; current; current = current.parent) {
        if (isFunctionNode(current) || ts.isMethodDeclaration(current)) {
          return current;
        }
      }

      return fn;
    };

    function bindingPhase(name: ts.Identifier, seen: Set<ts.Node>): Phase {
      const symbol = checker.getSymbolAtLocation(name);
      const uses = (symbol && references.get(symbol)) || [];
      const phases: Phase[] = [];

      for (const use of uses) {
        let node: ts.Node = use;

        while (isTransparent(node.parent)) {
          node = node.parent;
        }

        const parent = node.parent;

        if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) {
          phases.push(/^on[A-Z]/.test(parent.parent.name.getText()) ? 'event' : 'closure');
        } else if (ts.isCallExpression(parent) && parent.expression === node) {
          phases.push(phaseOf(parent, seen));
        } else if (ts.isCallExpression(parent) && EFFECT_HOOKS.has(callee(parent))) {
          phases.push('effect');
        } else if (
          ts.isArrayLiteralExpression(parent) &&
          ts.isCallExpression(parent.parent) &&
          /^use[A-Z]/.test(callee(parent.parent))
        ) {
          continue;
        } else {
          phases.push('closure');
        }
      }

      if (!phases.length) {
        return 'closure';
      }

      if (phases.includes('render')) {
        return 'render';
      }

      return phases.every((phase) => phase === 'event')
        ? 'event'
        : phases.every((phase) => phase === 'effect')
          ? 'effect'
          : 'closure';
    }

    function functionPhase(nested: ts.Node, seen: Set<ts.Node>): Phase {
      if (seen.has(nested)) {
        return 'closure';
      }

      seen.add(nested);

      if (ts.isFunctionDeclaration(nested)) {
        return nested.name ? bindingPhase(nested.name, seen) : 'closure';
      }

      let node = nested;

      while (isTransparent(node.parent)) {
        node = node.parent;
      }

      const parent = node.parent;

      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
        return bindingPhase(parent.name, seen);
      }

      if (ts.isJsxExpression(parent)) {
        return ts.isJsxAttribute(parent.parent) && /^on[A-Z]/.test(parent.parent.name.getText())
          ? 'event'
          : 'closure';
      }

      if (ts.isCallExpression(parent) && parent.expression !== node) {
        const name = callee(parent);

        if (EFFECT_HOOKS.has(name)) {
          return 'effect';
        }

        if (RENDER_HOOKS.has(name) || ITERATORS.has(name)) {
          return 'render';
        }

        if (name === 'useCallback') {
          let call: ts.Node = parent;

          while (isTransparent(call.parent)) {
            call = call.parent;
          }

          return ts.isVariableDeclaration(call.parent) && ts.isIdentifier(call.parent.name)
            ? bindingPhase(call.parent.name, seen)
            : 'closure';
        }
      }

      return 'closure';
    }

    function phaseOf(node: ts.Node, seen = new Set<ts.Node>()): Phase {
      let phase: Phase = 'render';

      for (let current = enclosing(node); current !== fn; current = enclosing(current)) {
        const next = functionPhase(current, seen);

        if (PHASE_ORDER[next] > PHASE_ORDER[phase]) {
          phase = next;
        }
      }

      return phase;
    }

    /**
     * Follows one expression outward to the place its value ends up.
     * `direct` stays true while the value is unchanged; `projection` while the
     * only operations were property reads.
     */
    function walk(start: ts.Node, source: 'value' | 'item' | 'projection' | 'transform'): Outcome {
      let current = start;
      let direct = true;
      let projection = source !== 'transform';
      let conditional = false;
      let through = '';

      const how = (): DeriveHow =>
        direct && source === 'item' ? 'item' : projection ? 'projection' : 'transform';
      const use = (
        kind: UseHow,
        detail: string,
        at: ts.Node = current,
        phase?: Phase,
      ): Outcome => ({
        type: 'use',
        how: kind,
        detail: through && kind !== 'call-argument' ? `${detail}, through ${through}()` : detail,
        ...(through ? { through } : {}),
        at,
        phase,
      });
      const changed = (isProjection = false) => {
        direct = false;
        projection &&= isProjection;
      };

      for (;;) {
        const parent = current.parent;

        if (isTransparent(parent)) {
          current = parent;
          continue;
        }

        if (
          (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) &&
          parent.tagName === current
        ) {
          return use('render', `rendered as the component <${current.getText()}>`, parent);
        }

        if (ts.isPropertyAccessExpression(parent) && parent.expression === current) {
          const outer = parent.parent;

          if (ts.isCallExpression(outer) && outer.expression === parent) {
            if (ITERATORS.has(parent.name.text)) {
              return { type: 'iterate', call: outer, method: parent.name.text };
            }

            changed();
            through ||= parent.name.text;
            current = outer;
            continue;
          }

          changed(true);
          current = parent;
          continue;
        }

        if (ts.isElementAccessExpression(parent)) {
          changed(parent.expression === current);
          current = parent;
          continue;
        }

        if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
          if (parent.expression === current) {
            return use(
              'call',
              direct ? 'called' : `${shorten(current.getText(), 40)} is called`,
              parent,
            );
          }

          const name = callee(parent);

          if (/^use[A-Z0-9]/.test(name)) {
            return use('hook', `passed to ${name}()`, parent);
          }

          changed();
          through ||= name || 'a function';
          current = parent;
          continue;
        }

        if (ts.isSpreadElement(parent) || ts.isAwaitExpression(parent)) {
          changed();
          current = parent;
          continue;
        }

        if (ts.isArrayLiteralExpression(parent)) {
          const outer = parent.parent;

          if (
            ts.isCallExpression(outer) &&
            outer.arguments.indexOf(parent) > 0 &&
            /^use[A-Z0-9]/.test(callee(outer))
          ) {
            return use('hook-dependency', `listed as a dependency of ${callee(outer)}()`, parent);
          }

          changed();
          current = parent;
          continue;
        }

        if (
          (ts.isPropertyAssignment(parent) && parent.initializer === current) ||
          ts.isShorthandPropertyAssignment(parent) ||
          ts.isSpreadAssignment(parent)
        ) {
          changed();
          current = parent.parent;
          continue;
        }

        if (ts.isConditionalExpression(parent)) {
          if (parent.condition === current) {
            return use('condition', 'decides which branch renders');
          }

          conditional = true;
          current = parent;
          continue;
        }

        if (ts.isBinaryExpression(parent)) {
          const operator = parent.operatorToken.kind;

          if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
            if (parent.left === current) {
              return use('condition', 'decides whether the right-hand side is used');
            }

            conditional = true;
            current = parent;
            continue;
          }

          if (
            operator === ts.SyntaxKind.BarBarToken ||
            operator === ts.SyntaxKind.QuestionQuestionToken
          ) {
            if (parent.left === current) {
              changed();
            } else {
              conditional = true;
            }

            current = parent;
            continue;
          }

          if (
            operator >= ts.SyntaxKind.FirstAssignment &&
            operator <= ts.SyntaxKind.LastAssignment
          ) {
            return parent.right === current
              ? use('assigned', `assigned to ${shorten(parent.left.getText(), 40)}`, parent)
              : use('expression', 'written to', parent);
          }

          if (operator === ts.SyntaxKind.CommaToken && parent.right === current) {
            current = parent;
            continue;
          }

          changed();
          current = parent;
          continue;
        }

        if (
          ts.isPrefixUnaryExpression(parent) ||
          ts.isPostfixUnaryExpression(parent) ||
          ts.isTypeOfExpression(parent) ||
          ts.isVoidExpression(parent) ||
          ts.isTemplateExpression(parent) ||
          ts.isTaggedTemplateExpression(parent)
        ) {
          changed();
          current = parent;
          continue;
        }

        if (ts.isTemplateSpan(parent)) {
          changed();
          current = parent.parent;
          continue;
        }

        if (ts.isJsxSpreadAttribute(parent)) {
          const element = elementOf(parent);

          if (rendersDirectly(element)) {
            return use('host-prop', `spread onto ${tagText(element)}`, parent);
          }

          return {
            type: 'derive',
            element,
            attr: '*',
            via: 'spread',
            how: 'spread',
            conditional,
            at: parent,
          };
        }

        if (ts.isJsxExpression(parent)) {
          const outer = parent.parent;

          if (ts.isJsxAttribute(outer)) {
            const element = elementOf(outer);
            const name = outer.name.getText();

            if (name === 'key') {
              return use('key', 'used as the React key', outer);
            }

            if (rendersDirectly(element)) {
              return direct && /^on[A-Z]/.test(name)
                ? use(
                    'host-handler',
                    `set as the ${name} handler of ${tagText(element)}`,
                    outer,
                    'event',
                  )
                : use('host-prop', `sets ${name} on ${tagText(element)}`, outer);
            }

            return {
              type: direct && source === 'value' ? 'forward' : 'derive',
              element,
              attr: name,
              via: 'attribute',
              how: how(),
              conditional,
              at: outer,
            };
          }

          if (ts.isJsxElement(outer) || ts.isJsxFragment(outer)) {
            if (rendersDirectly(outer)) {
              return use('render', `rendered inside ${tagText(outer)}`, parent);
            }

            const only = meaningfulChildren(outer).length === 1;

            return {
              type: direct && only && source === 'value' ? 'forward' : 'derive',
              element: outer as ts.JsxElement,
              attr: 'children',
              via: 'children',
              how: only ? how() : 'transform',
              conditional,
              at: parent,
            };
          }

          return use('expression', 'read');
        }

        if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
          const constant = (parent.parent.flags & ts.NodeFlags.Const) !== 0;

          if (!ts.isIdentifier(parent.name)) {
            return { type: 'destructure', pattern: parent.name, at: parent };
          }

          return direct && !conditional && constant
            ? { type: 'alias', name: parent.name }
            : { type: 'binding', name: parent.name, projection: projection && !direct, at: parent };
        }

        if (
          ts.isReturnStatement(parent) ||
          (ts.isArrowFunction(parent) && parent.body === current)
        ) {
          if (enclosing(current) === fn) {
            return use('render', 'returned as the render output');
          }

          return through
            ? use('call-argument', `passed to ${through}()`)
            : use('return', 'returned from a callback');
        }

        if (
          (ts.isIfStatement(parent) ||
            ts.isWhileStatement(parent) ||
            ts.isDoStatement(parent) ||
            ts.isSwitchStatement(parent)) &&
          parent.expression === current
        ) {
          return use('condition', 'decides which branch runs');
        }

        if (ts.isForOfStatement(parent) && parent.expression === current) {
          return use('iterated', 'iterated with for…of');
        }

        if (ts.isExpressionStatement(parent)) {
          return through
            ? use('call-argument', `passed to ${through}()`)
            : use('expression', 'evaluated');
        }

        return through ? use('call-argument', `passed to ${through}()`) : use('expression', 'read');
      }
    }

    function follow(start: ts.Node, alias: Exclude<Alias, { type: 'object' }>) {
      const keys = alias.type === 'value' ? [alias.key] : alias.keys;
      const outcome = walk(start, alias.type === 'value' ? 'value' : alias.how);
      const each = (flow: Flow) => keys.forEach((key) => emit(key, flow));

      if (outcome.type === 'forward' || outcome.type === 'derive') {
        const site = siteIds.get(outcome.element)!;
        const phase = phaseOf(start);

        each(
          outcome.type === 'forward'
            ? {
                kind: 'forward',
                site,
                attr: outcome.attr,
                via: outcome.via === 'children' ? 'children' : 'attribute',
                ...(outcome.conditional ? { conditional: true } : {}),
                phase,
                span: span(outcome.at),
              }
            : {
                kind: 'derive',
                site,
                attr: outcome.attr,
                how: outcome.how,
                phase,
                span: span(outcome.at),
              },
        );

        return;
      }

      if (outcome.type === 'alias') {
        addAlias(outcome.name, alias);

        return;
      }

      // A value derived from a prop was already counted as a use where it was
      // derived. Only its onward edges are recorded.
      const reportUse = alias.type === 'value';

      if (outcome.type === 'use') {
        if (reportUse) {
          each({
            kind: 'use',
            how: outcome.how,
            detail: outcome.detail,
            ...(outcome.through ? { through: outcome.through } : {}),
            phase: outcome.phase ?? phaseOf(start),
            span: span(outcome.at),
          });
        }

        return;
      }

      if (outcome.type === 'binding') {
        if (reportUse) {
          each({
            kind: 'use',
            how: 'assigned',
            detail: `read into the local ${outcome.name.text}`,
            phase: phaseOf(start),
            span: span(outcome.at),
          });
        }

        addAlias(outcome.name, {
          type: 'derived',
          keys,
          how: outcome.projection ? 'projection' : 'transform',
        });

        return;
      }

      if (outcome.type === 'destructure') {
        if (reportUse) {
          each({
            kind: 'use',
            how: 'destructured',
            detail: 'destructured into locals',
            phase: phaseOf(start),
            span: span(outcome.at),
          });
        }

        for (const element of outcome.pattern.elements) {
          if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
            addAlias(element.name, { type: 'derived', keys, how: 'projection' });
          }
        }

        return;
      }

      if (outcome.type !== 'iterate') {
        return;
      }

      if (reportUse) {
        each({
          kind: 'use',
          how: 'iterated',
          detail: `iterated with .${outcome.method}()`,
          phase: phaseOf(start),
          span: span(outcome.call.expression),
        });
      }

      const callback = outcome.call.arguments[0];
      const item =
        callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
          ? callback.parameters[outcome.method.startsWith('reduce') ? 1 : 0]
          : undefined;

      if (item && ts.isIdentifier(item.name)) {
        addAlias(item.name, { type: 'derived', keys, how: 'item' });
      }
    }

    function bindPattern(pattern: ts.ObjectBindingPattern, base: string[]) {
      const named = [...base];
      const dynamic = pattern.elements.find(
        (element) => element.propertyName && ts.isComputedPropertyName(element.propertyName),
      );

      if (dynamic) {
        component.objects.push({
          exclude: base,
          flow: {
            kind: 'unknown',
            reason: 'dynamic-key',
            detail: 'A prop is read with a computed name.',
            span: span(dynamic),
          },
        });
      }

      for (const element of pattern.elements) {
        if (element.dotDotDotToken) {
          if (ts.isIdentifier(element.name)) {
            addAlias(element.name, { type: 'object', exclude: named });
          }

          continue;
        }

        const key = propertyKey(
          element.propertyName ?? (ts.isIdentifier(element.name) ? element.name : undefined),
        );

        if (key === null || base.includes(key)) {
          continue;
        }

        named.push(key);

        if (!Object.hasOwn(component.props, key)) {
          component.props[key] = [];
        }

        if (element.initializer) {
          component.defaults ??= {};
          component.defaults[key] = {
            span: span(element.initializer),
            effectful: !inert(element.initializer),
          };
        }

        if (ts.isIdentifier(element.name)) {
          addAlias(element.name, { type: 'value', key });
        } else {
          emit(key, {
            kind: 'unknown',
            reason: 'nested-pattern',
            detail:
              'Destructured further where it is received; the inner bindings are not followed.',
            span: span(element),
          });
        }
      }
    }

    function followObject(reference: ts.Identifier, alias: Extract<Alias, { type: 'object' }>) {
      let node: ts.Node = reference;

      while (isTransparent(node.parent)) {
        node = node.parent;
      }

      const parent = node.parent;
      const escape = (detail: string, reason: UnknownReason = 'props-escape') => {
        component.objects.push({
          exclude: alias.exclude,
          flow: { kind: 'unknown', reason, detail, span: span(parent) },
        });
      };

      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        if (!alias.exclude.includes(parent.name.text)) {
          follow(parent, { type: 'value', key: parent.name.text });
        }

        return;
      }

      if (ts.isElementAccessExpression(parent) && parent.expression === node) {
        const argument = unwrap(parent.argumentExpression);

        if (ts.isStringLiteralLike(argument) || ts.isNumericLiteral(argument)) {
          if (!alias.exclude.includes(argument.text)) {
            follow(parent, { type: 'value', key: argument.text });
          }
        } else {
          escape(
            `A prop is read with a computed name: ${shorten(parent.getText())}`,
            'dynamic-key',
          );
        }

        return;
      }

      if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
        if (ts.isObjectBindingPattern(parent.name)) {
          bindPattern(parent.name, alias.exclude);

          return;
        }

        if (ts.isIdentifier(parent.name) && parent.parent.flags & ts.NodeFlags.Const) {
          addAlias(parent.name, alias);

          return;
        }
      }

      if (ts.isJsxSpreadAttribute(parent)) {
        const element = elementOf(parent);

        component.objects.push({
          exclude: alias.exclude,
          flow: rendersDirectly(element)
            ? {
                kind: 'use',
                how: 'host-prop',
                detail: `spread onto ${tagText(element)}`,
                phase: phaseOf(reference),
                span: span(parent),
              }
            : {
                kind: 'forward',
                site: siteIds.get(element)!,
                attr: '*',
                via: 'spread',
                index: parent.parent.properties.indexOf(parent),
                phase: phaseOf(reference),
                span: span(parent),
              },
        });

        return;
      }

      if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
        escape(
          `The whole props object is passed to ${callee(parent) || 'a function'}(), which is not followed.`,
        );
      } else if (ts.isSpreadAssignment(parent) || ts.isSpreadElement(parent)) {
        escape('The whole props object is spread into another value.');
      } else if (
        ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.InKeyword
      ) {
        escape('Prop presence is tested with the in operator.');
      } else if (ts.isForInStatement(parent)) {
        escape('Prop names are enumerated.');
      } else {
        escape(`The whole props object is used as a value: ${shorten(parent.getText())}`);
      }
    }

    // Props can also be reached without naming the parameter. These make
    // every prop of the component unknown.
    const hidden = (node: ts.Node, ownArguments: boolean) => {
      const escape = (detail: string) => {
        component.objects.push({
          exclude: [],
          flow: { kind: 'unknown', reason: 'props-escape', detail, span: span(node) },
        });
      };

      if (
        ownArguments &&
        ts.isIdentifier(node) &&
        node.text === 'arguments' &&
        !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
        !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)
      ) {
        escape('Props can be read through the implicit arguments object.');
      } else if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'eval'
      ) {
        escape('A direct eval() call can read any prop.');
      } else if (ts.isWithStatement(node)) {
        escape('A with statement can read any prop.');
      }

      ts.forEachChild(node, (child) =>
        hidden(
          child,
          ownArguments &&
            !(isFunctionNode(child) && !ts.isArrowFunction(child)) &&
            !ts.isMethodDeclaration(child) &&
            !ts.isAccessor(child) &&
            !ts.isClassLike(child),
        ),
      );
    };

    ts.forEachChild(fn, (child) => hidden(child, !ts.isArrowFunction(fn)));

    const parameter = propsParameter(fn);

    if (parameter && (parameter.dotDotDotToken || ts.isArrayBindingPattern(parameter.name))) {
      // `function Row(...args)` holds props at args[0]; indexing is not followed.
      component.objects.push({
        exclude: [],
        flow: {
          kind: 'unknown',
          reason: 'props-escape',
          detail: parameter.dotDotDotToken
            ? 'Props are received through a rest parameter, which is not followed.'
            : 'The first parameter is destructured as an array, which is not followed.',
          span: span(parameter),
        },
      });
    } else if (parameter && ts.isObjectBindingPattern(parameter.name)) {
      bindPattern(parameter.name, []);
    } else if (parameter && ts.isIdentifier(parameter.name)) {
      addAlias(parameter.name, { type: 'object', exclude: [] });
    }

    while (queue.length) {
      const symbol = queue.shift()!;
      const alias = aliases.get(symbol)!;

      for (const reference of references.get(symbol) ?? []) {
        if (alias.type === 'object') {
          followObject(reference, alias);
        } else {
          follow(reference, alias);
        }
      }
    }
  }

  // Resolve every tag before analyzing bodies: a body needs to know which
  // elements render components, and a target may not look like one by name.
  const resolutions = new Map<JsxSiteNode, Resolution>();
  const consultedFiles = new Map<JsxSiteNode, number[]>();

  for (const node of siteNodes) {
    const tag = openingOf(node).tagName;
    consulted = new Set();
    unanalyzed = null;

    let resolved = resolveTag(tag);

    // A hop through a file that was not analyzed cannot be checked against a build.
    if ('fn' in resolved && unanalyzed) {
      resolved = {
        reason: 'no-source',
        detail: `${tag.getText()} is imported through ${unanalyzed}, which is not among the analyzed files.`,
      };
    }

    resolutions.set(node, resolved);
    consultedFiles.set(node, [...consulted]);
    consulted = null;

    if ('fn' in resolved) {
      register(resolved.fn, candidateName(resolved.fn) ?? tag.getText(), resolved.wrappers);
    }
  }

  for (const [fn, component] of components) {
    analyzeComponent(fn, component);
  }

  // ---- Where each attribute's value comes from -----------------------------

  const noAliases = new Map<ts.Symbol, Alias>();

  function describeLocal(expression: ts.Expression): Origin {
    const target = unwrap(expression);

    if (
      ts.isStringLiteralLike(target) ||
      ts.isNumericLiteral(target) ||
      ts.isBigIntLiteral(target) ||
      target.kind === ts.SyntaxKind.TrueKeyword ||
      target.kind === ts.SyntaxKind.FalseKeyword ||
      target.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isIdentifier(target) && target.text === 'undefined')
    ) {
      return {
        type: 'local',
        what: 'literal',
        detail: `the literal ${shorten(target.getText(), 40)}`,
      };
    }

    if (ts.isArrowFunction(target) || ts.isFunctionExpression(target)) {
      return { type: 'local', what: 'function', detail: 'an inline function created here' };
    }

    if (ts.isJsxElement(target) || ts.isJsxSelfClosingElement(target) || ts.isJsxFragment(target)) {
      return { type: 'local', what: 'jsx', detail: 'JSX created here' };
    }

    if (!ts.isIdentifier(target)) {
      return {
        type: 'local',
        what: 'expression',
        detail: `the expression ${shorten(target.getText())}`,
      };
    }

    const symbol = symbolOf(target);
    const declaration = symbol?.declarations?.[0];

    if (!symbol || !declaration) {
      return {
        type: 'local',
        what: 'expression',
        detail: `${target.text}, which is not declared in the analyzed files`,
      };
    }

    const name = target.text;

    if (symbol.flags & ts.SymbolFlags.Alias) {
      const statement = ts.findAncestor(declaration, ts.isImportDeclaration);
      const module =
        statement && ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : 'another module';

      return {
        type: 'local',
        what: 'import',
        detail: `${name}, imported from ${module}`,
        span: span(declaration),
      };
    }

    const local = !!ts.findAncestor(declaration, isFunctionNode);
    const at = span(
      (ts.isVariableDeclaration(declaration) ||
        ts.isBindingElement(declaration) ||
        ts.isParameter(declaration) ||
        ts.isFunctionDeclaration(declaration)) &&
        declaration.name
        ? declaration.name
        : declaration,
    );

    if (ts.isFunctionDeclaration(declaration)) {
      return {
        type: 'local',
        what: local ? 'function' : 'module',
        detail: local
          ? `the function ${name}, defined in this component`
          : `the module-level function ${name}`,
        span: at,
      };
    }

    if (ts.isParameter(declaration)) {
      return { type: 'local', what: 'param', detail: `${name}, a callback parameter`, span: at };
    }

    const variable = ts.findAncestor(declaration, ts.isVariableDeclaration);

    if (!variable) {
      return { type: 'local', what: 'param', detail: `${name}, a callback parameter`, span: at };
    }

    if (!local) {
      return { type: 'local', what: 'module', detail: `the module-level value ${name}`, span: at };
    }

    const initializer = variable.initializer && unwrap(variable.initializer);

    if (
      initializer &&
      ts.isCallExpression(initializer) &&
      /^use[A-Z0-9]/.test(callee(initializer))
    ) {
      const hook = callee(initializer);

      if (hook === 'useCallback') {
        return {
          type: 'local',
          what: 'function',
          detail: `the function ${name}, created here with useCallback()`,
          span: at,
        };
      }

      return hook === 'useState' || hook === 'useReducer'
        ? {
            type: 'local',
            what: 'state',
            detail: `${name}, from ${hook}() in this component`,
            span: at,
          }
        : { type: 'local', what: 'hook', detail: `${name}, returned by ${hook}()`, span: at };
    }

    if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
      return {
        type: 'local',
        what: 'function',
        detail: `the function ${name}, defined in this component`,
        span: at,
      };
    }

    return { type: 'local', what: 'const', detail: `the local ${name}`, span: at };
  }

  function originOf(expression: ts.Expression, aliases: Map<ts.Symbol, Alias>): Origin {
    const target = unwrap(expression);

    const direct = (node: ts.Expression): string | null => {
      const value = unwrap(node);

      if (ts.isIdentifier(value)) {
        const symbol = symbolOf(value);
        const alias = symbol && aliases.get(symbol);

        return alias?.type === 'value' ? alias.key : null;
      }

      if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(unwrap(value.expression))) {
        const symbol = symbolOf(unwrap(value.expression) as ts.Identifier);
        const alias = symbol && aliases.get(symbol);

        return alias?.type === 'object' && !alias.exclude.includes(value.name.text)
          ? value.name.text
          : null;
      }

      return null;
    };

    const key = direct(target);

    if (key !== null) {
      return { type: 'prop', key };
    }

    if (ts.isConditionalExpression(target)) {
      const branches = [target.whenTrue, target.whenFalse].map(direct);
      const present = branches.filter((branch): branch is string => branch !== null);

      if (present.length === 2 && present[0] === present[1]) {
        return { type: 'prop', key: present[0], conditional: true };
      }

      if (present.length === 1) {
        const other = describeLocal(branches[0] === null ? target.whenTrue : target.whenFalse);

        if (other.type === 'local' && other.what === 'literal') {
          return { type: 'prop', key: present[0], conditional: true };
        }
      }
    }

    const keys = new Set<string>();
    let onlyItem = false;

    const visit = (node: ts.Node) => {
      if (ts.isTypeNode(node)) {
        return;
      }

      if (ts.isIdentifier(node)) {
        const symbol = symbolOf(node);
        const alias = symbol && aliases.get(symbol);

        if (alias?.type === 'value') {
          keys.add(alias.key);
        } else if (alias?.type === 'derived') {
          alias.keys.forEach((name) => keys.add(name));
          onlyItem = node === target && alias.how === 'item';
        } else if (alias?.type === 'object') {
          const parent = node.parent;

          keys.add(
            ts.isPropertyAccessExpression(parent) && parent.expression === node
              ? parent.name.text
              : '*',
          );
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(target);

    if (!keys.size) {
      return describeLocal(target);
    }

    let chain: ts.Expression = target;

    while (ts.isPropertyAccessExpression(chain) || isTransparent(chain)) {
      chain = (chain as ts.PropertyAccessExpression).expression;
    }

    return {
      type: 'derived',
      keys: [...keys],
      how: onlyItem
        ? 'item'
        : ts.isArrowFunction(target) || ts.isFunctionExpression(target)
          ? 'closure'
          : ts.isIdentifier(chain) && chain !== target && !ts.isCallExpression(target)
            ? 'projection'
            : 'transform',
    };
  }

  function spreadSource(expression: ts.Expression, aliases: Map<ts.Symbol, Alias>): SpreadSource {
    const target = unwrap(expression);

    let literal: ts.Expression | undefined = target;
    let valueAlias = false;

    if (ts.isIdentifier(target)) {
      const symbol = symbolOf(target);
      const alias = symbol && aliases.get(symbol);

      if (alias?.type === 'object') {
        return { type: 'props', exclude: alias.exclude };
      }

      valueAlias = !!alias;

      const declaration = symbol?.valueDeclaration;
      literal =
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        declaration.parent.flags & ts.NodeFlags.Const &&
        declaration.initializer
          ? unwrap(declaration.initializer)
          : undefined;
    }

    if (literal && ts.isObjectLiteralExpression(literal)) {
      const keys: Record<string, Span> = Object.create(null);
      const origins: Record<string, Origin> = Object.create(null);
      const owner = owningComponent(literal);
      const sameOwner = !owner || owner === owningComponent(target);
      let listed = true;

      for (const property of literal.properties) {
        const name = ts.isSpreadAssignment(property) ? null : propertyKey(property.name);

        if (name === null) {
          listed = false;
          break;
        }

        keys[name] = span(property);
        delete origins[name];
        const value = ts.isShorthandPropertyAssignment(property)
          ? property.name
          : ts.isPropertyAssignment(property)
            ? property.initializer
            : null;
        if (value && sameOwner) {
          origins[name] = originOf(value, aliases);
        }
      }

      if (listed) {
        return {
          type: 'object',
          name: ts.isIdentifier(target) ? target.text : 'object literal',
          keys: { ...keys },
          origins: { ...origins },
        };
      }
    }

    const origin = originOf(target, aliases);

    return !valueAlias && origin.type === 'local'
      ? {
          type: 'unknown',
          detail: `The keys of ${shorten(target.getText(), 40)} cannot be listed from source.`,
        }
      : { type: 'value', origin };
  }

  function reactDOMExport(expr: ts.Expression): string | null {
    const target = unwrap(expr);
    const receiver = ts.isPropertyAccessExpression(target) ? unwrap(target.expression) : target;
    if (!ts.isIdentifier(receiver)) {
      return null;
    }
    const declaration = symbolOf(receiver)?.declarations?.[0];
    if (!declaration) {
      return null;
    }
    const statement = ts.findAncestor(declaration, ts.isImportDeclaration);
    if (!statement || !ts.isStringLiteral(statement.moduleSpecifier)) {
      return null;
    }
    const module = statement.moduleSpecifier.text;
    if (module !== 'react-dom' && module !== 'react-dom/client') {
      return null;
    }
    if (ts.isImportSpecifier(declaration) && target === receiver) {
      return module + '/' + (declaration.propertyName ?? declaration.name).text;
    }
    if (
      ts.isPropertyAccessExpression(target) &&
      (ts.isNamespaceImport(declaration) || ts.isImportClause(declaration))
    ) {
      return module + '/' + target.name.text;
    }
    return null;
  }

  const localRoots = new Map<ts.Symbol, boolean>();

  function isRootCreation(expr: ts.Expression) {
    return (
      ts.isCallExpression(expr) && reactDOMExport(expr.expression) === 'react-dom/client/createRoot'
    );
  }

  // Storing the root in a local const is common. Only trust its render method
  // if the root stays local and every reference calls a standard root method.
  function isLocalRoot(name: ts.Identifier) {
    const binding = symbolOf(name);
    const decl = binding?.valueDeclaration;
    if (
      !binding ||
      !decl ||
      !ts.isVariableDeclaration(decl) ||
      !decl.initializer ||
      !(decl.parent.flags & ts.NodeFlags.Const) ||
      !isRootCreation(unwrap(decl.initializer))
    ) {
      return false;
    }
    const cached = localRoots.get(binding);
    if (cached !== undefined) {
      return cached;
    }

    const source = decl.getSourceFile();
    const module = checker.getSymbolAtLocation(source);
    const exported =
      module &&
      checker
        .getExportsOfModule(module)
        .some(
          (item) =>
            (item.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(item) : item) === binding,
        );
    const escapes = (node: ts.Node): boolean => {
      if (
        ts.isIdentifier(node) &&
        node !== decl.name &&
        node.text === name.text &&
        symbolOf(node) === binding
      ) {
        const access = node.parent;
        return !(
          ts.isPropertyAccessExpression(access) &&
          access.expression === node &&
          (access.name.text === 'render' || access.name.text === 'unmount') &&
          ts.isCallExpression(access.parent) &&
          access.parent.expression === access
        );
      }
      return !!ts.forEachChild(node, (child) => escapes(child) || undefined);
    };
    const known = !exported && !escapes(source);
    localRoots.set(binding, known);
    return known;
  }

  function rendersArgument(call: ts.CallExpression, element: ts.Node) {
    const target = unwrap(call.expression);
    const renderer = reactDOMExport(target);
    if (renderer === 'react-dom/client/hydrateRoot') {
      return call.arguments[1] === element;
    }
    if (call.arguments[0] !== element) {
      return false;
    }
    if (
      renderer === 'react-dom/createPortal' ||
      renderer === 'react-dom/render' ||
      renderer === 'react-dom/hydrate'
    ) {
      return true;
    }
    if (!ts.isPropertyAccessExpression(target) || target.name.text !== 'render') {
      return false;
    }
    const root = unwrap(target.expression);
    return ts.isIdentifier(root) ? isLocalRoot(root) : isRootCreation(root);
  }

  /** Where an element goes after it is created. Undefined means it is rendered. */
  function placementOf(element: JsxSiteNode): ReportSite['placement'] {
    let current: ts.Node = element;

    const held = (detail: string): ReportSite['placement'] => ({ kind: 'value', detail });
    const inside = (
      container: ts.JsxElement | ts.JsxSelfClosingElement,
      attr: string,
    ): ReportSite['placement'] => ({
      kind: 'component',
      site: siteIds.get(container as JsxSiteNode)!,
      attr,
    });

    for (;;) {
      const parent: ts.Node = current.parent;

      if (isTransparent(parent) || ts.isJsxExpression(parent)) {
        current = parent;
        continue;
      }

      if (ts.isConditionalExpression(parent) && parent.condition !== current) {
        current = parent;
        continue;
      }

      if (
        ts.isBinaryExpression(parent) &&
        [
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(parent.operatorToken.kind)
      ) {
        current = parent;
        continue;
      }

      if (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) {
        if (rendersDirectly(parent)) {
          current = parent;
          continue;
        }

        return inside(parent as ts.JsxElement, 'children');
      }

      if (ts.isJsxAttribute(parent)) {
        const container = elementOf(parent);

        if (!rendersDirectly(container)) {
          return inside(container, parent.name.getText());
        }

        if (isComponentTag(openingOf(container).tagName)) {
          // A React built-in such as <Suspense fallback={…}> renders it.
          current = container;
          continue;
        }

        return held(`set as the ${parent.name.getText()} attribute of ${tagText(container)}`);
      }

      if (
        ts.isArrayLiteralExpression(parent) &&
        ts.isJsxExpression(parent.parent) &&
        (ts.isJsxElement(parent.parent.parent) || ts.isJsxFragment(parent.parent.parent))
      ) {
        current = parent;
        continue;
      }

      if (ts.isReturnStatement(parent) || (ts.isArrowFunction(parent) && parent.body === current)) {
        const fn = ts.findAncestor(parent, isFunctionNode);

        if (!fn || ts.isFunctionDeclaration(fn)) {
          return fn && components.has(fn)
            ? undefined
            : held('returned by a helper whose caller may inspect it');
        }

        let callback: ts.Node = fn;

        while (isTransparent(callback.parent)) {
          callback = callback.parent;
        }

        const call = callback.parent;

        if (
          ts.isCallExpression(call) &&
          call.expression !== callback &&
          ts.isPropertyAccessExpression(call.expression) &&
          ITERATORS.has(call.expression.name.text)
        ) {
          current = call;
          continue;
        }

        // A function written inside a component element is a render prop.
        if (ts.isJsxExpression(call)) {
          const outer = call.parent;

          if (ts.isJsxAttribute(outer) && !rendersDirectly(elementOf(outer))) {
            return inside(elementOf(outer), outer.name.getText());
          }

          if (ts.isJsxElement(outer) && !rendersDirectly(outer)) {
            return inside(outer, 'children');
          }
        }

        return components.has(fn)
          ? undefined
          : held('returned by a callback whose caller may inspect it');
      }

      if (ts.isCallExpression(parent) && parent.expression !== current) {
        const name = callee(parent);

        return rendersArgument(parent, current)
          ? undefined
          : held(`passed to ${name || 'a function'}()`);
      }

      if (ts.isVariableDeclaration(parent)) {
        return held(`assigned to ${shorten(parent.name.getText(), 40)}`);
      }

      return held(`used in ${shorten(parent.getText(), 50)}`);
    }
  }

  const sites: ReportSite[] = [];
  let unresolved = 0;

  for (const node of siteNodes) {
    const opening = openingOf(node);
    const resolved = resolutions.get(node)!;
    const ownerFn = owningComponent(node);
    const aliases = (ownerFn && aliasesByComponent.get(ownerFn)) || noAliases;
    const attributes: SiteAttribute[] = [];

    for (const property of opening.attributes.properties) {
      if (ts.isJsxSpreadAttribute(property)) {
        attributes.push({
          kind: 'spread',
          span: span(property),
          source: spreadSource(property.expression, aliases),
        });
        continue;
      }

      const value = property.initializer;

      attributes.push({
        kind: 'attr',
        name: property.name.getText(),
        span: span(property),
        origin: !value
          ? { type: 'local', what: 'literal', detail: 'the literal true' }
          : ts.isJsxExpression(value)
            ? value.expression
              ? originOf(value.expression, aliases)
              : { type: 'local', what: 'literal', detail: 'an empty expression' }
            : describeLocal(value),
      });
    }

    if (ts.isJsxElement(node)) {
      const children = meaningfulChildren(node);
      const only = children.length === 1 ? children[0] : null;

      if (children.length) {
        attributes.push({
          kind: 'attr',
          name: 'children',
          span: span(children[0]),
          origin:
            only && ts.isJsxExpression(only) && only.expression
              ? originOf(only.expression, aliases)
              : { type: 'local', what: 'jsx', detail: 'JSX children written here' },
        });
      }
    }

    const helper = ownerFn ? null : ts.findAncestor(node.parent, isFunctionNode);
    // The files read to resolve the tag, other than the element's own.
    const via = (consultedFiles.get(node) ?? []).filter(
      (file) => file !== analyzed.get(node.getSourceFile()),
    );

    if (!('fn' in resolved) && resolved.reason !== 'react-builtin') {
      unresolved++;
    }

    sites.push({
      id: siteIds.get(node)!,
      tag: opening.tagName.getText(),
      span: span(opening),
      target: 'fn' in resolved ? components.get(resolved.fn)!.id : null,
      ...('fn' in resolved
        ? {}
        : { unresolved: { reason: resolved.reason, detail: resolved.detail } }),
      ...('fn' in resolved && resolved.wrappers.includes('forwardRef')
        ? {
            forwardedRef: span(
              resolved.fn.parameters.filter(
                (param) => !(ts.isIdentifier(param.name) && param.name.text === 'this'),
              )[1] ?? opening.tagName,
            ),
          }
        : {}),
      ...('fn' in resolved && resolved.comparator ? { comparator: span(resolved.comparator) } : {}),
      ...(placementOf(node) ? { placement: placementOf(node) } : {}),
      ...(via.length ? { via } : {}),
      owner: ownerFn ? components.get(ownerFn)!.id : null,
      ...(ownerFn
        ? {}
        : {
            ownerNote: helper
              ? 'This element is created in a helper function, not in a component body.'
              : 'This element is created at module scope.',
          }),
      attributes,
    });
  }

  if (unresolved) {
    notes.push(
      `${unresolved} component element${unresolved === 1 ? '' : 's'} could not be resolved to an analyzed implementation and are reported as unknown.`,
    );
  }

  return {
    format: REPORT_FORMAT,
    version: REPORT_VERSION,
    tracksForwardRefSites: true,
    generatedAt: new Date().toISOString(),
    label: options.label ?? (projectPath(resolve(root, '..'), root) || 'project'),
    files,
    components: [...components.values()],
    sites,
    notes,
  };
}

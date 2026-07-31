import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import ts from "typescript";

export function deriveTypeScriptRuntimeClosure({
  root,
  roots,
  aliases = {},
  sourceOverrides = {},
  resolveOverride,
}) {
  const canonicalRoot = realpathSync(root);
  const configPath = resolve(canonicalRoot, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(formatDiagnostic(config.error));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, canonicalRoot, undefined, configPath);
  parsed.options.paths = { ...parsed.options.paths, ...aliases };

  const queue = roots.map((path) => ({ path: resolve(canonicalRoot, path), bindings: null }));
  const visited = new Set();
  const processed = new Set();
  const edges = [];
  const sources = new Map();
  while (queue.length > 0) {
    const queued = queue.shift();
    if (!existsSync(queued.path)) throw new Error(`Missing closure file: ${label(canonicalRoot, queued.path)}`);
    const file = realpathSync(queued.path);
    const requestKey = `${file}\0${queued.bindings ? [...queued.bindings].sort().join(",") : "*"}`;
    if (processed.has(requestKey)) continue;
    processed.add(requestKey);
    visited.add(file);

    const pathLabel = label(canonicalRoot, file);
    const source = sourceOverrides[pathLabel] ?? readFileSync(file, "utf8");
    sources.set(pathLabel, source);
    if (!/\.[cm]?tsx?$/.test(file)) continue;

    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const request of runtimeRequests(sourceFile, queued.bindings)) {
      const override = resolveOverride?.({
        from: pathLabel,
        importer: file,
        kind: request.kind,
        specifier: request.specifier,
      });
      const resolved = ts.resolveModuleName(
        request.specifier,
        file,
        parsed.options,
        ts.sys,
      ).resolvedModule;
      if (!override && (!resolved || resolved.resolvedFileName.includes(`${sep}node_modules${sep}`))) {
        edges.push({ from: pathLabel, kind: request.kind, specifier: request.specifier, target: null });
        continue;
      }
      const target = realpathSync(override ? resolve(canonicalRoot, override) : resolved.resolvedFileName);
      const targetBindings = request.kind === "export" && request.bindings
        ? exportedBindings(target, request.bindings, canonicalRoot, sourceOverrides)
        : request.bindings;
      if (targetBindings !== null && targetBindings?.size === 0) continue;
      edges.push({ from: pathLabel, kind: request.kind, specifier: request.specifier, target: label(canonicalRoot, target) });
      if (!target.endsWith(".d.ts")) queue.push({ path: target, bindings: targetBindings });
    }

    for (const template of templateUrls(sourceFile)) {
      const target = realpathSync(resolve(dirname(file), template));
      edges.push({ from: pathLabel, kind: "templateUrl", specifier: template, target: label(canonicalRoot, target) });
      queue.push({ path: target, bindings: null });
    }
  }

  return {
    roots: [...roots],
    paths: [...visited].map((path) => label(canonicalRoot, path)).sort(),
    edges: edges.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    sources,
  };
}

function exportedBindings(file, requestedBindings, root, sourceOverrides) {
  const pathLabel = label(root, file);
  const source = sourceOverrides[pathLabel] ?? readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const exports = new Set();
  let hasExportStar = false;
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause) {
        hasExportStar = true;
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) exports.add(element.name.text);
      }
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (!modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (modifiers.some(({ kind }) => kind === ts.SyntaxKind.DefaultKeyword)) exports.add("default");
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) exports.add(declaration.name.text);
      }
    } else if ("name" in statement && statement.name && ts.isIdentifier(statement.name)) {
      exports.add(statement.name.text);
    }
  }
  if (hasExportStar) return new Set(requestedBindings);
  return new Set([...requestedBindings].filter((binding) => exports.has(binding)));
}

export function closureExclusionViolations(closure, exclusions) {
  const violations = [];
  for (const exclusion of exclusions) {
    const matcher = new RegExp(exclusion.pattern, exclusion.flags ?? "i");
    const scopes = new Set(exclusion.scopes ?? ["path", "edge", "content"]);
    if (scopes.has("path")) {
      for (const path of closure.paths) {
        if (matcher.test(path)) violations.push(`${exclusion.id}:path:${path}`);
      }
    }
    if (scopes.has("edge")) {
      for (const edge of closure.edges) {
        if (matcher.test(edge.specifier) || (edge.target && matcher.test(edge.target))) {
          violations.push(`${exclusion.id}:edge:${edge.from}->${edge.specifier}`);
        }
      }
    }
    if (scopes.has("content")) {
      for (const [path, source] of closure.sources) {
        if (exclusion.ignoredContentPaths?.includes(path)) continue;
        if (matcher.test(source)) violations.push(`${exclusion.id}:content:${path}`);
      }
    }
  }
  return [...new Set(violations)].sort();
}

function runtimeRequests(sourceFile, requestedBindings) {
  const requests = [];
  const neededNames = requestedBindings
    ? neededLocalNames(sourceFile, requestedBindings)
    : null;
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = runtimeImportBindings(node, sourceFile, neededNames);
      if (bindings !== undefined) {
        requests.push({ kind: "import", specifier: node.moduleSpecifier.text, bindings });
      }
    } else if (
      ts.isExportDeclaration(node)
      && !node.isTypeOnly
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const bindings = runtimeExportBindings(node, requestedBindings);
      if (bindings !== undefined) {
        requests.push({ kind: "export", specifier: node.moduleSpecifier.text, bindings });
      }
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const argument = node.arguments[0];
      if (ts.isStringLiteral(argument) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        requests.push({ kind: lazyKind(node), specifier: argument.text, bindings: null });
      } else if (
        ts.isStringLiteral(argument)
        && ts.isIdentifier(node.expression)
        && node.expression.text === "require"
      ) {
        requests.push({ kind: "require", specifier: argument.text, bindings: null });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return requests;
}

function runtimeImportBindings(declaration, sourceFile, neededNames) {
  const clause = declaration.importClause;
  if (!clause) return null;
  if (clause.isTypeOnly) return undefined;
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) return null;
  const bindings = [];
  if (
    clause.name
    && (!neededNames || neededNames.has(clause.name.text))
    && bindingUsedAtRuntime(sourceFile, clause.name.text, declaration)
  ) {
    bindings.push("default");
  }
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const element of clause.namedBindings.elements) {
      if (
        !element.isTypeOnly
        && (!neededNames || neededNames.has(element.name.text))
        && bindingUsedAtRuntime(sourceFile, element.name.text, declaration)
      ) {
        bindings.push(element.propertyName?.text ?? element.name.text);
      }
    }
  }
  return bindings.length > 0 ? new Set(bindings) : undefined;
}

function neededLocalNames(sourceFile, requestedBindings) {
  const needed = new Set(requestedBindings);
  const declarations = new Map();
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, declaration);
      }
    } else if (
      (ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement))
      && statement.name
    ) {
      declarations.set(statement.name.text, statement);
    } else if (
      ts.isExportAssignment(statement)
      && requestedBindings.has("default")
    ) {
      collectIdentifiers(statement.expression, needed);
    }
  }

  const queue = [...needed];
  const expanded = new Set();
  while (queue.length > 0) {
    const name = queue.shift();
    if (expanded.has(name)) continue;
    expanded.add(name);
    const declaration = declarations.get(name);
    if (!declaration) continue;
    const before = new Set(needed);
    collectIdentifiers(declaration, needed);
    for (const candidate of needed) {
      if (!before.has(candidate)) queue.push(candidate);
    }
  }
  return needed;
}

function collectIdentifiers(node, target) {
  const visit = (current) => {
    if (ts.isImportDeclaration(current)) return;
    if (ts.isIdentifier(current)) target.add(current.text);
    ts.forEachChild(current, visit);
  };
  visit(node);
}

function runtimeExportBindings(declaration, requestedBindings) {
  if (!declaration.exportClause) {
    return requestedBindings ? new Set(requestedBindings) : null;
  }
  if (!ts.isNamedExports(declaration.exportClause)) return null;
  const bindings = declaration.exportClause.elements.flatMap((element) => {
    const exported = element.name.text;
    if (requestedBindings && !requestedBindings.has(exported)) return [];
    return [element.propertyName?.text ?? exported];
  });
  return bindings.length > 0 ? new Set(bindings) : undefined;
}

function bindingUsedAtRuntime(sourceFile, localName, declaration) {
  let used = false;
  const visit = (node) => {
    if (used || node === declaration) return;
    if (ts.isIdentifier(node) && node.text === localName && !insideTypeNode(node)) {
      used = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return used;
}

function insideTypeNode(node) {
  let current = node.parent;
  while (current && !ts.isStatement(current)) {
    if (ts.isTypeNode(current)) return true;
    current = current.parent;
  }
  return false;
}

function lazyKind(node) {
  let current = node.parent;
  while (current) {
    if (
      ts.isPropertyAssignment(current)
      && (current.name.getText() === "loadComponent" || current.name.getText() === "loadChildren")
    ) {
      return current.name.getText();
    }
    if (ts.isStatement(current)) break;
    current = current.parent;
  }
  return "dynamicImport";
}

function templateUrls(sourceFile) {
  const urls = [];
  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node)
      && node.name.getText(sourceFile) === "templateUrl"
      && ts.isStringLiteral(node.initializer)
    ) {
      urls.push(node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return urls;
}

function label(root, path) {
  return relative(root, path).split(sep).join("/");
}

function formatDiagnostic(diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

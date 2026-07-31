import { dirname, resolve } from "node:path";

import ts from "typescript";

export type RouteComponentGraphEntry = {
  approvedAnonymousShellModule: string;
  approvedLockOverlayModule: string;
  approvedPopupHeaderModule: string;
  approvedPopupPageModule: string;
  componentName: string;
  ownsChildren: boolean;
  routePaths: readonly string[];
  sourcePath: string;
};

type ImportBinding = {
  readonly sourcePath: string;
};

type ComponentMetadata = {
  readonly imports: ReadonlySet<string>;
  readonly template: string;
};

export type ModuleReader = (path: string) => string;

export type RouteShellGraphOptions = {
  readonly approvedLayoutRoot?: string;
};

/** Parses the production route declaration instead of relying on a manually maintained page list. */
export function discoverRouteComponentGraph(
  routeSource: string,
  routePath: string,
  options: RouteShellGraphOptions = {},
): RouteComponentGraphEntry[] {
  const sourceFile = parse(routeSource, routePath);
  const imports = importedRouteComponents(sourceFile, routePath);
  const routeArray = routesArray(sourceFile);
  const discovered = new Map<string, RouteComponentGraphEntry>();
  const approvedLayoutRoot = options.approvedLayoutRoot ?? resolve(dirname(routePath), "layout");
  const approvedModules = {
    anonymousShell: resolve(dirname(routePath), "upstream-overlays/auth/anonymous/official-anonymous-shell.component.ts"),
    lockOverlay: resolve(dirname(routePath), "upstream-overlays/auth/lock/official-lock.component.ts"),
    popupHeader: resolve(approvedLayoutRoot, "popup-header.component.ts"),
    popupPage: resolve(approvedLayoutRoot, "popup-page.component.ts"),
  };

  visitRouteArray(routeArray, "", imports, discovered, approvedModules);
  return [...discovered.values()];
}

export function validateRouteComponentGraph(
  graph: readonly RouteComponentGraphEntry[],
  readModule: ModuleReader,
): string[] {
  return graph.flatMap((entry) => validateComponent(entry, readModule));
}

function parse(source: string, path: string): ts.SourceFile {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function importedRouteComponents(sourceFile: ts.SourceFile, routePath: string): Map<string, ImportBinding> {
  const imports = new Map<string, ImportBinding>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith(".")) {
      continue;
    }
    const importClause = statement.importClause;
    if (!importClause) {
      continue;
    }
    const sourcePath = resolveModule(routePath, specifier);
    if (importClause.name) {
      imports.set(importClause.name.text, { sourcePath });
    }
    if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
      for (const element of importClause.namedBindings.elements) {
        imports.set(element.name.text, { sourcePath });
      }
    }
  }

  return imports;
}

function routesArray(sourceFile: ts.SourceFile): ts.ArrayLiteralExpression {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === "routes" &&
        declaration.initializer &&
        ts.isArrayLiteralExpression(declaration.initializer)
      ) {
        return declaration.initializer;
      }
    }
  }

  throw new Error("app.routes.ts must export a routes array literal");
}

function visitRouteArray(
  routes: ts.ArrayLiteralExpression,
  prefix: string,
  imports: ReadonlyMap<string, ImportBinding>,
  discovered: Map<string, RouteComponentGraphEntry>,
  approvedModules: { readonly anonymousShell: string; readonly lockOverlay: string; readonly popupHeader: string; readonly popupPage: string },
): void {
  for (const route of routes.elements) {
    if (!ts.isObjectLiteralExpression(route)) {
      throw unsupportedRouteElement(prefix, route);
    }
    const path = stringProperty(route, "path") ?? "";
    const fullPath = `${prefix}/${path}`.replace(/\/+/g, "/") || "/";
    const children = arrayProperty(route, "children");
    const component = identifierProperty(route, "component");

    if (component) {
      const binding = imports.get(component);
      const sourcePath = binding?.sourcePath ?? "";
      const previous = discovered.get(component);
      discovered.set(component, {
        componentName: component,
        approvedAnonymousShellModule: approvedModules.anonymousShell,
        approvedLockOverlayModule: approvedModules.lockOverlay,
        approvedPopupHeaderModule: approvedModules.popupHeader,
        approvedPopupPageModule: approvedModules.popupPage,
        ownsChildren: Boolean(children) || previous?.ownsChildren === true,
        routePaths: [...(previous?.routePaths ?? []), fullPath],
        sourcePath,
      });
    }
    if (children) {
      visitRouteArray(children, fullPath === "/" ? "" : fullPath, imports, discovered, approvedModules);
    }
  }
}

function validateComponent(entry: RouteComponentGraphEntry, readModule: ModuleReader): string[] {
  if (!entry.sourcePath) {
    return [`${entry.componentName} is not imported from a resolvable route module`];
  }
  const source = readModule(entry.sourcePath);
  if (!source) {
    return [`${entry.componentName} route module could not be read: ${entry.sourcePath}`];
  }
  const sourceFile = parse(source, entry.sourcePath);
  const metadata = componentMetadata(sourceFile, entry.componentName, readModule);
  if (!metadata) {
    return [`${entry.componentName} has no @Component metadata`];
  }

  return entry.ownsChildren
    ? validateLayoutRoute(entry, sourceFile, metadata)
    : validatePageRoute(entry, sourceFile, metadata);
}

function validateLayoutRoute(
  entry: RouteComponentGraphEntry,
  sourceFile: ts.SourceFile,
  metadata: ComponentMetadata,
): string[] {
  const errors: string[] = [];
  const routerOutlet = namedImport(sourceFile, "RouterOutlet", "@angular/router");
  if (!routerOutlet || !metadata.imports.has(routerOutlet)) {
    errors.push(`${entry.componentName} owns child routes but does not include RouterOutlet in the component imports`);
  }
  if (!/<router-outlet\b/.test(metadata.template)) {
    errors.push(`${entry.componentName} owns child routes but does not project a router-outlet`);
  }
  return errors;
}

function validatePageRoute(
  entry: RouteComponentGraphEntry,
  sourceFile: ts.SourceFile,
  metadata: ComponentMetadata,
): string[] {
  const errors: string[] = [];
  const page = namedImportFromApprovedModule(
    sourceFile,
    "PopupPageComponent",
    entry.approvedPopupPageModule,
  );
  const header = namedImportFromApprovedModule(
    sourceFile,
    "PopupHeaderComponent",
    entry.approvedPopupHeaderModule,
  );
  const anonymousShell = namedImportFromApprovedModule(
    sourceFile,
    "OfficialAnonymousShellComponent",
    entry.approvedAnonymousShellModule,
  );
  const usesAnonymousShell = Boolean(
    anonymousShell &&
    metadata.imports.has(anonymousShell) &&
    /<bw-official-anonymous-shell\b/.test(metadata.template),
  );
  const lockOverlay = namedImportFromApprovedModule(
    sourceFile,
    "OfficialLockComponent",
    entry.approvedLockOverlayModule,
  );
  const usesLockOverlay = Boolean(
    lockOverlay && metadata.imports.has(lockOverlay) && /<bw-official-lock\b/.test(metadata.template),
  );
  const usesApprovedWrapper = usesApprovedPageWrapper(entry, sourceFile, metadata);
  const usesApprovedInlineHeader = usesApprovedPageHeader(entry, sourceFile, metadata);

  if (usesAnonymousShell || usesLockOverlay) {
    return errors;
  }

  if (usesApprovedWrapper) {
    const wrapper = approvedPageWrappers[entry.componentName];
    const wrapperCount = wrapper
      ? metadata.template.match(new RegExp(`<${wrapper.selector}\\b`, "g"))?.length ?? 0
      : 0;
    if (wrapperCount !== 1) {
      errors.push(`${entry.componentName} must render exactly one approved official wrapper`);
    }
    if (/<popup-page\b/.test(metadata.template)) {
      errors.push(`${entry.componentName} duplicates popup-page outside its official recovery wrapper`);
    }
    if (/<popup-header\b/.test(metadata.template)) {
      errors.push(`${entry.componentName} duplicates popup-header outside its official recovery wrapper`);
    }
    if (/<main[^>]+class="[^"]*popup-page/.test(metadata.template)) {
      errors.push(`${entry.componentName} uses a local popup-page lookalike`);
    }
    if (/<header[^>]+class="[^"]*popup-header/.test(metadata.template)) {
      errors.push(`${entry.componentName} uses a local popup-header lookalike`);
    }
    return errors;
  }

  if (!page) {
    errors.push(`${entry.componentName} does not import PopupPageComponent from the approved layout module`);
  } else if (!metadata.imports.has(page)) {
    errors.push(`${entry.componentName} does not include PopupPageComponent in the component imports`);
  }
  if (!header && !usesApprovedInlineHeader) {
    errors.push(`${entry.componentName} does not import PopupHeaderComponent from the approved layout module`);
  } else if (header && !metadata.imports.has(header) && !usesApprovedInlineHeader) {
    errors.push(`${entry.componentName} does not include PopupHeaderComponent in the component imports`);
  }
  if (!/<popup-page\b/.test(metadata.template)) {
    errors.push(`${entry.componentName} does not render the official popup-page selector`);
  }
  if (
    !/<popup-header\b[^>]*\bslot="header"/.test(metadata.template) &&
    !usesApprovedInlineHeader
  ) {
    errors.push(`${entry.componentName} does not render the official popup-header selector`);
  }
  if (/<main[^>]+class="[^"]*popup-page/.test(metadata.template)) {
    errors.push(`${entry.componentName} uses a local popup-page lookalike`);
  }
  if (/<header[^>]+class="[^"]*popup-header/.test(metadata.template)) {
    errors.push(`${entry.componentName} uses a local popup-header lookalike`);
  }
  return errors;
}

function usesApprovedPageHeader(
  entry: RouteComponentGraphEntry,
  sourceFile: ts.SourceFile,
  metadata: ComponentMetadata,
): boolean {
  const header = approvedInlinePageHeaders[entry.componentName];
  if (!header) {
    return false;
  }
  const approvedModule = resolve(
    dirname(entry.approvedPopupPageModule),
    "..",
    header.modulePath,
  );
  const binding = namedImportFromApprovedModule(
    sourceFile,
    header.importedName,
    approvedModule,
  );
  const matches = metadata.template.match(
    new RegExp(`<${header.selector}\\b[^>]*\\bslot="above-scroll-area"`, "g"),
  )?.length ?? 0;
  return Boolean(binding && metadata.imports.has(binding) && matches === 1);
}

function usesApprovedPageWrapper(
  entry: RouteComponentGraphEntry,
  sourceFile: ts.SourceFile,
  metadata: ComponentMetadata,
): boolean {
  const wrapper = approvedPageWrappers[entry.componentName];
  if (!wrapper) {
    return false;
  }
  const approvedModule = wrapper.moduleSpecifier ?? resolve(
    dirname(entry.approvedPopupPageModule),
    "..",
    wrapper.modulePath ?? "",
  );
  const binding = namedImportFromApprovedModule(
    sourceFile,
    wrapper.importedName,
    approvedModule,
  );
  return Boolean(
    binding &&
    metadata.imports.has(binding) &&
    new RegExp(`<${wrapper.selector}\\b`).test(metadata.template),
  );
}

const approvedInlinePageHeaders: Readonly<Record<string, {
  readonly importedName: string;
  readonly modulePath: string;
  readonly selector: string;
}>> = {
  VaultListPageComponent: {
    importedName: "VaultRootHeaderComponent",
    modulePath: "vault/vault-root-header.component.ts",
    selector: "bw-vault-root-header",
  },
  OtpPageComponent: {
    importedName: "VaultRootHeaderComponent",
    modulePath: "vault/vault-root-header.component.ts",
    selector: "bw-vault-root-header",
  },
};

const approvedPageWrappers: Readonly<Record<string, {
  readonly importedName: string;
  readonly modulePath?: string;
  readonly moduleSpecifier?: string;
  readonly selector: string;
}>> = {
  SettingsPageComponent: {
    importedName: "OfficialSettingsComponent",
    modulePath: "upstream-overlays/settings/official-settings.component.ts",
    selector: "bw-official-settings",
  },
  AccountSecurityPageComponent: {
    importedName: "OfficialAccountSecurityComponent",
    modulePath: "upstream-overlays/settings/official-account-security.component.ts",
    selector: "bw-official-account-security",
  },
  VaultSettingsPageComponent: {
    importedName: "OfficialVaultSettingsComponent",
    modulePath: "upstream-overlays/settings/official-vault-settings.component.ts",
    selector: "bw-official-vault-settings",
  },
  AppearancePageComponent: {
    importedName: "OfficialAppearanceComponent",
    modulePath: "upstream-overlays/settings/official-appearance.component.ts",
    selector: "bw-official-appearance",
  },
  AboutPageComponent: {
    importedName: "OfficialAboutComponent",
    modulePath: "upstream-overlays/settings/official-about.component.ts",
    selector: "bw-official-about",
  },
  GeneratorPageComponent: {
    importedName: "OfficialCredentialGeneratorComponent",
    moduleSpecifier: "@bitwarden/generator-overlay/credential-generator",
    selector: "bw-official-credential-generator",
  },
  GeneratorHistoryPageComponent: {
    importedName: "OfficialGeneratorHistoryComponent",
    moduleSpecifier: "@bitwarden/generator-overlay/credential-generator-history",
    selector: "bw-official-generator-history",
  },
  SendPageComponent: {
    importedName: "OfficialSendListComponent",
    modulePath: "upstream-overlays/send/official-send-list.component.ts",
    selector: "bw-official-send-list",
  },
  SendAddEditPageComponent: {
    importedName: "OfficialSendAddEditComponent",
    modulePath: "upstream-overlays/send/official-send-add-edit.component.ts",
    selector: "bw-official-send-add-edit",
  },
  SendCreatedPageComponent: {
    importedName: "OfficialSendCreatedComponent",
    modulePath: "upstream-overlays/send/official-send-created.component.ts",
    selector: "bw-official-send-created",
  },
  FoldersPageComponent: {
    importedName: "OfficialFoldersComponent",
    modulePath: "upstream-overlays/recovery/folders/official-folders.component.ts",
    selector: "bw-official-folders",
  },
  ArchivePageComponent: {
    importedName: "OfficialArchiveComponent",
    modulePath: "upstream-overlays/recovery/archive/official-archive.component.ts",
    selector: "bw-official-archive",
  },
  TrashPageComponent: {
    importedName: "OfficialTrashComponent",
    modulePath: "upstream-overlays/recovery/trash/official-trash.component.ts",
    selector: "bw-official-trash",
  },
};

function componentMetadata(
  sourceFile: ts.SourceFile,
  componentName: string,
  readModule: ModuleReader,
): ComponentMetadata | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name?.text !== componentName) {
      continue;
    }
    for (const decorator of ts.getDecorators(statement) ?? []) {
      if (!ts.isCallExpression(decorator.expression) || !ts.isIdentifier(decorator.expression.expression)) {
        continue;
      }
      if (decorator.expression.expression.text !== "Component") {
        continue;
      }
      const metadata = decorator.expression.arguments[0];
      if (!metadata || !ts.isObjectLiteralExpression(metadata)) {
        continue;
      }
      const templateUrl = stringProperty(metadata, "templateUrl");
      return {
        imports: new Set(identifierArrayProperty(metadata, "imports")),
        template: templateUrl
          ? readModule(resolve(dirname(sourceFile.fileName), templateUrl))
          : templateProperty(metadata),
      };
    }
  }
  return undefined;
}

function namedImportFromApprovedModule(
  sourceFile: ts.SourceFile,
  importedName: string,
  approvedModule: string,
): string | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (resolveModule(sourceFile.fileName, statement.moduleSpecifier.text) !== approvedModule) {
      continue;
    }
    const elements = statement.importClause?.namedBindings;
    if (!elements || !ts.isNamedImports(elements)) {
      continue;
    }
    const element = elements.elements.find(
      (candidate) => (candidate.propertyName?.text ?? candidate.name.text) === importedName,
    );
    if (element) {
      return element.name.text;
    }
  }
  return undefined;
}

function unsupportedRouteElement(prefix: string, element: ts.Expression): Error {
  const routePath = prefix || "/";
  return new Error(
    `Unsupported route array element at ${routePath}: ${ts.SyntaxKind[element.kind]} (${element.getText()})`,
  );
}

function namedImport(sourceFile: ts.SourceFile, importedName: string, moduleSpecifier: string): string | undefined {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== moduleSpecifier
    ) {
      continue;
    }
    const elements = statement.importClause?.namedBindings;
    if (!elements || !ts.isNamedImports(elements)) {
      continue;
    }
    const element = elements.elements.find(
      (candidate) => (candidate.propertyName?.text ?? candidate.name.text) === importedName,
    );
    if (element) {
      return element.name.text;
    }
  }
  return undefined;
}

function resolveModule(fromPath: string, specifier: string): string {
  return specifier.startsWith(".") ? `${resolve(dirname(fromPath), specifier)}.ts` : specifier;
}

function property(object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) &&
      (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name)) &&
      candidate.name.text === name,
  );
}

function stringProperty(object: ts.ObjectLiteralExpression, name: string): string | undefined {
  const initializer = property(object, name)?.initializer;
  return initializer && ts.isStringLiteral(initializer) ? initializer.text : undefined;
}

function identifierProperty(object: ts.ObjectLiteralExpression, name: string): string | undefined {
  const initializer = property(object, name)?.initializer;
  return initializer && ts.isIdentifier(initializer) ? initializer.text : undefined;
}

function arrayProperty(object: ts.ObjectLiteralExpression, name: string): ts.ArrayLiteralExpression | undefined {
  const initializer = property(object, name)?.initializer;
  return initializer && ts.isArrayLiteralExpression(initializer) ? initializer : undefined;
}

function identifierArrayProperty(object: ts.ObjectLiteralExpression, name: string): string[] {
  const initializer = arrayProperty(object, name);
  return initializer
    ? initializer.elements.filter(ts.isIdentifier).map((element) => element.text)
    : [];
}

function templateProperty(object: ts.ObjectLiteralExpression): string {
  const initializer = property(object, "template")?.initializer;
  return initializer && (ts.isNoSubstitutionTemplateLiteral(initializer) || ts.isStringLiteral(initializer))
    ? initializer.text
    : "";
}

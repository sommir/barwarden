import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { officialSourceMappings } from "../../upstream-source-map";

const projectRoot = process.cwd();
const overlayDirectory = resolve(projectRoot, "apps/menubar-tauri/official-components-overlay/async-actions");
const overlayDirective = resolve(overlayDirectory, "bit-action.directive.ts");
const overlayModule = resolve(overlayDirectory, "async-actions.module.ts");
const pinnedDirectory = resolve(projectRoot, "vendor/bitwarden-clients/libs/components/src/async-actions");
const pinnedDirective = resolve(pinnedDirectory, "bit-action.directive.ts");
const pinnedModule = resolve(pinnedDirectory, "async-actions.module.ts");
const pinnedDirectiveSha256 = "8fa9b05561932c322d4496494f2bfd9ad23ea7b80a93f381b8e8cf062177eda4";
const popupHeaderOverlay = resolve(
  projectRoot,
  "apps/menubar-tauri/src/app/upstream-overlays/popup-header/popup-header.component.ts",
);
const popupRouterCacheAdapter = resolve(
  projectRoot,
  "apps/menubar-tauri/src/app/upstream-overlays/popup-header/popup-router-cache.adapter.ts",
);
const componentsOverlayIndex = resolve(
  projectRoot,
  "apps/menubar-tauri/official-components-overlay/index.ts",
);
const forbiddenRuntimeSources = [
  "vendor/bitwarden-clients/apps/browser/src/platform/popup/view-cache/popup-router-cache.service.ts",
  "vendor/bitwarden-clients/apps/browser/src/platform/services/popup-router-cache-background.service.ts",
  "vendor/bitwarden-clients/libs/common/src/platform/state",
] as const;

function sha256(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

function normalizedPatchedDirective(source: string, fileName: string): string {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const transformed = ts.transform(sourceFile, [
    (context) => (root) =>
      ts.visitNode(root, function visit(node): ts.VisitResult<ts.Node> {
        if (
          ts.isPropertyDeclaration(node) &&
          node.name.getText(sourceFile) === "destroyed" &&
          node.initializer?.kind === ts.SyntaxKind.FalseKeyword
        ) {
          return undefined;
        }

        if (ts.isConstructorDeclaration(node) && node.body) {
          return context.factory.updateConstructorDeclaration(
            node,
            node.modifiers,
            node.parameters,
            context.factory.createBlock(
              node.body.statements.filter(
                (statement) =>
                  !(
                    ts.isExpressionStatement(statement) &&
                    statement.getText(sourceFile) === "this.destroyRef.onDestroy(() => (this.destroyed = true));"
                  ),
              ),
              false,
            ),
          );
        }

        if (
          ts.isIfStatement(node) &&
          node.expression.getText(sourceFile) === "!this.destroyed" &&
          node.elseStatement === undefined &&
          ts.isBlock(node.thenStatement) &&
          node.thenStatement.statements.length === 1 &&
          node.thenStatement.statements[0].getText(sourceFile) ===
            "this.buttonComponent.loading.set(value);"
        ) {
          return node.thenStatement.statements[0];
        }

        return ts.visitEachChild(node, visit, context);
      }) as ts.SourceFile,
  ]).transformed[0] as ts.SourceFile;

  return ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(transformed);
}

function importedSpecifiers(source: string): string[] {
  const sourceFile = ts.createSourceFile("runtime-imports.ts", source, ts.ScriptTarget.Latest, true);
  return sourceFile.statements.flatMap((statement) => {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return [statement.moduleSpecifier.text];
    }

    return [];
  });
}

function activeTypeScriptOptions(): ts.CompilerOptions {
  const configPath = resolve(projectRoot, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);

  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  }

  return ts.parseJsonConfigFileContent(config.config, ts.sys, projectRoot).options;
}

function resolveRuntimeImport(specifier: string, containingFile: string): string {
  const resolved = ts.resolveModuleName(
    specifier,
    containingFile,
    activeTypeScriptOptions(),
    ts.sys,
  ).resolvedModule?.resolvedFileName;

  if (!resolved) {
    throw new Error(`Unable to resolve ${specifier} from ${containingFile}`);
  }

  return resolved;
}

describe("official async-actions lifecycle overlay", () => {
  it("permits only the documented destroyed-loading lifecycle guard over the pinned directive", () => {
    expect(lstatSync(overlayDirectory).isSymbolicLink()).toBe(false);
    expect(lstatSync(overlayDirective).isSymbolicLink()).toBe(false);
    expect(sha256(readFileSync(pinnedDirective, "utf8"))).toBe(pinnedDirectiveSha256);

    expect(normalizedPatchedDirective(readFileSync(overlayDirective, "utf8"), overlayDirective)).toBe(
      normalizedPatchedDirective(readFileSync(pinnedDirective, "utf8"), pinnedDirective),
    );
  });

  it("rejects an else branch on the approved destroyed-loading lifecycle guard", () => {
    const overlay = readFileSync(overlayDirective, "utf8");
    const withElseBranch = overlay.replace(
      `    if (!this.destroyed) {
      this.buttonComponent.loading.set(value);
    }
`,
      `    if (!this.destroyed) {
      this.buttonComponent.loading.set(value);
    } else {
      this.buttonComponent.loading.set(false);
    }
`,
    );

    expect(withElseBranch).not.toBe(overlay);
    expect(normalizedPatchedDirective(withElseBranch, overlayDirective)).not.toBe(
      normalizedPatchedDirective(readFileSync(pinnedDirective, "utf8"), pinnedDirective),
    );
  });

  it("keeps AsyncActionsModule and its relative directive graph on the patched source", () => {
    expect(readFileSync(overlayModule, "utf8")).toBe(readFileSync(pinnedModule, "utf8"));
    expect(importedSpecifiers(readFileSync(overlayModule, "utf8"))).toContain("./bit-action.directive");
    expect(resolve(overlayDirectory, "bit-action.directive.ts")).toBe(overlayDirective);
    expect(realpathSync(resolve(overlayDirectory, "form-button.directive.ts"))).toBe(
      resolve(pinnedDirectory, "form-button.directive.ts"),
    );
    expect(importedSpecifiers(readFileSync(resolve(overlayDirectory, "form-button.directive.ts"), "utf8"))).toContain(
      "./bit-action.directive",
    );
  });

  it("records the lifecycle patch as an approved adapter", () => {
    expect(officialSourceMappings).toContainEqual({
      localModule:
        "apps/menubar-tauri/official-components-overlay/async-actions/bit-action.directive.ts",
      upstreamSources: [
        "vendor/bitwarden-clients/libs/components/src/async-actions/bit-action.directive.ts",
      ],
      mode: "adapter",
      excludedDependencies: [
        "DestroyRef lifecycle guard prevents a destroyed button loading signal write during async teardown",
      ],
    });
  });

  it("keeps browser cache, background, and global-state sources out of the Task 2 runtime graph", () => {
    const runtimeSources = [
      popupHeaderOverlay,
      popupRouterCacheAdapter,
      componentsOverlayIndex,
      overlayModule,
      overlayDirective,
      resolve(overlayDirectory, "form-button.directive.ts"),
    ].map((file) => readFileSync(file, "utf8"));
    const imports = runtimeSources.flatMap(importedSpecifiers);
    const runtimeText = runtimeSources.join("\n");

    expect(resolveRuntimeImport("./popup-router-cache.adapter", popupHeaderOverlay)).toBe(
      popupRouterCacheAdapter,
    );
    expect(resolveRuntimeImport("@bitwarden/components", popupHeaderOverlay)).toBe(
      componentsOverlayIndex,
    );
    expect(
      resolveRuntimeImport(
        "@bitwarden/components/async-actions/async-actions.module",
        componentsOverlayIndex,
      ),
    ).toBe(overlayModule);
    expect(resolveRuntimeImport("./bit-action.directive", overlayModule)).toBe(overlayDirective);
    expect(
      resolveRuntimeImport("./bit-action.directive", resolve(overlayDirectory, "form-button.directive.ts")),
    ).toBe(overlayDirective);
    expect(imports).toContain("./popup-router-cache.adapter");
    expect(imports).not.toContain("../view-cache/popup-router-cache.service");
    expect(imports).not.toContain("@bitwarden/common/platform/state");
    for (const source of forbiddenRuntimeSources) {
      expect(existsSync(resolve(projectRoot, source))).toBe(true);
      expect(runtimeText).not.toContain(source);
    }
  });
});

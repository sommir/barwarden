import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { discoverRouteComponentGraph, validateRouteComponentGraph } from "./route-shell-graph";

const appRoot = join(process.cwd(), "apps/menubar-tauri/src/app");
const routesPath = join(appRoot, "app.routes.ts");
const readProjectModule = (path: string) => readFileSync(path, "utf8");
const fixtureGraph = (routes: string) =>
  discoverRouteComponentGraph(routes, "/fixture/app.routes.ts", { approvedLayoutRoot: "/layout" });

describe("production route shell guard", () => {
  it("derives every routed component from app.routes and validates official shell ownership", () => {
    const graph = discoverRouteComponentGraph(readProjectModule(routesPath), routesPath);

    expect(graph.some((entry) => entry.componentName === "PopupShellComponent" && entry.ownsChildren)).toBe(true);
    expect(graph.map((entry) => entry.componentName)).toEqual(
      expect.arrayContaining(["LoginPageComponent", "SettingsPasswordPageComponent", "VaultItemDetailPageComponent"]),
    );
    expect(validateRouteComponentGraph(graph, readProjectModule)).toEqual([]);
  });

  it.each(["VaultListPageComponent", "OtpPageComponent"])(
    "accepts %s only with the exact in-flow vault root header",
    (componentName) => {
      const routes = `
        import { ${componentName} } from "./vault-page.component";
        export const routes = [{ path: "vault", component: ${componentName} }];
      `;
      const modules = new Map([
        [
          "/fixture/vault-page.component.ts",
          `
            import { Component } from "@angular/core";
            import { PopupPageComponent } from "../layout/popup-page.component";
            import { VaultRootHeaderComponent } from "../vault/vault-root-header.component";
            @Component({
              imports: [PopupPageComponent, VaultRootHeaderComponent],
              template: \`<popup-page><bw-vault-root-header slot="above-scroll-area" /></popup-page>\`,
            })
            export class ${componentName} {}
          `,
        ],
      ]);

      expect(validateRouteComponentGraph(fixtureGraph(routes), (path) => modules.get(path) ?? ""))
        .toEqual([]);
    },
  );

  it("rejects a discovered future route with unused official imports and local shell lookalikes", () => {
    const routes = `
      import { FuturePageComponent } from "./future-page.component";
      export const routes = [{ path: "future", component: FuturePageComponent }];
    `;
    const modules = new Map([
      [
        "/fixture/future-page.component.ts",
        `
          import { Component } from "@angular/core";
          import { PopupHeaderComponent } from "../layout/popup-header.component";
          import { PopupPageComponent } from "../layout/popup-page.component";
          @Component({ imports: [], template: \`<main class="popup-page"><header class="popup-header"></header></main>\` })
          export class FuturePageComponent {}
        `,
      ],
    ]);
    const graph = fixtureGraph(routes);
    const errors = validateRouteComponentGraph(graph, (path) => modules.get(path) ?? "");

    expect(graph).toHaveLength(1);
    expect(errors.join("\n")).toContain("does not include PopupPageComponent in the component imports");
    expect(errors.join("\n")).toContain("uses a local popup-page lookalike");
  });

  it("rejects selectors backed by fake popup component imports", () => {
    const routes = `
      import { FuturePageComponent } from "./future-page.component";
      export const routes = [{ path: "future", component: FuturePageComponent }];
    `;
    const modules = new Map([
      [
        "/fixture/future-page.component.ts",
        `
          import { Component } from "@angular/core";
          import { PopupHeaderComponent } from "../fake/popup-header.component";
          import { PopupPageComponent } from "../fake/popup-page.component";
          @Component({
            imports: [PopupHeaderComponent, PopupPageComponent],
            template: \`<popup-page><popup-header slot="header"></popup-header></popup-page>\`,
          })
          export class FuturePageComponent {}
        `,
      ],
    ]);
    const graph = fixtureGraph(routes);
    const errors = validateRouteComponentGraph(graph, (path) => modules.get(path) ?? "");

    expect(errors.join("\n")).toContain("does not import PopupPageComponent from the approved layout module");
    expect(errors.join("\n")).toContain("does not import PopupHeaderComponent from the approved layout module");
  });

  it.each([
    [
      "FoldersPageComponent",
      "OfficialFoldersComponent",
      "../upstream-overlays/recovery/folders/official-folders.component",
      "bw-official-folders",
    ],
    [
      "ArchivePageComponent",
      "OfficialArchiveComponent",
      "../upstream-overlays/recovery/archive/official-archive.component",
      "bw-official-archive",
    ],
    [
      "TrashPageComponent",
      "OfficialTrashComponent",
      "../upstream-overlays/recovery/trash/official-trash.component",
      "bw-official-trash",
    ],
  ] as const)(
    "accepts %s only through its exact official recovery wrapper without duplicate popup DOM",
    (componentName, wrapperName, wrapperModule, selector) => {
      const routes = `
        import { ${componentName} } from "./recovery-page.component";
        export const routes = [{ path: "recovery", component: ${componentName} }];
      `;
      const modules = new Map([
        [
          "/fixture/recovery-page.component.ts",
          `
            import { Component } from "@angular/core";
            import { ${wrapperName} } from "${wrapperModule}";
            @Component({ imports: [${wrapperName}], template: \`<${selector} />\` })
            export class ${componentName} {}
          `,
        ],
      ]);

      expect(validateRouteComponentGraph(fixtureGraph(routes), (path) => modules.get(path) ?? ""))
        .toEqual([]);
    },
  );

  it("rejects a Settings lookalike with the approved selector imported from a local module", () => {
    const routes = `
      import { SettingsPageComponent } from "./settings-page.component";
      export const routes = [{ path: "settings", component: SettingsPageComponent }];
    `;
    const modules = new Map([
      [
        "/fixture/settings-page.component.ts",
        `
          import { Component } from "@angular/core";
          import { OfficialSettingsComponent } from "./official-settings-lookalike.component";
          @Component({
            imports: [OfficialSettingsComponent],
            template: \`<bw-official-settings />\`,
          })
          export class SettingsPageComponent {}
        `,
      ],
    ]);

    expect(validateRouteComponentGraph(fixtureGraph(routes), (path) => modules.get(path) ?? ""))
      .toEqual(expect.arrayContaining([
        "SettingsPageComponent does not import PopupPageComponent from the approved layout module",
      ]));
  });

  it.each([
    ["SettingsPageComponent", "OfficialSettingsComponent", "official-settings.component", "bw-official-settings"],
    ["AccountSecurityPageComponent", "OfficialAccountSecurityComponent", "official-account-security.component", "bw-official-account-security"],
    ["VaultSettingsPageComponent", "OfficialVaultSettingsComponent", "official-vault-settings.component", "bw-official-vault-settings"],
    ["AppearancePageComponent", "OfficialAppearanceComponent", "official-appearance.component", "bw-official-appearance"],
    ["AboutPageComponent", "OfficialAboutComponent", "official-about.component", "bw-official-about"],
  ] as const)(
    "accepts %s only through its exact official Settings wrapper",
    (componentName, wrapperName, wrapperFile, selector) => {
      const routes = `
        import { ${componentName} } from "./settings-page.component";
        export const routes = [{ path: "settings", component: ${componentName} }];
      `;
      const modules = new Map([
        [
          "/fixture/settings-page.component.ts",
          `
            import { Component } from "@angular/core";
            import { ${wrapperName} } from "../upstream-overlays/settings/${wrapperFile}";
            @Component({ imports: [${wrapperName}], template: \`<${selector} />\` })
            export class ${componentName} {}
          `,
        ],
      ]);

      expect(validateRouteComponentGraph(fixtureGraph(routes), (path) => modules.get(path) ?? ""))
        .toEqual([]);
    },
  );

  it("accepts GeneratorPageComponent only through the exact source-direct official wrapper", () => {
    const routes = `
      import { GeneratorPageComponent } from "./generator-page.component";
      export const routes = [{ path: "generator", component: GeneratorPageComponent }];
    `;
    const modules = new Map([
      [
        "/fixture/generator-page.component.ts",
        `
          import { Component } from "@angular/core";
          import { OfficialCredentialGeneratorComponent } from "@bitwarden/generator-overlay/credential-generator";
          @Component({
            imports: [OfficialCredentialGeneratorComponent],
            template: \`<bw-official-credential-generator />\`,
          })
          export class GeneratorPageComponent {}
        `,
      ],
    ]);

    expect(validateRouteComponentGraph(fixtureGraph(routes), (path) => modules.get(path) ?? ""))
      .toEqual([]);
  });

  it("accepts GeneratorHistoryPageComponent only through its exact source-direct wrapper", () => {
    const routes = `
      import { GeneratorHistoryPageComponent } from "./generator-history-page.component";
      export const routes = [{ path: "generator/history", component: GeneratorHistoryPageComponent }];
    `;
    const modules = new Map([
      [
        "/fixture/generator-history-page.component.ts",
        `
          import { Component } from "@angular/core";
          import { OfficialGeneratorHistoryComponent } from "@bitwarden/generator-overlay/credential-generator-history";
          @Component({
            imports: [OfficialGeneratorHistoryComponent],
            template: \`<bw-official-generator-history />\`,
          })
          export class GeneratorHistoryPageComponent {}
        `,
      ],
    ]);

    expect(validateRouteComponentGraph(fixtureGraph(routes), (path) => modules.get(path) ?? ""))
      .toEqual([]);
  });

  it.each([
    ["SendPageComponent", "OfficialSendListComponent", "official-send-list.component", "bw-official-send-list"],
    ["SendAddEditPageComponent", "OfficialSendAddEditComponent", "official-send-add-edit.component", "bw-official-send-add-edit"],
    ["SendCreatedPageComponent", "OfficialSendCreatedComponent", "official-send-created.component", "bw-official-send-created"],
  ] as const)("accepts %s only through its exact official Send wrapper", (componentName, wrapperName, moduleName, selector) => {
    const routes = `
      import { ${componentName} } from "./send-page.component";
      export const routes = [{ path: "send", component: ${componentName} }];
    `;
    const modules = new Map([
      [
        "/fixture/send-page.component.ts",
        `
          import { Component } from "@angular/core";
          import { ${wrapperName} } from "../upstream-overlays/send/${moduleName}";
          @Component({ imports: [${wrapperName}], template: \`<${selector} />\` })
          export class ${componentName} {}
        `,
      ],
    ]);

    expect(validateRouteComponentGraph(fixtureGraph(routes), (path) => modules.get(path) ?? ""))
      .toEqual([]);
  });

  it("rejects GeneratorPageComponent through a fake official wrapper", () => {
    const routes = `
      import { GeneratorPageComponent } from "./generator-page.component";
      export const routes = [{ path: "generator", component: GeneratorPageComponent }];
    `;
    const modules = new Map([
      [
        "/fixture/generator-page.component.ts",
        `
          import { Component } from "@angular/core";
          import { OfficialCredentialGeneratorComponent } from "../fake/official-credential-generator.component";
          @Component({
            imports: [OfficialCredentialGeneratorComponent],
            template: \`<bw-official-credential-generator />\`,
          })
          export class GeneratorPageComponent {}
        `,
      ],
    ]);

    expect(validateRouteComponentGraph(fixtureGraph(routes), (path) => modules.get(path) ?? ""))
      .not.toEqual([]);
  });

  it.each([
    ["fake import", "../fake/official-folders.component", "<bw-official-folders />", "[OfficialFoldersComponent]"],
    ["unused wrapper", "../upstream-overlays/recovery/folders/official-folders.component", "<div></div>", "[]"],
  ] as const)("rejects a Folders recovery wrapper with a %s", (_label, modulePath, template, imports) => {
    const routes = `
      import { FoldersPageComponent } from "./recovery-page.component";
      export const routes = [{ path: "folders", component: FoldersPageComponent }];
    `;
    const modules = new Map([
      [
        "/fixture/recovery-page.component.ts",
        `
          import { Component } from "@angular/core";
          import { OfficialFoldersComponent } from "${modulePath}";
          @Component({ imports: ${imports}, template: \`${template}\` })
          export class FoldersPageComponent {}
        `,
      ],
    ]);

    const errors = validateRouteComponentGraph(fixtureGraph(routes), (path) => modules.get(path) ?? "");
    expect(errors).not.toEqual([]);
  });

  it.each([
    ["duplicate popup-page", "<bw-official-folders /><popup-page></popup-page>"],
    ["duplicate recovery wrapper", "<bw-official-folders /><bw-official-folders />"],
    ["duplicate popup-header", "<bw-official-folders /><popup-header></popup-header>"],
    ["local popup-page lookalike", '<bw-official-folders /><main class="popup-page"></main>'],
  ] as const)("rejects an exact recovery wrapper with %s", (_label, template) => {
    const routes = `
      import { FoldersPageComponent } from "./recovery-page.component";
      export const routes = [{ path: "folders", component: FoldersPageComponent }];
    `;
    const modules = new Map([
      [
        "/fixture/recovery-page.component.ts",
        `
          import { Component } from "@angular/core";
          import { OfficialFoldersComponent } from "../upstream-overlays/recovery/folders/official-folders.component";
          @Component({ imports: [OfficialFoldersComponent], template: \`${template}\` })
          export class FoldersPageComponent {}
        `,
      ],
    ]);

    const errors = validateRouteComponentGraph(fixtureGraph(routes), (path) => modules.get(path) ?? "");
    expect(errors).not.toEqual([]);
  });

  it("rejects a compliant route component imported from a fake layout subtree", () => {
    const routes = `
      import { FuturePageComponent } from "./future-page.component";
      export const routes = [{ path: "future", component: FuturePageComponent }];
    `;
    const modules = new Map([
      [
        "/fixture/future-page.component.ts",
        `
          import { Component } from "@angular/core";
          import { PopupHeaderComponent } from "../fake/layout/popup-header.component";
          import { PopupPageComponent } from "../fake/layout/popup-page.component";
          @Component({
            imports: [PopupHeaderComponent, PopupPageComponent],
            template: \`<popup-page><popup-header slot="header"></popup-header></popup-page>\`,
          })
          export class FuturePageComponent {}
        `,
      ],
    ]);
    const graph = fixtureGraph(routes);
    const errors = validateRouteComponentGraph(graph, (path) => modules.get(path) ?? "");

    expect(errors.join("\n")).toContain("does not import PopupPageComponent from the approved layout module");
    expect(errors.join("\n")).toContain("does not import PopupHeaderComponent from the approved layout module");
  });

  it("fails closed for a spread route entry", () => {
    const routes = `
      const retainedRoutes = [];
      export const routes = [...retainedRoutes];
    `;

    expect(() => discoverRouteComponentGraph(routes, "/fixture/app.routes.ts")).toThrow(
      "Unsupported route array element at /: SpreadElement (...retainedRoutes)",
    );
  });

  it("fails closed for an identifier route entry", () => {
    const routes = `
      const retainedRoutes = [];
      export const routes = [retainedRoutes];
    `;

    expect(() => discoverRouteComponentGraph(routes, "/fixture/app.routes.ts")).toThrow(
      "Unsupported route array element at /: Identifier (retainedRoutes)",
    );
  });

  it("validates the exact routed class instead of a compliant decoy component in the same module", () => {
    const routes = `
      import { FuturePageComponent } from "./future-page.component";
      export const routes = [{ path: "future", component: FuturePageComponent }];
    `;
    const modules = new Map([
      [
        "/fixture/future-page.component.ts",
        `
          import { Component } from "@angular/core";
          import { PopupHeaderComponent } from "../layout/popup-header.component";
          import { PopupPageComponent } from "../layout/popup-page.component";
          @Component({
            imports: [PopupHeaderComponent, PopupPageComponent],
            template: \`<popup-page><popup-header slot="header"></popup-header></popup-page>\`,
          })
          export class CompliantDecoyComponent {}
          @Component({ imports: [], template: \`<main class="popup-page"></main>\` })
          export class FuturePageComponent {}
        `,
      ],
    ]);
    const graph = fixtureGraph(routes);
    const errors = validateRouteComponentGraph(graph, (path) => modules.get(path) ?? "");

    expect(errors.join("\n")).toContain("FuturePageComponent does not render the official popup-page selector");
    expect(errors.join("\n")).toContain("FuturePageComponent uses a local popup-page lookalike");
  });

  it("fails conservatively when the routed class uses an unsupported external template form", () => {
    const routes = `
      import { FuturePageComponent } from "./future-page.component";
      export const routes = [{ path: "future", component: FuturePageComponent }];
    `;
    const modules = new Map([
      [
        "/fixture/future-page.component.ts",
        `
          import { Component } from "@angular/core";
          import { PopupHeaderComponent } from "../layout/popup-header.component";
          import { PopupPageComponent } from "../layout/popup-page.component";
          @Component({
            imports: [PopupHeaderComponent, PopupPageComponent],
            templateUrl: "future-page.component.html",
          })
          export class FuturePageComponent {}
        `,
      ],
    ]);
    const graph = fixtureGraph(routes);
    const errors = validateRouteComponentGraph(graph, (path) => modules.get(path) ?? "");

    expect(errors.join("\n")).toContain("FuturePageComponent does not render the official popup-page selector");
  });

  it("validates a routed component with a literal colocated external template", () => {
    const routes = `
      import { FuturePageComponent } from "./future-page.component";
      export const routes = [{ path: "future", component: FuturePageComponent }];
    `;
    const modules = new Map([
      [
        "/fixture/future-page.component.ts",
        `
          import { Component } from "@angular/core";
          import { PopupHeaderComponent } from "../layout/popup-header.component";
          import { PopupPageComponent } from "../layout/popup-page.component";
          @Component({
            imports: [PopupHeaderComponent, PopupPageComponent],
            templateUrl: "./future-page.component.html",
          })
          export class FuturePageComponent {}
        `,
      ],
      [
        "/fixture/future-page.component.html",
        `<popup-page><popup-header slot="header"></popup-header></popup-page>`,
      ],
    ]);
    const graph = fixtureGraph(routes);

    expect(validateRouteComponentGraph(graph, (path) => modules.get(path) ?? "")).toEqual([]);
  });
});

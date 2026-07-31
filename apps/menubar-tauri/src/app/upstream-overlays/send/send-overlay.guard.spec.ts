import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  closureExclusionViolations,
  deriveTypeScriptRuntimeClosure,
} from "../../../../../../scripts/lib/typescript-runtime-closure.mjs";
import {
  buildOfficialSendAliases,
  officialSendAliasSources,
  officialSendClosureExclusions,
} from "../../../../official-send-aliases";
import {
  applyExactContinuousBlockTransforms,
  retainedTextSendFormAuthorities,
  sendTemplateContracts,
  sendTypeScriptContracts,
  validateSendTypeScriptContract,
  validateSendTypeScriptImportContract,
} from "./official-send-member-transforms";

const root = process.cwd();

const expectedOfficialSendHashes = new Map([
  ["libs/tools/send/send-ui/jest.config.js", "4aefde8db3337f1ebfea4bd746f9baa64d7f6a57beef3ba6e913bfbdbe40b22d"],
  ["libs/tools/send/send-ui/package.json", "a9381278d74cad33ff2d411519bb6c388f27f8073781deac4f2a337db1a153fc"],
  ["libs/tools/send/send-ui/project.json", "de4182f4c86c22531cfe9c36f791e1ba73d4fe8c6408619ba67ef82f795dfbe9"],
  ["libs/tools/send/send-ui/src/add-edit/send-add-edit-dialog.component.html", "63be69916b90fb3cf01ab53bfd870e97eec6cf70d1bca76604a1bb525549cab1"],
  ["libs/tools/send/send-ui/src/add-edit/send-add-edit-dialog.component.ts", "339b2f775cf7a20177e8e9f3c7d594516c577dc562ba69ef9c7148d7797a5ad9"],
  ["libs/tools/send/send-ui/src/index.ts", "085c0b4e0ec736f270b2b59c6f86005e5b1289314b4ccbca1e9ed25db4b5685a"],
  ["libs/tools/send/send-ui/src/new-send-dropdown-v2/new-send-dropdown-v2.component.html", "dddb03caa384caf6e4a4354e366a60804dc788c5519c29755607d361d4f9eae4"],
  ["libs/tools/send/send-ui/src/new-send-dropdown-v2/new-send-dropdown-v2.component.spec.ts", "a74da21a8937ddd8c2705cc769bbdf4b8ab78b513701b1150086836e48a7b00e"],
  ["libs/tools/send/send-ui/src/new-send-dropdown-v2/new-send-dropdown-v2.component.ts", "a8f23a32b2269ce9f74adff0d06e226ec151914206f007d52483c634fdc1de13"],
  ["libs/tools/send/send-ui/src/new-send-dropdown/new-send-dropdown.component.html", "f53b6765c25605ad8f5ffc5875cfda2cb1efd4cb1f377b894cc94151eb8966b2"],
  ["libs/tools/send/send-ui/src/new-send-dropdown/new-send-dropdown.component.ts", "f8987e0c3e60ffe14b9aefe0dd870e37bd5e8259ccacf02b862b8909a0749a8f"],
  ["libs/tools/send/send-ui/src/send-form/abstractions/send-form-config.service.ts", "261351dbb9678e797bdc01d79c43809ee2d10e2b53d63f9916b2e447304c73e0"],
  ["libs/tools/send/send-ui/src/send-form/abstractions/send-form-generation.service.ts", "e9be54c0014c5fe9472dd177a39e42d2763157ecdeb778edd1c111f08e8e3bd7"],
  ["libs/tools/send/send-ui/src/send-form/abstractions/send-form.service.ts", "88b207c9761f89c199254cc5e19124aaaef9534ee12c7e8ad517f8f4358acb95"],
  ["libs/tools/send/send-ui/src/send-form/components/options/send-options.component.html", "de83dc0a6e24c1bb5fd41480eeab668b674a4dd5f509f072b0824c47326d7bf4"],
  ["libs/tools/send/send-ui/src/send-form/components/options/send-options.component.spec.ts", "d75f6fff3118b5aa5518fa19a4785df7a2d05307dea0d49b523bc87514a22fbe"],
  ["libs/tools/send/send-ui/src/send-form/components/options/send-options.component.ts", "b8d23cdecd7b7df82ef54e072628b668e0fae78faf47237f5a8b10015b1b950c"],
  ["libs/tools/send/send-ui/src/send-form/components/send-details/send-details.component.html", "c352417674e54cbdf368d68a393b5f93b6397ea67b4277a13346c12fc3e11fb1"],
  ["libs/tools/send/send-ui/src/send-form/components/send-details/send-details.component.spec.ts", "af69a65feee190e0e3bf77bd15f92678ce50381f2fd35f047595284fffe06d9d"],
  ["libs/tools/send/send-ui/src/send-form/components/send-details/send-details.component.ts", "6eec99e7e0d83214b0b88cb3c55702d85ee518e0b58e89c059cfe1bc70293012"],
  ["libs/tools/send/send-ui/src/send-form/components/send-details/send-file-details.component.html", "dc57284b17629c4a147a90bc0b7a654b6716581c62df937f1df7ae4d408d2bf0"],
  ["libs/tools/send/send-ui/src/send-form/components/send-details/send-file-details.component.ts", "98778dd0ea22808712f5fafdb6b587aefe964c3418f2f002c44b1576b1faee2c"],
  ["libs/tools/send/send-ui/src/send-form/components/send-details/send-text-details.component.html", "6f618f3dea5b370c131494a945e7023b38b7038cfcf9f8a7162944bb8834893f"],
  ["libs/tools/send/send-ui/src/send-form/components/send-details/send-text-details.component.spec.ts", "f5e2cc7e7c8da2d9e83e79dbccc8b35575071ae9ff901176791a75a580824eec"],
  ["libs/tools/send/send-ui/src/send-form/components/send-details/send-text-details.component.ts", "25925ca466087bdc3604462cec5db5409f375a4dd1c0494b7ab4fe936197db8d"],
  ["libs/tools/send/send-ui/src/send-form/components/send-form.component.html", "741fc8fdd78ec0ec7902920be0144cc7c78ed17d3866f397a6d0acf09a8dc3a7"],
  ["libs/tools/send/send-ui/src/send-form/components/send-form.component.ts", "0a00f34584d04a89ec69c01746abacfb999dc30067f723801284dbfefc527de3"],
  ["libs/tools/send/send-ui/src/send-form/components/send-generator-dialog/send-generator-dialog.component.html", "3b6d57c6e7d7a4bec692039146f70e8a7f1ecc7d14022c0daa443b3208ea59b3"],
  ["libs/tools/send/send-ui/src/send-form/components/send-generator-dialog/send-generator-dialog.component.ts", "1e8de1c8a3708eea56190915706ac70cb3b4f1940eb62e254260995041ca97a4"],
  ["libs/tools/send/send-ui/src/send-form/components/unsaved-edits-dialog/unsaved-edits-dialog.component.html", "da72f7148c3fc7a517b13755f03c3f8c4ea1b9806cef43522e295ee202112189"],
  ["libs/tools/send/send-ui/src/send-form/components/unsaved-edits-dialog/unsaved-edits-dialog.component.ts", "dd6a3f401f659dadb55179cbeb30b57393dc506de4da82c44a992c5c0d83c208"],
  ["libs/tools/send/send-ui/src/send-form/index.ts", "f0351346c6dae17cfdf9cb3cb4bcaca5dcc9a9760d1f1e481aadb6e11fcf3026"],
  ["libs/tools/send/send-ui/src/send-form/send-form-container.ts", "8048192758cd9d93f9c97e4ef2668b29f8362d9815f2184f5dbbe5a929057f0a"],
  ["libs/tools/send/send-ui/src/send-form/send-form.module.ts", "4a76e9f856bff25986fa9eae2cac3a447fd2ddf77a03f6b7ad72871a0a390629"],
  ["libs/tools/send/send-ui/src/send-form/services/default-send-form-config.service.ts", "0c0873ea6187ebe6f83de76d75623ab6d87b5a1e89509b179c3d21ba556eb2a9"],
  ["libs/tools/send/send-ui/src/send-form/services/default-send-form-generation.service.ts", "c81c6348d10cfa3b697ab11e0ed681bdda6a7579381d9f95decc732eb96c7db7"],
  ["libs/tools/send/send-ui/src/send-form/services/default-send-form.service.ts", "330e42093d7132bab61a059d0e22e94fdc78515acf603590509fa817f98e959c"],
  ["libs/tools/send/send-ui/src/send-list-filters/send-list-filters.component.html", "ca9ba089ba80376bebcaebff886594352821d61a49422993d296e66917f0b326"],
  ["libs/tools/send/send-ui/src/send-list-filters/send-list-filters.component.spec.ts", "91cf93225d916ffb2314573388581d96c8bd25a4a782d3e0140ebb7f2d6fa429"],
  ["libs/tools/send/send-ui/src/send-list-filters/send-list-filters.component.ts", "b0911c397924a68d2094d23caa9e9df517a92c7774c9b070f9301c71dd6e8ca3"],
  ["libs/tools/send/send-ui/src/send-list-items-container/send-list-items-container.component.html", "550f4fd09d002e5ac80c8f45e3f62ca8949478f6ff2a03ca77902eff58bc5e02"],
  ["libs/tools/send/send-ui/src/send-list-items-container/send-list-items-container.component.spec.ts", "489b42ff5c76a42aece228eb08a26c8b6192770cd91ef9296eb118243b8336b0"],
  ["libs/tools/send/send-ui/src/send-list-items-container/send-list-items-container.component.ts", "e341b2b8bfec76b52003a91186e05dcfee16ec9e403be658d18ac4d189c8a24b"],
  ["libs/tools/send/send-ui/src/send-list/send-list.component.html", "ff7a5f145f533bdcf99a8c3ec4dcc56e6915ca2d1e28f15716e3a1a93325773f"],
  ["libs/tools/send/send-ui/src/send-list/send-list.component.spec.ts", "63a5417599e5a6ab86397e41c4eeefc62875e784eac18c794b520145d572fdd5"],
  ["libs/tools/send/send-ui/src/send-list/send-list.component.ts", "34992501db328590360fa2dc4b9e935ce399afa3451757da4e5a17dba8c03aac"],
  ["libs/tools/send/send-ui/src/send-search/send-search.component.html", "248d456160a7979bf223f41d1c35ac91980fdd10766b1a073e36715729edf9b3"],
  ["libs/tools/send/send-ui/src/send-search/send-search.component.ts", "d352b96ed5a73ca34d3164bf8d9cd9b3c211ddb6dd2be18fbd16a99f15bbd905"],
  ["libs/tools/send/send-ui/src/send-table/send-table.component.html", "8277d44fe3646925e23962dd76905484232b9875f397218418fce23a429be9c6"],
  ["libs/tools/send/send-ui/src/send-table/send-table.component.stories.ts", "afe4215ff223c70627df9d48a598f7a76b64755fe168ff75f350768825844e66"],
  ["libs/tools/send/send-ui/src/send-table/send-table.component.ts", "b6cf36167f8651152a5d70680a2cae66752d80ee903989f3b49031060a488e3c"],
  ["libs/tools/send/send-ui/src/services/send-items.service.spec.ts", "5131c76c83eedfd2688e913aa433d28d7b717fb81f80ade02cce9ce9ac487a53"],
  ["libs/tools/send/send-ui/src/services/send-items.service.ts", "ae65334edf09bf368c066121a15dce1195cca7c0b98693cd618c1e197a6d88dd"],
  ["libs/tools/send/send-ui/src/services/send-list-filters.service.spec.ts", "bdb909a447a891a3a51503e70b0160c0d8fdb7d287064d33f99330909843644b"],
  ["libs/tools/send/send-ui/src/services/send-list-filters.service.ts", "1bdc298523e34b44c75d8e5a2f2a7a61b9cc601fd0563cdd204905f98d88117b"],
  ["libs/tools/send/send-ui/src/services/send-policy.service.spec.ts", "4dafa0474e4c4db76426ce91e1a8967f43a271caec1daf950bf3eae65754833d"],
  ["libs/tools/send/send-ui/src/services/send-policy.service.ts", "9790404bd18e81657fd0e314828b229ac9a758f958318b6ee58185185fc0dcaf"],
  ["libs/tools/send/send-ui/test.setup.ts", "ed9064dc6ed872c78fdd7a94179ad566d489d3017654fb86a6bd7366f80279d7"],
  ["libs/tools/send/send-ui/tsconfig.json", "71e9fe857a332eea88403bd7e9c3e03073a4509ec5684b8f642e09722b5f9adc"],
  ["libs/tools/send/send-ui/tsconfig.spec.json", "5441d8d14fa896eb1b6eac7f89b5d2258c2bb08405825e7983363bf11c8e46e6"],
  ["apps/browser/src/tools/popup/send-v2/send-v2.component.ts", "84544c71f1eba031a1e1e9867e95836b89f01c9b9fa03f758365394b19834ef3"],
  ["apps/browser/src/tools/popup/send-v2/send-v2.component.html", "43e955124658d0c0b4d7683557ac119950c63df500b854e73da83a022ffb2e82"],
  ["apps/browser/src/tools/popup/send-v2/add-edit/send-add-edit.component.ts", "5da4021ac7001642173b7e7ae8771adf67b8e50590ca7d6c88d720d67f9823de"],
  ["apps/browser/src/tools/popup/send-v2/add-edit/send-add-edit.component.html", "a2730a0d91b19ac28e272471d02c6a1244d1c0bfff2399e3881ba78b63c3f803"],
  ["apps/browser/src/tools/popup/send-v2/send-created/send-created.component.ts", "84f5fa48f78a9b9d52189fb43812ed7bd638f17e9f9f0f77d057a0911e27e5ae"],
  ["apps/browser/src/tools/popup/send-v2/send-created/send-created.component.html", "9770325116224a4b10722b54ceb001ea6e1436223d56ebd527190b1e24eb9e88"],
] as const);

const officialSendAuthorityPaths = [...expectedOfficialSendHashes.keys()];

describe("guarded official Text Send source", () => {
  it("pins the complete official Send UI authority", () => {
    expect(read("vendor/bitwarden-clients/UI_SOURCE_COMMIT").trim()).toBe(
      "f47b6946e01aed474875789081966d311d5b8289",
    );
    for (const path of officialSendAuthorityPaths) {
      expect(existsSync(resolve(root, "vendor/bitwarden-clients", path)), path).toBe(true);
      expect(sha(`vendor/bitwarden-clients/${path}`)).toBe(expectedOfficialSendHashes.get(path));
    }
  });

  it("declares only exact local Send overlay aliases and closure exclusions", () => {
    expect(officialSendAliasSources).toEqual([
      ["@bitwarden/send-overlay/list", "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.ts"],
      ["@bitwarden/send-overlay/list-items", "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list-items-container.component.ts"],
      ["@bitwarden/send-overlay/add-edit", "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-add-edit.component.ts"],
      ["@bitwarden/send-overlay/created", "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-created.component.ts"],
    ]);
    expect(officialSendClosureExclusions).toEqual([
      { id: "file-send", pattern: "send-file|SendFile|FileReader|upload.*send|download.*send", flags: "i" },
      { id: "premium-billing", pattern: "Billing|PremiumUpgrade|hasPremiumFromAnySource", flags: "i" },
      {
        id: "organization-admin",
        pattern: "OrganizationService|allowedDomains|SpecificPeople",
        flags: "i",
        ignoredContentPaths: ["vendor/bitwarden-clients/apps/browser/src/_locales/en/messages.json"],
      },
      {
        id: "browser-runtime",
        pattern: "CurrentAccount|PopOutComponent|nativeMessaging|webRequest|webNavigation|contentScript|browser\\.tabs|chrome\\.tabs",
        flags: "i",
        ignoredContentPaths: ["vendor/bitwarden-clients/apps/browser/src/_locales/en/messages.json"],
      },
      {
        id: "sso",
        pattern: "@bitwarden/auth/sso|singleSignOn",
        flags: "i",
        ignoredContentPaths: ["vendor/bitwarden-clients/apps/browser/src/_locales/en/messages.json"],
      },
    ]);
    for (const alias of buildOfficialSendAliases(root)) {
      const specifier = officialSendAliasSources.find(([, source]) =>
        resolve(root, source) === alias.replacement)?.[0];
      expect(specifier).toBeDefined();
      expect(alias.find.test(specifier!)).toBe(true);
      expect(alias.find.test(`${specifier!}/sibling`)).toBe(false);
    }
  });

  it("rejects semantic TypeScript errors in the checked Send authority", () => {
    const upstreamConfig = JSON.parse(
      read("apps/menubar-tauri/tsconfig.official-send-upstream.json"),
    ) as {
      compilerOptions?: { noCheck?: boolean };
      files?: string[];
    };
    expect(upstreamConfig.compilerOptions?.noCheck).not.toBe(true);
    expect(upstreamConfig.files).toEqual([
      "../../vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/abstractions/send-form-generation.service.ts",
      "official-send-upstream.compatibility.ts",
    ]);

    const directory = mkdtempSync(resolve(tmpdir(), "official-send-typecheck-"));
    const authority = resolve(
      root,
      "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/abstractions/send-form-generation.service.ts",
    );
    const probe = resolve(directory, "send-form-generation.service.ts");
    const config = resolve(directory, "tsconfig.json");

    try {
      writeFileSync(probe, `${readFileSync(authority, "utf8")}\nconst semanticProbe: string = 1;\n`);
      writeFileSync(
        config,
        JSON.stringify({
          extends: resolve(root, "apps/menubar-tauri/tsconfig.official-send-upstream.json"),
          compilerOptions: { noEmit: true },
          files: [probe],
          include: [],
        }),
      );

      const result = spawnSync(
        resolve(root, "node_modules/.bin/tsc"),
        ["-p", config, "--pretty", "false"],
        {
          cwd: root,
          encoding: "utf8",
        },
      );

      expect(result.status).toBe(2);
      expect(`${result.stdout}${result.stderr}`).toContain("error TS2322");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("exact-applies every retained Send template transform", () => {
    expect(sendTemplateContracts.map(({ runtime }) => runtime)).toEqual([
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.html",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list-items-container.component.html",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-created.component.html",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-details.component.html",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-text-details.component.html",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-options.component.html",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-add-edit.component.html",
    ]);
    for (const contract of sendTemplateContracts) {
      const authority = read(`vendor/bitwarden-clients/${contract.authority}`);
      expect(applyExactContinuousBlockTransforms(authority, contract), contract.runtime).toBe(
        read(contract.runtime),
      );
    }
  });

  it("executes complete Task 4 TypeScript member and import transforms", () => {
    expect(sendTypeScriptContracts.map(({ runtime }) => runtime)).toEqual([
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list-items-container.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-created.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-details.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-text-details.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-options.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-add-edit.component.ts",
    ]);
    for (const contract of sendTypeScriptContracts) {
      const authority = read(`vendor/bitwarden-clients/${contract.authority}`);
      const runtime = read(contract.runtime);
      expect(validateSendTypeScriptContract(authority, runtime, contract), contract.runtime)
        .toEqual([]);
      expect(validateSendTypeScriptImportContract(authority, runtime, contract), contract.runtime)
        .toEqual([]);

      const mutation = runtime.replace(contract.mutationSearch, contract.mutationReplacement);
      expect(mutation, `${contract.runtime} mutation probe`).not.toBe(runtime);
      expect(validateSendTypeScriptContract(authority, mutation, contract), contract.runtime)
        .not.toEqual([]);

      const maliciousInterior = runtime.replace(
        contract.mutationSearch,
        `readonly maliciousAuthorityBypass = "replacement accepted by name-only checks";\n  ${contract.mutationSearch}`,
      );
      expect(maliciousInterior, `${contract.runtime} malicious probe`).not.toBe(runtime);
      expect(
        validateSendTypeScriptContract(authority, maliciousInterior, contract),
        `${contract.runtime} exact source fidelity`,
      ).not.toEqual([]);
    }
  });

  it("uses only static bounded Task 4 transforms independent of runtime targets", () => {
    const transformSource = read(
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-member-transforms.ts",
    );
    expect(transformSource).not.toMatch(/(?:addEdit|details|options|textDetails)Runtime/);
    expect(transformSource).not.toContain("exactContinuousProjection");

    for (const contract of sendTemplateContracts.slice(-4)) {
      expect(contract.transforms.length, contract.runtime).toBeGreaterThan(1);
      expect(
        contract.transforms.every(({ search }) => search.length < read(`vendor/bitwarden-clients/${contract.authority}`).length),
        contract.runtime,
      ).toBe(true);
    }
  });

  it("requires Task 4 Text form authorities and generated overlays", () => {
    expect(retainedTextSendFormAuthorities).toEqual([
      "libs/tools/send/send-ui/src/send-form/components/send-details/send-details.component.html",
      "libs/tools/send/send-ui/src/send-form/components/send-details/send-text-details.component.html",
      "libs/tools/send/send-ui/src/send-form/components/options/send-options.component.html",
      "apps/browser/src/tools/popup/send-v2/add-edit/send-add-edit.component.html",
    ]);
    for (const file of [
      "official-send-details.component.ts",
      "official-send-details.component.html",
      "official-send-text-details.component.ts",
      "official-send-text-details.component.html",
      "official-send-options.component.ts",
      "official-send-options.component.html",
      "official-send-add-edit.component.ts",
      "official-send-add-edit.component.html",
    ]) {
      expect(existsSync(resolve(root, "apps/menubar-tauri/src/app/upstream-overlays/send", file)), file).toBe(true);
    }
  });

  it("keeps route hosts structurally thin", () => {
    expect(read("apps/menubar-tauri/src/app/send/send-page.component.ts"))
      .not.toMatch(/bit-item|bit-search|bit-no-items|bit-skeleton/);
    expect(read("apps/menubar-tauri/src/app/send/send-created-page.component.ts"))
      .not.toMatch(/createdSendSuccessfully|bit-svg|popup-footer/);
    expect(read("apps/menubar-tauri/src/app/send/send-add-edit-page.component.ts"))
      .not.toMatch(/bit-card|bit-form-field|popup-footer|要分享的文本/);
  });

  it("uses the real official component aliases for the local typecheck", () => {
    const config = JSON.parse(read("apps/menubar-tauri/tsconfig.official-send.json")) as {
      compilerOptions?: { paths?: Record<string, readonly string[]> };
      files?: string[];
    };
    expect(config.compilerOptions?.paths).toBeUndefined();
    expect(config.files).not.toContain("official-send-local.compatibility.ts");
    expect(() => read("apps/menubar-tauri/official-send-local.compatibility.ts")).toThrow();
    expect(config.files).toEqual(expect.arrayContaining([
      "src/app/upstream-overlays/send/official-send-created.component.ts",
      "src/app/upstream-overlays/send/official-send-list-items-container.component.ts",
      "src/app/upstream-overlays/send/official-send-list.component.ts",
    ]));
  });

  it("pins and enforces the production runtime closure without unrelated bundle scans", () => {
    const manifest = readManifest();
    const closure = deriveTypeScriptRuntimeClosure({
      root,
      roots: manifest.productionClosure.roots,
    });
    expect(closure.paths).toEqual(manifest.productionClosure.paths);
    expect(closure.edges).toEqual(manifest.productionClosure.edges);
    expect(sha256(JSON.stringify({ paths: closure.paths, edges: closure.edges }))).toBe(
      manifest.productionClosure.sha256,
    );
    expect(closureExclusionViolations(closure, officialSendClosureExclusions)).toEqual([]);
  });

  it("rejects a forbidden runtime dependency from the Task 3 graph", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "official-send-closure-"));
    try {
      writeFileSync(resolve(directory, "tsconfig.json"), "{}");
      writeFileSync(resolve(directory, "entry.ts"), 'import "./send-file";');
      writeFileSync(resolve(directory, "send-file.ts"), "export const retained = true;");
      const closure = deriveTypeScriptRuntimeClosure({ root: directory, roots: ["entry.ts"] });
      expect(closureExclusionViolations(closure, officialSendClosureExclusions)).toEqual([
        "file-send:content:entry.ts",
        "file-send:edge:entry.ts->./send-file",
        "file-send:path:send-file.ts",
      ]);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("records deterministic Send authority, runtime, alias, transform, and closure ownership", () => {
    const manifest = readManifest();
    expect(manifest.authorities).toEqual([...manifest.authorities].sort(byPath));
    expect(manifest.localRuntimes).toEqual([...manifest.localRuntimes].sort(byPath));
    for (const runtime of manifest.localRuntimes) {
      expect(runtime.sha256, runtime.path).toBe(sha(runtime.path));
    }
    expect(manifest.aliases).toEqual([...manifest.aliases].sort((a, b) => a.specifier.localeCompare(b.specifier)));
    expect(manifest.transformContract.sha256).toBe(sha(manifest.transformContract.path));
    expect(manifest.productionRoots).toEqual([
      "apps/menubar-tauri/src/app/send/send-add-edit-page.component.ts",
      "apps/menubar-tauri/src/app/send/send-created-page.component.ts",
      "apps/menubar-tauri/src/app/send/send-page.component.ts",
    ]);
    expect(manifest.forbiddenClosureRules).toEqual(officialSendClosureExclusions);
  });
});

type SendManifest = {
  authorities: { path: string; sha256: string }[];
  localRuntimes: { path: string; sha256: string }[];
  aliases: { specifier: string; source: string }[];
  transformContract: { path: string; sha256: string };
  productionRoots: string[];
  forbiddenClosureRules: { id: string; pattern: string; flags: string }[];
  productionClosure: {
    roots: string[];
    paths: string[];
    edges: { from: string; kind: string; specifier: string; target: string | null }[];
    sha256: string;
  };
};

function readManifest(): SendManifest {
  return JSON.parse(read(
    "apps/menubar-tauri/src/app/upstream-overlays/send/official-send.transform-manifest.json",
  )) as SendManifest;
}

function byPath(left: { path: string }, right: { path: string }): number {
  return left.path.localeCompare(right.path);
}

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function sha(path: string): string {
  return createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { officialGeneratorAliasSources } from "../../../../official-generator-aliases";
import {
  applyExactContinuousBlockTransforms,
  generatorTemplateContracts,
  officialGeneratorHistoryDeletedAuthorityMembers,
  validateOfficialEmptyGeneratorHistoryMemberTransforms,
  validateOfficialGeneratorHistoryParentMemberTransforms,
  validateOfficialGeneratorHistoryRowsMemberTransforms,
} from "./official-generator-member-transforms";

const root = process.cwd();
const overlay = join(root, "apps/menubar-tauri/src/app/upstream-overlays/generator");

const authorities = {
  popupTs: {
    path: "apps/browser/src/tools/popup/generator/credential-generator-history.component.ts",
    sha256: "135ed3e3f83612bdeb0f03df5db0b4dadddfddd178098b6ae0b40e74d1131bfd",
  },
  popupHtml: {
    path: "apps/browser/src/tools/popup/generator/credential-generator-history.component.html",
    sha256: "71d92f22dbfbfc72db18a85f97d526228b4e31e60609dd4a05c8c2ee48fabdc8",
  },
  rowsTs: {
    path: "libs/tools/generator/components/src/credential-generator-history.component.ts",
    sha256: "def6a043801b7a02f97c9f7dfc59a4b84732692e9df26489a46a3614a55ffe0b",
  },
  rowsHtml: {
    path: "libs/tools/generator/components/src/credential-generator-history.component.html",
    sha256: "2eef6e1fcc3d03b4685dacff58e9b7afb5204ac62038372f942e21c4b65a28b7",
  },
  emptyTs: {
    path: "libs/tools/generator/components/src/empty-credential-history.component.ts",
    sha256: "f4eed1dd01f5983b6d961e324b6d18010afcd82962352f501e3bf1ec5b16fd65",
  },
  emptyHtml: {
    path: "libs/tools/generator/components/src/empty-credential-history.component.html",
    sha256: "84f3c4f1a1f8d0288bec387047b7233b9ec039cff39d3b788ab29ee93b1e616e",
  },
} as const;

describe("M11 source-direct official Generator history", () => {
  it("pins all three official history authorities and their templates", () => {
    for (const authority of Object.values(authorities)) {
      const source = readFileSync(join(root, "vendor/bitwarden-clients", authority.path));
      expect(createHash("sha256").update(source).digest("hex"), authority.path).toBe(
        authority.sha256,
      );
    }
  });

  it("declares exact aliases for the transformed popup parent, rows, and empty state", () => {
    const aliases = Object.fromEntries(officialGeneratorAliasSources);

    expect(aliases["@bitwarden/generator-overlay/credential-generator-history"]).toBe(
      "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history.component.ts",
    );
    expect(aliases["@bitwarden/generator-overlay/credential-generator-history-rows"]).toBe(
      "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history-rows.component.ts",
    );
    expect(aliases["@bitwarden/generator-overlay/empty-credential-history"]).toBe(
      "apps/menubar-tauri/src/app/upstream-overlays/generator/official-empty-generator-history.component.ts",
    );
  });

  it("retains separate production runtimes for the official parent, rows, and empty state", () => {
    for (const file of [
      "official-generator-history.component.ts",
      "official-generator-history.component.html",
      "official-generator-history-rows.component.ts",
      "official-generator-history-rows.component.html",
      "official-empty-generator-history.component.ts",
      "official-empty-generator-history.component.html",
    ]) {
      expect(existsSync(join(overlay, file)), file).toBe(true);
    }
  });

  it("makes the local route a thin owner of only the retained popup parent", () => {
    const route = readFileSync(
      join(root, "apps/menubar-tauri/src/app/generator/generator-history-page.component.ts"),
      "utf8",
    );

    expect(route).toContain('template: "<bw-official-generator-history />"');
    expect(route).not.toMatch(/generator-history-row|bit-no-items|popup-footer|<dialog/);
  });

  it("exact-transforms complete parent/row members and directly retains the empty class", () => {
    expect(officialGeneratorHistoryDeletedAuthorityMembers).toEqual({
      parent: ["account", "debug", "log", "ngOnChanges"],
      rows: ["debug", "log"],
    });
    const cases = [
      [
        authorities.popupTs.path,
        "official-generator-history.component.ts",
        validateOfficialGeneratorHistoryParentMemberTransforms,
        "this.history.destroy();",
      ],
      [
        authorities.rowsTs.path,
        "official-generator-history-rows.component.ts",
        validateOfficialGeneratorHistoryRowsMemberTransforms,
        "this.historyView.copy(credential)",
      ],
      [
        authorities.emptyTs.path,
        "official-empty-generator-history.component.ts",
        validateOfficialEmptyGeneratorHistoryMemberTransforms,
        "noCredentialsIcon = NoCredentialsIcon",
      ],
    ] as const;

    for (const [authorityPath, runtimeFile, validate, mutationTarget] of cases) {
      const authority = readFileSync(join(root, "vendor/bitwarden-clients", authorityPath), "utf8");
      const runtime = readFileSync(join(overlay, runtimeFile), "utf8");
      expect(validate(authority, runtime), runtimeFile).toEqual([]);
      expect(validate(authority, runtime.replace(mutationTarget, "mutatedHistoryMember")), runtimeFile)
        .not.toEqual([]);
    }
  });

  it("exact-applies the official popup, row, and empty templates", () => {
    const historyContracts = generatorTemplateContracts.filter(({ authority }) =>
      authority.includes("credential-generator-history") || authority.includes("empty-credential-history"));
    expect(historyContracts).toHaveLength(3);

    for (const contract of historyContracts) {
      const authority = readFileSync(
        join(root, "vendor/bitwarden-clients", contract.authority),
        "utf8",
      );
      const runtime = readFileSync(join(root, contract.runtime), "utf8");
      expect(applyExactContinuousBlockTransforms(authority, contract), contract.runtime).toBe(runtime);
    }
  });
});

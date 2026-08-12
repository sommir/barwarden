import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { OfficialI18nService, type OfficialLocale } from "./official-i18n.service";

const appRoot = join(process.cwd(), "apps/menubar-tauri/src/app");
const excludedPathFragments = [
  "/evidence/",
  "/runtime-patches/",
  "/source-patches/",
];
const excludedFilePatterns = [
  /\.spec\.ts$/u,
  /\.json$/u,
  /evidence-preview/u,
  /member-transforms\.ts$/u,
  /official-i18n\.service\.ts$/u,
  /vault-demo\.ts$/u,
];
const intentionalInternalChinese = new Map<string, readonly RegExp[]>([
  [
    "vault/vault-list-page.component.ts",
    [/\/\(\?:unable\|failed\|failure\|error\|无法\|失败\|错误\)\//u],
  ],
  [
    "official-ui/app-status-feedback-bridge.service.ts",
    [
      /\/\(\?:无法\|失败\|错误\|不可用\|需要恢复\|请重试\|unable/u,
      /\/\(\?:已\|完成\|成功\|copied\|saved/u,
    ],
  ],
  [
    "official-ui/local-copy-feedback.service.ts",
    [/\/\(\?:复制\|copy\)\//u],
  ],
  [
    "official-ui/accessibility-permission-dialog.service.ts",
    [/^export const ACCESSIBILITY_PERMISSION_STATUS = /u],
  ],
]);

describe("official UI internationalization source audit", () => {
  it("keeps update actions concise and equivalent in both locales", async () => {
    const i18n = new OfficialI18nService();

    await i18n.setLocale("zh-CN");
    expect(i18n.t("i18nCurrentVersion", "0.2.0")).toBe("当前版本 0.2.0");
    expect(i18n.t("i18nViewUpdate")).toBe("查看更新");
    expect(i18n.t("i18nUpdateAndRestart")).toBe("更新并重新启动");

    await i18n.setLocale("en-US");
    expect(i18n.t("i18nCurrentVersion", "0.2.0")).toBe("Current version 0.2.0");
    expect(i18n.t("i18nViewUpdate")).toBe("View update");
    expect(i18n.t("i18nUpdateAndRestart")).toBe("Update and restart");

    await i18n.setLocale("zh-CN");
  });

  it("keeps visible Chinese copy in the translation catalog", () => {
    const violations = sourceFiles(appRoot).flatMap((path) => {
      const relativePath = relative(appRoot, path);
      if (
        excludedPathFragments.some((fragment) => `/${relativePath}`.includes(fragment))
        || excludedFilePatterns.some((pattern) => pattern.test(relativePath))
      ) {
        return [];
      }

      return readFileSync(path, "utf8")
        .split(/\r?\n/u)
        .map((line, index) => ({ line, lineNumber: index + 1 }))
        .filter(({ line }) => /[\u3400-\u9fff]/u.test(line))
        .filter(({ line }) =>
          !(intentionalInternalChinese.get(relativePath) ?? [])
            .some((pattern) => pattern.test(line)),
        )
        .map(({ line, lineNumber }) => `${relativePath}:${lineNumber}: ${line.trim()}`);
    });

    expect(violations).toEqual([]);
  });

  it("resolves every literal production translation key in both supported locales", async () => {
    const keys = new Set(
      sourceFiles(appRoot)
        .filter((path) => !path.endsWith(".spec.ts"))
        .flatMap((path) => {
          const source = readFileSync(path, "utf8");
          return [
            ...source.matchAll(
              /(["'])([A-Za-z][A-Za-z0-9_.-]*)\1\s*\|\s*i18n\b/gu,
            ),
            ...source.matchAll(
              /(?:translateOfficialMessage|\.t)\(\s*(["'])([A-Za-z][A-Za-z0-9_.-]*)\1/gu,
            ),
          ];
        })
        .map((match) => match[2]!),
    );
    const i18n = new OfficialI18nService();
    const failures: string[] = [];

    try {
      for (const locale of ["zh-CN", "en-US"] satisfies OfficialLocale[]) {
        await i18n.setLocale(locale);
        for (const key of keys) {
          try {
            i18n.t(key, 1, 2, 3);
          } catch {
            failures.push(`${locale}: ${key}`);
          }
        }
      }
    } finally {
      await i18n.setLocale("zh-CN");
    }

    expect(failures).toEqual([]);
  });

  it("does not leave static English UI attributes outside the translation catalog", () => {
    const violations = sourceFiles(appRoot)
      .filter((path) => !path.endsWith(".spec.ts"))
      .filter((path) => !path.includes("/generated/"))
      .filter((path) => !path.endsWith("member-transforms.ts"))
      .flatMap((path) =>
        readFileSync(path, "utf8")
          .split(/\r?\n/u)
          .map((line, index) => ({ line, lineNumber: index + 1 }))
          .flatMap(({ line, lineNumber }) => {
            const match = /(?<!\[)(?:title|placeholder|aria-label|label)="([^"]*[A-Za-z][^"]*)"/u.exec(line);
            return match && !match[1].includes("{{") && !/^https?:\/\//u.test(match[1])
              ? [`${relative(appRoot, path)}:${lineNumber}: ${match[1]}`]
              : [];
          }),
      );

    expect(violations).toEqual([]);
  });

  it("does not pass static English copy to production feedback sinks", () => {
    const violations = sourceFiles(appRoot)
      .filter((path) => !path.endsWith(".spec.ts"))
      .filter((path) => !path.includes("/evidence/"))
      .filter((path) => !path.endsWith("member-transforms.ts"))
      .filter((path) => !path.endsWith("official-i18n.service.ts"))
      .flatMap((path) =>
        readFileSync(path, "utf8")
          .split(/\r?\n/u)
          .map((line, index) => ({ line, lineNumber: index + 1 }))
          .filter(({ line }) =>
            /(?:setStatus|setSyncError|setLoginError)\(\s*["'][A-Z][^"']*["']/u.test(line)
              || /(?:showToast|\.show)\(\{[^}]*\bmessage:\s*["'][A-Z][^"']*["']/u.test(line),
          )
          .map(({ line, lineNumber }) => `${relative(appRoot, path)}:${lineNumber}: ${line.trim()}`),
      );

    expect(violations).toEqual([]);
  });
});

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(?:html|ts)$/u.test(name)
        ? [path]
        : [];
  });
}

import { describe, expect, it } from "vitest";

import {
  OfficialI18nService,
  resolveOfficialLocale,
  translateOfficialMessage,
} from "./official-i18n.service";

describe("resolveOfficialLocale", () => {
  it.each(["zh", "zh-CN", "zh-TW"])('uses Simplified Chinese for %s', (language) => {
    expect(resolveOfficialLocale(language)).toBe("zh-CN");
  });

  it.each(["en-US", "fr-FR", undefined, null, 42])('uses English for %p', (language) => {
    expect(resolveOfficialLocale(language)).toBe("en-US");
  });
});

describe("OfficialI18nService", () => {
  it("switches between English and Simplified Chinese catalogs", async () => {
    const i18n = new OfficialI18nService();
    const locales: string[] = [];
    const subscription = i18n.locale$.subscribe((locale) => locales.push(locale));

    await i18n.setLocale("en-US");
    expect(i18n.translationLocale).toBe("en-US");
    expect(i18n.t("save")).toBe("Save");

    await i18n.setLocale("zh-CN");
    expect(i18n.translationLocale).toBe("zh-CN");
    expect(i18n.t("save")).toBe("保存");
    expect(locales.slice(-2)).toEqual(["en-US", "zh-CN"]);

    subscription.unsubscribe();
  });

  it("uses the vendored English wording for upstream translation keys", async () => {
    const i18n = new OfficialI18nService();

    await i18n.setLocale("en-US");

    expect(i18n.t("add")).toBe("Add");
    expect(i18n.t("inputRequired")).toBe("Input is required.");
    expect(i18n.t("i18nPreviousSearchResult")).toBe("Previous search result");
    expect(i18n.t("i18nNextSearchResult")).toBe("Next search result");
    await i18n.setLocale("zh-CN");
    expect(i18n.t("i18nPreviousSearchResult")).toBe("上一个搜索结果");
    expect(i18n.t("i18nNextSearchResult")).toBe("下一个搜索结果");
  });

  it("shares an explicit locale across component-scoped service instances", async () => {
    const applicationI18n = new OfficialI18nService();
    const componentI18n = new OfficialI18nService();

    await applicationI18n.setLocale("en-US");

    expect(componentI18n.translationLocale).toBe("en-US");
    expect(componentI18n.t("save")).toBe("Save");
    await applicationI18n.setLocale("zh-CN");
  });

  it("exposes the active locale to non-Angular services and adapters", async () => {
    const i18n = new OfficialI18nService();

    await i18n.setLocale("en-US");
    expect(translateOfficialMessage("save")).toBe("Save");

    await i18n.setLocale("zh-CN");
    expect(translateOfficialMessage("save")).toBe("保存");
  });

  it("translates surrounding labels without changing user-provided names", async () => {
    const i18n = new OfficialI18nService();
    const userItemName = "我的登录";

    await i18n.setLocale("en-US");

    expect(translateOfficialMessage("i18nViewItem", userItemName)).toBe(
      "View item 我的登录",
    );
    await i18n.setLocale("zh-CN");
  });

  it("rejects an unsupported explicit locale", async () => {
    const i18n = new OfficialI18nService();

    await expect(i18n.setLocale("fr-FR")).rejects.toThrow(
      "Unsupported official UI locale: fr-FR",
    );
  });
});

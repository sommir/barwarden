import { afterEach, describe, expect, it } from "vitest";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { PopupStateStore } from "../popup-state";
import { demoFolders, demoVaultItems } from "../vault-demo";
import { VaultFacade } from "./vault.facade";

describe("VaultFacade", () => {
  afterEach(async () => {
    await new OfficialI18nService().setLocale("zh-CN");
  });

  it("derives loading, unavailable, and stale Vault main states", () => {
    const store = new PopupStateStore();
    const facade = new VaultFacade(store);

    store.beginVaultSync();
    expect(facade.vaultState()).toBe("loading");
    store.failVaultSync(false);
    expect(facade.vaultState()).toBe("unavailable");
    store.setItems([demoVaultItems[0]], demoFolders);
    store.failVaultSync(true);
    expect(facade.vaultState()).toBe("stale");
  });

  it("builds source-correct vault sections and counts without browser suggestions", () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems, demoFolders);
    const facade = new VaultFacade(store);

    expect(facade.sections().map((section) => [section.id, section.title])).toEqual([
      ["favorites", "收藏夹"],
      ["all-items", "所有项目"],
    ]);

    expect(facade.sections().map((section) => [section.id, section.items.length])).toEqual([
      ["favorites", 2],
      ["all-items", 4],
    ]);
    expect(facade.filteredItems().some((item) => item.type === "ssh-key")).toBe(false);
    expect(store.snapshot().items.some((item) => item.type === "ssh-key")).toBe(true);
    expect(facade.availableTypeFilters().some((type) => type.id === "ssh-key")).toBe(false);
  });

  it("projects reliable current-site matches into the existing suggestion section", () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems, demoFolders);
    const facade = new VaultFacade(store);

    expect(facade.websiteSuggestionSection(null)).toBeNull();
    expect(facade.websiteSuggestionSection("https://github.com/settings/profile")).toEqual({
      id: "autofill-suggestions",
      title: "自动填充建议",
      description: "",
      items: [demoVaultItems[0]],
      count: 1,
      showFill: false,
      collapsible: true,
      forcedOpen: false,
    });
  });

  it("caches website ranking until its URL, items, filters, or locale change", async () => {
    const i18n = new OfficialI18nService();
    await i18n.setLocale("zh-CN");
    const store = new PopupStateStore();
    store.setItems(demoVaultItems, demoFolders);
    const facade = new VaultFacade(store);
    const url = "https://github.com/settings/profile";

    const first = facade.websiteSuggestionSection(url);
    expect(facade.websiteSuggestionSection(url)).toBe(first);
    expect(facade.websiteSuggestionSection("https://github.com/issues")).not.toBe(first);

    const beforeFilter = facade.websiteSuggestionSection(url);
    facade.setFolderFilter("work");
    expect(facade.websiteSuggestionSection(url)).not.toBe(beforeFilter);

    const beforeLocale = facade.websiteSuggestionSection(url);
    await i18n.setLocale("en-US");
    expect(facade.websiteSuggestionSection(url)).not.toBe(beforeLocale);
  });

  it("suppresses website suggestions during search and applies vault filters", () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems, demoFolders);
    const facade = new VaultFacade(store);
    const url = "https://github.com/settings/profile";

    facade.setSearch("git");
    expect(facade.websiteSuggestionSection(url)).toBeNull();
    facade.resetSearch();
    facade.setTypeFilter("card");
    expect(facade.websiteSuggestionSection(url)).toBeNull();
    facade.setTypeFilter("login");
    facade.setFolderFilter("personal");
    expect(facade.websiteSuggestionSection(url)).toBeNull();
    facade.setFolderFilter("work");
    expect(facade.websiteSuggestionSection(url)?.items.map(({ id }) => id)).toEqual(["github"]);
  });

  it("invalidates translated section and hierarchy caches when the locale changes", async () => {
    const i18n = new OfficialI18nService();
    await i18n.setLocale("zh-CN");
    const store = new PopupStateStore();
    store.setItems(demoVaultItems, demoFolders);
    const facade = new VaultFacade(store);

    const chineseSections = facade.sections();
    const chineseHierarchy = facade.hierarchy();
    expect(chineseHierarchy.map((node) => node.title)).toContain("所有项目");

    await i18n.setLocale("en-US");

    expect(facade.sections()).not.toBe(chineseSections);
    expect(facade.sections().map((section) => section.title)).toEqual(["Favorites", "All items"]);
    expect(facade.hierarchy()).not.toBe(chineseHierarchy);
    expect(facade.hierarchy().map((node) => node.title)).toEqual([
      "Favorites",
      "All items",
      "Type",
      "Folders",
      "No folder",
      "Hidden items",
    ]);
  });

  it("applies type and query filters to the filtered item list and state", () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems, demoFolders);
    const facade = new VaultFacade(store);

    facade.setTypeFilter("card");
    expect(facade.filteredItems().every((item) => item.type === "card")).toBe(true);

    facade.setSearch("no-such-item");
    expect(facade.vaultState()).toBe("no-results");
  });

  it("normalizes a null search value before deriving vault state", () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems, demoFolders);
    const facade = new VaultFacade(store);

    facade.setSearch(null);

    expect(facade.queryValue()).toBe("");
    expect(facade.vaultState()).toBe("ready");
    expect(facade.sections().map((section) => section.id)).toEqual(["favorites", "all-items"]);
  });

  it("folds matching items into one official search results section when searching", () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems, demoFolders);
    const facade = new VaultFacade(store);

    facade.setSearch("git");

    expect(facade.sections().map((section) => [section.id, section.title, section.items.length])).toEqual([
      ["search-results", "搜索结果", 1],
    ]);
    expect(facade.sections()[0]).toMatchObject({ forcedOpen: true });
  });

  it("forces searched and filtered sections open without changing collapse preferences", () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems, demoFolders);
    store.toggleVaultSection("favorites");
    store.toggleVaultSection("all-items");
    const facade = new VaultFacade(store);

    facade.setSearch("git");
    expect(facade.sections()).toEqual([
      expect.objectContaining({ id: "search-results", forcedOpen: true }),
    ]);
    facade.resetSearch();
    facade.setTypeFilter("login");
    expect(facade.sections().every((section) => section.forcedOpen)).toBe(true);
    expect(store.snapshot().collapsedVaultSectionIds).toEqual(["favorites", "all-items"]);
  });

  it("renames the all-items section to items when popup filters are applied", () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems, demoFolders);
    const facade = new VaultFacade(store);

    facade.setTypeFilter("login");

    expect(facade.sections().find((section) => section.id === "all-items")).toMatchObject({
      title: "项目",
      count: 1,
    });
  });

  it("does not match concealed field values during search", () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems, demoFolders);
    const facade = new VaultFacade(store);

    facade.setSearch("correct-horse-demo");

    expect(facade.filteredItems()).toEqual([]);
  });

  it("finds retained items and reports whether they are active, archived, or deleted", () => {
    const store = new PopupStateStore();
    const active = { ...demoVaultItems[0], id: "active" };
    const archived = { ...demoVaultItems[1], id: "archived" };
    const deleted = { ...demoVaultItems[2], id: "deleted" };
    store.setItems([active]);
    store.setArchivedItems([archived]);
    store.setDeletedItems([deleted]);
    const facade = new VaultFacade(store);

    expect(facade.itemById("active")).toBe(active);
    expect(facade.itemById("archived")).toBe(archived);
    expect(facade.itemById("deleted")).toBe(deleted);
    expect(facade.itemLocation("active")).toBe("active");
    expect(facade.itemLocation("archived")).toBe("archived");
    expect(facade.itemLocation("deleted")).toBe("deleted");
    expect(facade.itemLocation("missing")).toBeUndefined();
  });

  it("reuses vault projections until their relevant data or filters change", () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems, demoFolders);
    const facade = new VaultFacade(store);

    const filtered = facade.filteredItems();
    const sections = facade.sections();
    const hierarchy = facade.hierarchy();

    store.setStatus("Copied");

    expect(facade.filteredItems()).toBe(filtered);
    expect(facade.sections()).toBe(sections);
    expect(facade.hierarchy()).toBe(hierarchy);

    facade.setSearch("git");

    expect(facade.filteredItems()).not.toBe(filtered);
    expect(facade.sections()).not.toBe(sections);
    expect(facade.hierarchy()).toBe(hierarchy);
  });
});

import { describe, expect, it } from "vitest";

import { demoFolders, demoVaultItems } from "../vault-demo";
import { buildVaultHierarchy } from "./vault-hierarchy";

describe("buildVaultHierarchy", () => {
  it("builds the approved peer hierarchy in a stable order", () => {
    const nodes = buildVaultHierarchy({
      items: demoVaultItems,
      folders: demoFolders,
      archivedItems: [{ ...demoVaultItems[0]!, id: "archived" }],
      deletedItems: [{ ...demoVaultItems[1]!, id: "deleted" }],
    });

    expect(nodes.map(({ id }) => id)).toEqual([
      "favorites",
      "all-items",
      "types",
      "folders",
      "unfiled",
      "hidden",
    ]);
    expect(nodes.map(({ title }) => title)).toEqual([
      "收藏夹",
      "所有项目",
      "类型",
      "文件夹",
      "无文件夹",
      "隐藏的项目",
    ]);
  });

  it("groups active items by type, folder, and empty folder without duplicating unsupported items", () => {
    const looseCard = {
      ...demoVaultItems[1]!,
      id: "loose",
      folderId: "",
      folderName: "",
    };
    const nodes = buildVaultHierarchy({
      items: [...demoVaultItems, looseCard],
      folders: demoFolders,
      archivedItems: [],
      deletedItems: [],
    });

    const types = nodes.find(({ id }) => id === "types")!;
    const folders = nodes.find(({ id }) => id === "folders")!;
    const unfiled = nodes.find(({ id }) => id === "unfiled")!;

    expect(types.children?.map(({ id, count }) => ({ id, count }))).toEqual([
      { id: "type:login", count: 1 },
      { id: "type:card", count: 2 },
      { id: "type:identity", count: 1 },
      { id: "type:secure-note", count: 1 },
    ]);
    expect(folders.children?.map(({ id, count }) => ({ id, count }))).toEqual([
      { id: "folder:work", count: 2 },
      { id: "folder:personal", count: 2 },
    ]);
    expect(unfiled.items?.map(({ id }) => id)).toEqual(["loose"]);
    expect(nodes.find(({ id }) => id === "all-items")?.count).toBe(5);
  });

  it("exposes archive and trash as hidden child routes with literal counts", () => {
    const nodes = buildVaultHierarchy({
      items: demoVaultItems,
      folders: [],
      archivedItems: [{ ...demoVaultItems[0]!, id: "archived" }],
      deletedItems: [
        { ...demoVaultItems[1]!, id: "deleted-card" },
        { ...demoVaultItems[2]!, id: "deleted-identity" },
      ],
    });

    expect(nodes.find(({ id }) => id === "hidden")).toMatchObject({
      count: 3,
      children: [
        { id: "archive", title: "归档", count: 1, route: "/archive" },
        { id: "trash", title: "回收站", count: 2, route: "/trash" },
      ],
    });
  });
});

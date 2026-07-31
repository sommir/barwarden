import { describe, expect, it } from "vitest";

import { demoVaultItems } from "../vault-demo";
import { filterVaultItems } from "./vault-filter.service";

describe("filterVaultItems", () => {
  it("filters by search, folder, and type without matching concealed password values", () => {
    const result = filterVaultItems(demoVaultItems, {
      query: "secret",
      folderId: "",
      type: "",
    });
    expect(result).toEqual([]);

    expect(filterVaultItems(demoVaultItems, { query: "", folderId: "work", type: "login" })
      .every((item) => item.folderId === "work" && item.type === "login")).toBe(true);
  });
});

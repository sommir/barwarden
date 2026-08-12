import { describe, expect, it } from "vitest";

import { demoVaultItems } from "../vault-demo";
import type { VaultItem } from "./vault-item.model";
import { rankWebsiteSuggestions } from "./website-suggestion-matcher";

const baseLogin = demoVaultItems.find((item) => item.type === "login")!;

function login(
  id: string,
  uri: string,
  matchType = "default",
  favorite = false,
): VaultItem {
  return {
    ...baseLogin,
    id,
    name: id,
    favorite,
    uri,
    uris: [{ id: `${id}-uri`, uri, matchType }],
  };
}

describe("rankWebsiteSuggestions", () => {
  it("orders reliable matches by complete URL, prefix, host, full hostname, domain, then regex", () => {
    const currentUrl = "https://login.example.com:8443/account/profile";
    const items = [
      login("same-domain", "https://admin.example.com", "default"),
      login("regex", "^https://login\\.example\\.com:8443/", "4"),
      login("full-host", "https://login.example.com/other", "default"),
      login("host", "https://login.example.com:8443/other", "1"),
      login("prefix", "https://login.example.com:8443/account", "2"),
      login("exact", currentUrl, "3"),
      login("never", currentUrl, "5"),
      login("unrelated", "https://example.net", "default"),
      { ...baseLogin, id: "card", type: "card", uris: [] },
    ];

    expect(rankWebsiteSuggestions(items, currentUrl, 10).map(({ id }) => id)).toEqual([
      "exact",
      "prefix",
      "host",
      "full-host",
      "same-domain",
      "regex",
    ]);
  });

  it("chooses the strongest URI per item and truncates only after global sorting", () => {
    const currentUrl = "https://login.example.com/account";
    const strongest = {
      ...login("strongest", "https://admin.example.com"),
      uris: [
        { id: "domain", uri: "https://admin.example.com", matchType: "default" },
        { id: "exact", uri: currentUrl, matchType: "3" },
      ],
    };
    const weaker = Array.from({ length: 6 }, (_, index) =>
      login(`domain-${index}`, `https://sub${index}.example.com`));

    expect(rankWebsiteSuggestions([...weaker, strongest], currentUrl).map(({ id }) => id)).toEqual([
      "strongest",
      "domain-0",
      "domain-1",
      "domain-2",
      "domain-3",
    ]);
  });

  it("normalizes case, IDNs, and a terminal DNS dot for full-host ordering", () => {
    const currentUrl = "https://BÜCHER.example./account";
    const fullHost = login("full-host", "https://xn--bcher-kva.example/other");
    const sameDomain = login("same-domain", "https://admin.xn--bcher-kva.example");

    expect(rankWebsiteSuggestions([sameDomain, fullHost], currentUrl).map(({ id }) => id)).toEqual([
      "full-host",
      "same-domain",
    ]);
  });

  it("uses public-suffix-aware domains and never treats co.uk as a shared site", () => {
    const items = [
      login("same-domain", "https://admin.example.co.uk"),
      login("other-site", "https://account.other.co.uk"),
    ];

    expect(rankWebsiteSuggestions(items, "https://login.example.co.uk").map(({ id }) => id)).toEqual([
      "same-domain",
    ]);
  });

  it("uses favorite, name, and ID only as stable ties after URI evidence", () => {
    const favorite = login("favorite", "https://admin.example.com", "default", true);
    const alpha = { ...login("z-id", "https://auth.example.com"), name: "Alpha" };
    const beta = { ...login("a-id", "https://profile.example.com"), name: "Beta" };

    expect(
      rankWebsiteSuggestions([beta, alpha, favorite], "https://login.example.com").map(({ id }) => id),
    ).toEqual(["favorite", "z-id", "a-id"]);
  });

  it("returns no candidates for invalid pages, invalid regexes, and nonpositive limits", () => {
    const invalidRegex = login("regex", "[", "4");
    expect(rankWebsiteSuggestions([invalidRegex], "chrome://settings")).toEqual([]);
    expect(rankWebsiteSuggestions([invalidRegex], "https://example.com")).toEqual([]);
    expect(rankWebsiteSuggestions([login("site", "https://example.com")], "https://example.com", 0)).toEqual([]);
  });
});

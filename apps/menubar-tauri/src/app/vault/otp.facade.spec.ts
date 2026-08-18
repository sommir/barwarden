import { describe, expect, it } from "vitest";

import { OtpFacade } from "./otp.facade";

describe("OtpFacade", () => {
  it("normalizes and resets its root-lifetime query", () => {
    const facade = new OtpFacade();
    facade.setSearch("OpenAI");
    expect(facade.query()).toBe("OpenAI");
    facade.setSearch(undefined);
    expect(facade.query()).toBe("");
    facade.setSearch("GitHub");
    facade.resetSearch();
    expect(facade.query()).toBe("");
  });
});

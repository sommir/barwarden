import { describe, expect, it } from "vitest";

import {
  SUPPORTED_TWO_FACTOR_PROVIDERS,
  supportedTwoFactorProviders,
  unsupportedAuthenticationMessage,
} from "./supported-authentication";

describe("supportedTwoFactorProviders", () => {
  it("exposes authenticator and email as the only supported provider ids", () => {
    expect(SUPPORTED_TWO_FACTOR_PROVIDERS).toEqual(["0", "1"]);
  });

  it("keeps only the localized authenticator and email providers in server order", () => {
    expect(supportedTwoFactorProviders(["3", "1", "0", "4"])).toEqual([
      { id: 1, label: "电子邮箱" },
      { id: 0, label: "验证器 App" },
    ]);
  });

  it("exports the fixed unsupported authentication message", () => {
    expect(unsupportedAuthenticationMessage()).toBe(
      "此账户已设置两步登录，但此浏览器不支持任何已配置的两步登录提供程序。",
    );
  });
});

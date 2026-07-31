import type { AuthSession } from "../../auth/auth-session-store";

export const ALTERNATIVE_UNLOCK_SESSION: AuthSession = {
  environment: {
    apiUrl: "https://api.example.test",
    identityUrl: "https://identity.example.test",
    iconsUrl: null,
    webVaultUrl: "https://vault.example.test",
    sendUrl: null,
  },
  token: {
    accessToken: "alternative-unlock-access",
    refreshToken: "alternative-unlock-refresh",
    tokenType: "Bearer",
    expiresIn: 3600,
    clientId: "browser",
  },
  crypto: {
    userKeyB64: "YWx0ZXJuYXRpdmUtdW5sb2NrLWtleQ==",
  },
};

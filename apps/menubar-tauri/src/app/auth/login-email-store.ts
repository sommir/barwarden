const LOGIN_EMAIL_STORAGE_KEY = "barwarden.login-email";

export class LoginEmailStore {
  load(): string {
    try {
      return globalThis.localStorage?.getItem(LOGIN_EMAIL_STORAGE_KEY)?.trim() ?? "";
    } catch {
      return "";
    }
  }

  save(email: string): void {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      this.clear();
      return;
    }

    try {
      globalThis.localStorage?.setItem(LOGIN_EMAIL_STORAGE_KEY, normalizedEmail);
    } catch {
      // Remembering an email is optional when storage is unavailable.
    }
  }

  clear(): void {
    try {
      globalThis.localStorage?.removeItem(LOGIN_EMAIL_STORAGE_KEY);
    } catch {
      // Remembering an email is optional when storage is unavailable.
    }
  }
}

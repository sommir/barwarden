const FALLBACK_ROUTE = "/tabs/vault";

const staticRoutes = new Set([
  "/tabs/vault",
  "/tabs/otp",
  "/tabs/generator",
  "/tabs/send",
  "/tabs/settings",
  "/account-switcher",
  "/vault-settings",
  "/account-security",
  "/settings-password",
  "/autofill",
  "/appearance",
  "/new-item",
  "/folders",
  "/archive",
  "/trash",
  "/generator-history",
  "/add-send",
  "/about",
  "/add-cipher",
]);

const identifier = "[A-Za-z0-9_-]{1,128}";
const retainedDynamicRoutes = [
  new RegExp(`^/new-item\\?folderId=${identifier}$`),
  new RegExp(`^/add-cipher\\?type=[1-4](?:&folderId=${identifier})?$`),
  new RegExp(`^/(?:edit-cipher|clone-cipher)\\?cipherId=${identifier}&type=[1-4]$`),
  new RegExp(`^/view-cipher/${identifier}$`),
  new RegExp(`^/cipher-password-history\\?cipherId=${identifier}$`),
  new RegExp(`^/add-send\\?type=text$`),
  new RegExp(`^/edit-send\\?sendId=${identifier}&type=text$`),
  new RegExp(`^/send-created\\?sendId=${identifier}(?:&type=text)?$`),
];

/** Accepts only retained native popup routes and their explicitly required route parameters. */
export function normalizeRetainedPopoutRoute(route: string): string {
  if (
    !route.startsWith("/") ||
    route.startsWith("//") ||
    route.includes("%") ||
    route.includes("#") ||
    route.includes("\\") ||
    route.includes("://")
  ) {
    return FALLBACK_ROUTE;
  }

  if (staticRoutes.has(route) || retainedDynamicRoutes.some((pattern) => pattern.test(route))) {
    return route;
  }

  return FALLBACK_ROUTE;
}

# iOS 27 Global Interaction, Accessibility, and QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete deterministic navigation restoration, keyboard/overlay behavior, VoiceOver announcements, compact and assistive display modes, mounted route coverage, and native 480 × 600 QA for every production page family.

**Architecture:** Extend the existing router cache, overlay stack, Bottom Sheet, feedback bridge, page facades, and retained-overlay guards. Route metadata is the single route → family/layer authority; actual mounted Angular pages, not source regexes, prove structure and computed styles. Existing page-local business, form, async-owner, authentication, sync, and AutoFill rules remain page-local.

**Tech Stack:** Angular 21 standalone components/Router, TypeScript 5.9, Angular CDK `LiveAnnouncer`, Vitest 4/jsdom, CSS custom properties/media queries, retained Bitwarden overlays, Tauri 2/WebKit.

## Global Constraints

- Work directly on current `main`; do not create a worktree.
- Preserve unrelated dirty changes. `apps/menubar-tauri/src/styles/global.css`, `apps/menubar-tauri/src/app/app.component.ts`, `apps/menubar-tauri/src/app/app.component.spec.ts`, `apps/menubar-tauri/src/app/app.visual.spec.ts`, and `apps/menubar-tauri/src/app/official-ui/official-i18n.service.ts` are hot files; stage with `git add -p` and inspect every hunk.
- Do not change authentication, encryption, candidate ranking, native AutoFill/paste, sync, reprompt, or security rules.
- Escape priority is overlay → retained secondary back → hide base popup. Popout windows retain native macOS Escape behavior.
- Focus restoration is best-effort and never throws when the owner is missing, hidden, disabled, or detached.
- Preserve Vault search in `VaultFacade`, Vault folder/type/disclosure in `PopupStateStore`, Send search/filter in `SendFacade`, and Generator option state in retained Generator services; do not duplicate them in router state.
- Ordinary pages/groups/rows are flat and shadowless. Only menus, Sheets, confirmations, and danger dialogs use 12–16 px radii and one light shadow.
- Targets are at least 44 × 44 px. Normal rows are 52 px; compact rows are 44 px with zero inter-row card gap.
- Motion tokens are 160/180/200 ms. Pressed states never scale. Reduced motion removes nonessential transforms/animations.
- This plan does not edit retained Auth, Settings, Generator, Send, Vault, cipher, or recovery output and does not refresh any transform manifest. It verifies hooks installed by the owning prior plan; a missing hook returns to that plan.
- Browser automation remains out of scope until the user explicitly authorizes a browser and the exact Playwright command. Do not run `npx playwright`; native Tauri/WebKit is the final visual surface.
- A screenshot is evidence only after reference and implementation are compared together at identical 480 × 600 state.

## Route → family/layer authority

| Route | Family | Layer | Bottom nav |
|---|---|---|---|
| `/login`, `/lock` | `auth` | `base` | no |
| `/2fa`, `/new-device-verification`, `/hint`, `/account-switcher` | `auth` | `secondary` | no |
| `/tabs` | `shell` | `base` | yes |
| `/tabs/vault` | `vault` | `base` | yes |
| `/tabs/otp` | `otp` | `base` | yes |
| `/tabs/generator` | `generator` | `base` | yes |
| `/tabs/send` | `send` | `base` | yes |
| `/tabs/settings` | `settings` | `base` | yes |
| `/vault-settings`, `/account-security`, `/settings-password`, `/autofill`, `/keyboard-shortcut`, `/appearance` | `settings` | `secondary` | no |
| `/new-item`, `/folders`, `/archive`, `/trash`, `/view-cipher/:id`, `/add-cipher`, `/edit-cipher`, `/clone-cipher`, `/cipher-password-history` | `vault` | `secondary` | no |
| `/generator-history` | `generator` | `secondary` | no |
| `/add-send`, `/edit-send`, `/send-created` | `send` | `secondary` | no |
| `/about`, `/third-party-notices`, `/third-party-licenses` | `document` | `secondary` | no |

Redirects `/`, `/tabs/`, `/autofill-picker`, and `**` have no page metadata. `/tabs` is structurally proven by its five leaf routes.

## Main-tab state ownership and restoration

| Tab | Search/filter owner | Scroll/focus owner | Required transition assertion |
|---|---|---|---|
| Vault | root `VaultFacade` owns query; root `PopupStateStore` owns folder, type, and disclosure | `PopupRouterCacheService` tab snapshot for `/tabs/vault` | Vault query/folder/type/disclosure and scroll `121` survive Vault → OTP → Send → Vault |
| OTP | new root `OtpFacade` owns query; OTP rows derive countdown locally without writing the query | `PopupRouterCacheService` tab snapshot for `/tabs/otp` | query `OpenAI`, filtered count, scroll `42`, and semantic row focus survive component destruction/recreation and tab switches |
| Generator | existing retained Generator services own type/options/history state | `PopupRouterCacheService` tab snapshot for `/tabs/generator` | option values and scroll survive Generator → Settings → Generator |
| Send | root `SendFacade` owns query and Send type filter | `PopupRouterCacheService` tab snapshot for `/tabs/send` | query/type and scroll survive Send → Vault → Send |
| Settings | existing appearance/compact preference stores own settings | `PopupRouterCacheService` tab snapshot for `/tabs/settings` | compact preference and scroll survive Settings → Vault → Settings |

Tab snapshots store only `{scrollTop, focusKey}`. Search and filter state stay in the owners above. `clear()` wipes tab snapshots and calls `OtpFacade.resetSearch()`; existing lock/account teardown remains the sole reset owner for Vault, Generator, Send, and Settings state.

---

### Task 1: Typed route metadata, scroll restoration, focus restoration, and layered Escape

**Files:**
- Create: `apps/menubar-tauri/src/app/platform/popup-route-metadata.ts`
- Create: `apps/menubar-tauri/src/app/platform/popup-route-metadata.spec.ts`
- Modify: `apps/menubar-tauri/src/app/app.routes.ts`
- Modify: `apps/menubar-tauri/src/app/app.routes.spec.ts`
- Modify: `apps/menubar-tauri/src/app/platform/popup-router-cache.service.ts`
- Modify: `apps/menubar-tauri/src/app/platform/popup-router-cache.service.spec.ts`
- Modify: `apps/menubar-tauri/src/app/app.component.ts`
- Modify: `apps/menubar-tauri/src/app/app.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/app.component.render.spec.ts`

**Interfaces:**

```ts
export type Ios27PageFamily =
  | "auth" | "shell" | "vault" | "otp" | "generator" | "send" | "settings" | "document";
export type PopupLayer = "base" | "secondary";
export type PopupFocusKey = string & { readonly __popupFocusKey: unique symbol };
export interface Ios27RouteData {
  readonly ios27Family: Ios27PageFamily;
  readonly popupLayer: PopupLayer;
  readonly bottomNavigation: boolean;
}
export function ios27RouteData(
  family: Ios27PageFamily,
  layer: PopupLayer,
  bottomNavigation?: boolean,
): Ios27RouteData;
export function deepestIos27RouteData(root: ActivatedRouteSnapshot): Ios27RouteData | null;
```

Extend `PopupRouterCacheService` with `hasBackTarget(): boolean` and `back(): Promise<boolean>`. Entries are `{ url, scrollTop, focusKey }`. Main-tab snapshots live separately in `Map<PopupTabRoute, {scrollTop; focusKey}>`; they restore tab UI but never make base-tab Escape navigate backward.

- [ ] **Step 1: Write RED route-table and cache tests**

In `app.routes.spec.ts`, flatten component routes and compare every row to the authority table. Assert each component route has exactly one `ios27Family`, `popupLayer`, and boolean `bottomNavigation`; reject extra/missing component paths.

Add this real routed test to `popup-router-cache.service.spec.ts`:

```ts
@Component({
  selector: "popup-archive-scroll-route",
  standalone: true,
  template: '<button data-popup-focus-key="archive-item:item-1">Archive item</button>',
})
class ArchiveScrollRouteComponent extends ScrollRouteHost {}

it("returns an unretained detail to archive with scroll and focus", async () => {
  const { fixture, router, service, scrollLayout } = await createService([
    { path: "archive", component: ArchiveScrollRouteComponent,
      data: ios27RouteData("vault", "secondary", false) },
    { path: "view-cipher/:id", component: CipherDetailRouteComponent,
      data: ios27RouteData("vault", "secondary", false) },
    { path: "tabs/vault", component: VaultScrollRouteComponent,
      data: ios27RouteData("vault", "base", true) },
  ], true, true);
  await router.navigateByUrl("/archive");
  fixture!.detectChanges();
  const trigger = fixture!.nativeElement.querySelector<HTMLButtonElement>(
    '[data-popup-focus-key="archive-item:item-1"]',
  )!;
  trigger.focus();
  scrollLayout.scrollableRef()!.nativeElement.scrollTop = 88;
  await router.navigateByUrl("/view-cipher/item-1");
  fixture!.detectChanges();

  expect(service.hasBackTarget()).toBe(true);
  await expect(service.back()).resolves.toBe(true);
  fixture!.detectChanges();
  await fixture!.whenStable();
  expect(router.url).toBe("/archive");
  expect(scrollLayout.scrollableRef()!.nativeElement.scrollTop).toBe(88);
  expect(document.activeElement?.getAttribute("data-popup-focus-key"))
    .toBe("archive-item:item-1");
});
```

Add a Vault → OTP → Vault test with scroll positions `121`, `42`, then `121`, and assert `hasBackTarget()` is false on the restored base Vault tab.

Add root Escape coverage:

```ts
it("closes overlay, then returns secondary, then hides base popup", () => {
  const overlayStack = { consumeEscape: vi.fn().mockReturnValueOnce(true).mockReturnValue(false) };
  const routeCache = {
    hasBackTarget: vi.fn().mockReturnValueOnce(true).mockReturnValue(false),
    back: vi.fn(async () => true),
  };
  const hidePopup = vi.fn(async () => undefined);
  const component = appComponentForEscape(hidePopup, routeCache, overlayStack);
  component.hideOnEscape(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  component.hideOnEscape(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  expect(routeCache.back).toHaveBeenCalledOnce();
  expect(hidePopup).not.toHaveBeenCalled();
  component.hideOnEscape(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  expect(hidePopup).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run RED tests**

```bash
npx vitest run apps/menubar-tauri/src/app/app.routes.spec.ts apps/menubar-tauri/src/app/platform/popup-route-metadata.spec.ts apps/menubar-tauri/src/app/platform/popup-router-cache.service.spec.ts apps/menubar-tauri/src/app/app.component.spec.ts apps/menubar-tauri/src/app/app.component.render.spec.ts
```

Expected: FAIL because route data, focus keys, per-tab snapshots, `hasBackTarget()`, boolean `back()`, and layered Escape do not exist.

- [ ] **Step 3: Implement metadata and cache behavior**

`popup-route-metadata.ts` returns literal route data and walks `firstChild` to the deepest valid metadata. Apply `data: ios27RouteData(...)` to every non-redirect route in the table.

Preserve pre-existing route data by spreading the typed metadata rather than replacing it. The account-switcher call site must be exactly:

```ts
{
  path: "account-switcher",
  component: OfficialAccountSwitcherComponent,
  canMatch: [knownAccountGuard],
  data: { ...ios27RouteData("auth", "secondary", false), state: "account-switcher" },
}
```

`app.routes.spec.ts` additionally asserts `routes.find(route => route.path === "account-switcher")?.data?.["state"] === "account-switcher"` so the current evidence selector continues to work.

Use these cache rules:

```ts
hasBackTarget(): boolean {
  const data = deepestIos27RouteData(this.router.routerState.snapshot.root);
  if (data?.popupLayer !== "secondary") return false;
  const current = canonicalUrl(this.router.url);
  const top = this.entries.at(-1);
  return Boolean(top && (top.url !== current || this.entries.length > 1));
}

async back(): Promise<boolean> {
  this.captureScrollAndFocus();
  const current = canonicalUrl(this.router.url);
  if (this.entries.at(-1)?.url === current) this.entries.pop();
  while (this.entries.length) {
    const target = this.entries.at(-1)!;
    if (await this.navigateAndRestore(target)) return true;
    this.entries.pop();
  }
  await this.navigateFallback();
  return true;
}
```

Remember the current main tab's last non-tab content key on bubbling `focusin`. On `NavigationStart`, always capture current scroll and inspect the closest non-empty `[data-popup-focus-key]`; when that candidate matches `/^tab:\/tabs\//`, keep the snapshot's already remembered content `focusKey` and update only `scrollTop`. This is required because a real pointer click focuses the `FloatingTabSwitcherComponent` button before its `(click)` handler calls `navigateByUrl()`. On `NavigationEnd`, record retained history and schedule main-tab/restored-entry writes with `afterNextRender`. Restore the keyed owner when focusable, otherwise its first enabled visible focusable descendant. Escape CSS values with `CSS.escape`; missing owners silently return. Register the `focusin` listener once and remove it in `ngOnDestroy()`.

Replace the root handler with:

```ts
if (this.overlayStack.consumeEscape(event)) return;
if (resolveWindowLayoutMode(globalThis.location?.search ?? "") === "popout") return;
event.preventDefault();
if (this.routeCache?.hasBackTarget()) {
  void this.routeCache.back().catch(() => undefined);
  return;
}
void this.popupLifecycleHost.hidePopup().catch(() => undefined);
```

- [ ] **Step 4: Run GREEN and commit**

Run Step 2; expect PASS.

```bash
git add apps/menubar-tauri/src/app/platform/popup-route-metadata.ts apps/menubar-tauri/src/app/platform/popup-route-metadata.spec.ts
git add -p apps/menubar-tauri/src/app/app.routes.ts apps/menubar-tauri/src/app/app.routes.spec.ts apps/menubar-tauri/src/app/platform/popup-router-cache.service.ts apps/menubar-tauri/src/app/platform/popup-router-cache.service.spec.ts apps/menubar-tauri/src/app/app.component.ts apps/menubar-tauri/src/app/app.component.spec.ts apps/menubar-tauri/src/app/app.component.render.spec.ts
git diff --cached --check
git commit -m "feat: restore ios27 navigation context"
```

---

### Task 2: Preserve OTP/main-tab lifetime and consume the established focus-key contract

**Files:**
- Create: `apps/menubar-tauri/src/app/vault/otp.facade.ts`
- Create: `apps/menubar-tauri/src/app/vault/otp.facade.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/otp-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/otp-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/platform/popup-router-cache.service.ts`
- Modify: `apps/menubar-tauri/src/app/platform/popup-router-cache.service.spec.ts`
- Modify: `apps/menubar-tauri/src/app/popup-header-actions.component.ts`
- Modify: `apps/menubar-tauri/src/app/popup-header-actions.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/popup-shell/floating-tab-switcher.component.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/popup-shell/floating-tab-switcher.component.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/vault/retained-new-item-dropdown.component.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/vault/vault-hierarchy.component.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/upstream-overlays/vault-main/item-more-options.component.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-history.component.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/settings/vault-settings-page.component.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/generator/generator-history-page.component.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.spec.ts`

**Interfaces:**

```ts
export type PopupTabRoute =
  | "/tabs/vault" | "/tabs/otp" | "/tabs/generator" | "/tabs/send" | "/tabs/settings";
export interface PopupUiSnapshot { readonly scrollTop: number; readonly focusKey: string | null; }

@Injectable({ providedIn: "root" })
export class OtpFacade {
  readonly query = signal("");
  setSearch(value: string | null | undefined): void { this.query.set(value ?? ""); }
  resetSearch(): void { this.query.set(""); }
}
```

`PopupRouterCacheService` owns `Map<PopupTabRoute, PopupUiSnapshot>` only. `VaultFacade` continues to own Vault query, `PopupStateStore` owns Vault/Send filters, `SendFacade` owns Send query, retained Generator services own Generator options, and `OtpFacade` owns OTP query. `clear()` empties history, route handles, tab snapshots, and OTP query; it does not reset Vault, Send, Generator, or Settings owners.

For Vault, OTP, New Item, folder, archive, and trash producers, the authoritative registry is
[`2026-08-17-ios27-vault-workflows.md` § Exact focus-key producers](./2026-08-17-ios27-vault-workflows.md#exact-focus-key-producers).
The rows below are a consumer inventory only: they link each already-authoritative value to the
test that this plan verifies, and must never rename, alias, or independently redefine a Vault-owned
key. Any conflict is resolved in favor of that registry before implementation.

The interaction plan consumes, but never rewrites, guarded focus producers installed by prior plans:

| Key | Existing producer |
|---|---|
| `tab:/tabs/<vault|otp|generator|send|settings>` | `apps/menubar-tauri/src/app/popup-shell/floating-tab-switcher.component.ts` |
| `generator:copy`, `generator:history` | guarded Generator templates installed by `2026-08-17-ios27-generator-send.md` |
| `send:search`, `send-item:<id>`, `send-item:<id>:copy`, `send-item:<id>:more` | guarded Send templates installed by `2026-08-17-ios27-generator-send.md` |
| `vault:new-item` | `apps/menubar-tauri/src/app/vault/retained-new-item-dropdown.component.ts` decorating the retained New Item button |
| `vault-item:<id>` | `apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.html` and `apps/menubar-tauri/src/app/upstream-overlays/vault-main/item-more-options.component.html` |
| `new-item:type:<1|2|3|4>`, `new-item:folder` | `apps/menubar-tauri/src/app/vault/new-item-page.component.ts` |
| `detail-edit:<id>`, `detail-history:<id>` | `apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.ts` and `apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-history.component.html` |
| `vault-child:archive`, `vault-child:trash` | `apps/menubar-tauri/src/app/vault/vault-hierarchy.component.ts` |
| `settings:folders`, `settings:archive`, `settings:trash` | `apps/menubar-tauri/src/app/upstream-overlays/settings/official-vault-settings.component.html`, owned by the Settings plan |
| `folders:new`, `folder:<id>` | `apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.html` |
| `archive-item:<id>`, `trash-item:<id>` | `apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.html` and `apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.html` |
| `account-switcher` | non-guarded `<app-current-account>` host in `apps/menubar-tauri/src/app/popup-header-actions.component.ts` |

No focus key contains an email, username, password, TOTP seed/code, Send content, note, URL, or generated secret. Missing keys remain a prerequisite-plan failure; this task must not patch retained Settings, Generator, Send, or Auth HTML and must not update their manifests.

- [ ] **Step 1: Verify prerequisite focus producers before writing lifetime code**

```bash
npx vitest run apps/menubar-tauri/src/app/popup-shell/floating-tab-switcher.component.spec.ts apps/menubar-tauri/src/app/vault/retained-new-item-dropdown.component.spec.ts apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-hierarchy.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/vault-main/item-more-options.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-history.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.spec.ts apps/menubar-tauri/src/app/settings/vault-settings-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.spec.ts apps/menubar-tauri/src/app/generator/generator-history-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.spec.ts
```

Expected: PASS and assert the literal keys in the table. Stop and finish the owning prior plan if any producer is missing; do not repair guarded output here.

- [ ] **Step 2: Write RED OTP lifetime and owner-boundary tests**

Paste into `otp.facade.spec.ts`:

```ts
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
```

Paste into `otp-page.component.spec.ts` after extracting its current setup to `renderOtp(facade: OtpFacade)`:

```ts
it("restores query and filtered count after the real page is destroyed", async () => {
  const facade = new OtpFacade();
  const first = await renderOtp(facade);
  const search = first.nativeElement.querySelector<HTMLInputElement>('[aria-label="搜索验证码"]')!;
  search.value = "Calendar";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  first.detectChanges();
  expect(first.nativeElement.querySelectorAll("bw-otp-code-row")).toHaveLength(1);
  first.destroy();

  const second = await renderOtp(facade);
  second.detectChanges();
  expect(second.nativeElement.querySelector<HTMLInputElement>('[aria-label="搜索验证码"]')!.value)
    .toBe("Calendar");
  expect(second.nativeElement.querySelectorAll("bw-otp-code-row")).toHaveLength(1);
  second.destroy();
});
```

In `floating-tab-switcher.component.spec.ts`, extend the existing rendered-segment test with this producer assertion. This verifies a prerequisite and does not authorize changing the component in this plan:

```ts
expect(buttons.map((button) => button.getAttribute("data-popup-focus-key")))
  .toEqual(tabs.map((tab) => `tab:${tab.path}`));
```

Paste the mounted integration harness below into `popup-router-cache.service.spec.ts`. Import `Type` from `@angular/core`, `I18nService`, `OfficialI18nService`, and the real `FloatingTabSwitcherComponent` plus `FloatingTab` type. Extend `createService` with a final `host: Type<unknown> = RoutedHostComponent` parameter and add the two i18n providers shown below. Existing callers remain unchanged.

```ts
const clickedTabs: readonly FloatingTab[] = [
  { label: "Vault", path: "/tabs/vault", icon: "bwi-vault" },
  { label: "OTP", path: "/tabs/otp", icon: "bwi-clock" },
  { label: "Generator", path: "/tabs/generator", icon: "bwi-generate" },
  { label: "Send", path: "/tabs/send", icon: "bwi-send" },
  { label: "Settings", path: "/tabs/settings", icon: "bwi-settings" },
];

@Component({
  selector: "popup-clicked-tabs-host",
  standalone: true,
  imports: [RouterOutlet, FloatingTabSwitcherComponent],
  template: `<router-outlet /><bw-floating-tab-switcher [tabs]="tabs" />`,
})
class ClickedTabsHostComponent { readonly tabs = clickedTabs; }

@Component({
  selector: "popup-generator-scroll-route",
  standalone: true,
  template: '<button data-popup-focus-key="generator:copy">Copy generated value</button>',
})
class GeneratorScrollRouteComponent extends ScrollRouteHost {}

@Component({
  selector: "popup-send-scroll-route",
  standalone: true,
  template: '<button data-popup-focus-key="send:search">Search Sends</button>',
})
class SendScrollRouteComponent extends ScrollRouteHost {}

function createClickedTabService() {
  const leaf = (path: string, component: Type<unknown>, family: Ios27PageFamily) => ({
    path, component, data: ios27RouteData(family, "base", true),
  });
  return createService([
    leaf("tabs/generator", GeneratorScrollRouteComponent, "generator"),
    leaf("tabs/send", SendScrollRouteComponent, "send"),
  ], true, false, ClickedTabsHostComponent);
}

async function createService(
  routeConfig = retainedRoutes,
  mountRoutes = false,
  reuseTabsRoute = false,
  host: Type<unknown> = RoutedHostComponent,
) {
  await TestBed.configureTestingModule({
    imports: mountRoutes ? [host] : [],
    providers: [
      provideRouter(routeConfig),
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
      { provide: POPUP_ROUTER_CACHE_ROUTE_GRAPH, useValue: retainedPopupRouteGraph },
      ...(reuseTabsRoute
        ? [{ provide: RouteReuseStrategy, useExisting: PopupRouteReuseStrategy }]
        : []),
    ],
  }).compileComponents();
  const router = TestBed.inject(Router);
  const scrollLayout = TestBed.inject(ScrollLayoutService);
  const service = TestBed.inject(PopupRouterCacheService);
  const reuse = TestBed.inject(PopupRouteReuseStrategy);
  const fixture = mountRoutes ? TestBed.createComponent(host) : null;
  fixture?.detectChanges();
  return { fixture, reuse, router, scrollLayout, service };
}

async function createServiceWithStateOwners() {
  const base = await createService();
  return {
    ...base,
    otp: TestBed.inject(OtpFacade),
    vault: TestBed.inject(VaultFacade),
    send: TestBed.inject(SendFacade),
    store: TestBed.inject(PopupStateStore),
  };
}

it("real tab clicks preserve Generator and Send content focus instead of the clicked tab key", async () => {
  const { fixture, router, service, scrollLayout } = await createClickedTabService();
  const focus = (key: string) => fixture!.nativeElement
    .querySelector<HTMLElement>(`[data-popup-focus-key="${key}"]`)!.focus();
  const clickTab = async (path: PopupTabRoute) => {
    const button = fixture!.nativeElement.querySelector<HTMLButtonElement>(
      `[data-popup-focus-key="tab:${path}"]`,
    )!;
    button.focus(); // real pointer-down focus precedes the component's click navigation
    button.click();
    await fixture!.whenStable();
    fixture!.detectChanges();
    await Promise.resolve(); // flush the cache's afterNextRender write
  };

  await router.navigateByUrl("/tabs/generator");
  fixture!.detectChanges();
  focus("generator:copy");
  scrollLayout.scrollableRef()!.nativeElement.scrollTop = 121;
  await clickTab("/tabs/send");

  expect(router.url).toBe("/tabs/send");
  focus("send:search");
  scrollLayout.scrollableRef()!.nativeElement.scrollTop = 73;
  await clickTab("/tabs/generator");
  expect(scrollLayout.scrollableRef()!.nativeElement.scrollTop).toBe(121);
  expect(document.activeElement?.getAttribute("data-popup-focus-key")).toBe("generator:copy");

  await clickTab("/tabs/send");
  expect(scrollLayout.scrollableRef()!.nativeElement.scrollTop).toBe(73);
  expect(document.activeElement?.getAttribute("data-popup-focus-key")).toBe("send:search");
  expect(service.hasBackTarget()).toBe(false);
});

it("clear resets OTP/cache state but leaves page-owner searches and filters alone", async () => {
  const { service, otp, vault, send, store } = await createServiceWithStateOwners();
  otp.setSearch("OpenAI"); vault.setSearch("GitHub"); send.setSearch("Report");
  store.setFilterType("login"); store.setSendTypeFilter("text");
  service.clear();
  expect(otp.query()).toBe("");
  expect(vault.queryValue()).toBe("GitHub");
  expect(send.queryValue()).toBe("Report");
  expect(store.snapshot().filterType).toBe("login");
  expect(store.snapshot().sendTypeFilter).toBe("text");
  expect(service.history()).toEqual([]);
});
```

- [ ] **Step 3: Run RED**

```bash
npx vitest run apps/menubar-tauri/src/app/vault/otp.facade.spec.ts apps/menubar-tauri/src/app/vault/otp-page.component.spec.ts apps/menubar-tauri/src/app/platform/popup-router-cache.service.spec.ts apps/menubar-tauri/src/app/popup-shell/floating-tab-switcher.component.spec.ts apps/menubar-tauri/src/app/popup-header-actions.component.spec.ts
```

Expected: FAIL because `OtpFacade`, per-tab snapshots, and the `account-switcher` host key do not exist, and because a real focused Send/Generator tab button currently replaces the source tab's content key during `NavigationStart`.

- [ ] **Step 4: Implement the exact lifetime boundary**

Inject `OtpFacade` into the OTP page and cache. Use getters so the existing template and entry cache stay stable:

```ts
protected get query(): string { return this.otp.query(); }
protected setSearch(query: string): void { this.otp.setSearch(query); }
// In entries(): compare/cache against const query = this.otp.query().
```

In cache `clear()` add `this.tabSnapshots.clear(); this.otp.resetSearch();`. Define the main-tab parser and the tab-key boundary literally:

```ts
const POPUP_TAB_ROUTES = new Set<PopupTabRoute>([
  "/tabs/vault", "/tabs/otp", "/tabs/generator", "/tabs/send", "/tabs/settings",
]);
const TAB_SWITCHER_FOCUS_KEY = /^tab:\/tabs\//;

function popupTabRoute(url: string): PopupTabRoute | null {
  const route = canonicalUrl(url) as PopupTabRoute;
  return POPUP_TAB_ROUTES.has(route) ? route : null;
}
```

Make `PopupRouterCacheService` implement `OnDestroy`, inject `DOCUMENT`, register a bubbling `focusin` listener once in the constructor, and remove it in `ngOnDestroy()`. The listener remembers only content keys; a switcher key can never become a tab snapshot's `focusKey`:

```ts
private readonly onFocusIn = (event: FocusEvent): void => {
  const tab = popupTabRoute(this.router.url);
  const key = closestPopupFocusKey(event.target);
  if (!tab || !key || TAB_SWITCHER_FOCUS_KEY.test(key)) return;
  const previous = this.tabSnapshots.get(tab);
  this.tabSnapshots.set(tab, {
    scrollTop: previous?.scrollTop ?? 0,
    focusKey: key,
  });
};

ngOnDestroy(): void {
  this.document.removeEventListener("focusin", this.onFocusIn);
}

private captureTabSnapshot(): void {
  const tab = popupTabRoute(this.router.url); // source URL, before NavigationStart changes it
  if (!tab) return;
  const previous = this.tabSnapshots.get(tab);
  const candidate = closestPopupFocusKey(this.document.activeElement);
  const isTransientTabButton = candidate !== null && TAB_SWITCHER_FOCUS_KEY.test(candidate);
  this.tabSnapshots.set(tab, {
    scrollTop: this.scrollLayout.scrollableRef()?.nativeElement.scrollTop
      ?? previous?.scrollTop ?? 0,
    focusKey: isTransientTabButton || candidate === null
      ? previous?.focusKey ?? null
      : candidate,
  });
}

function closestPopupFocusKey(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>("[data-popup-focus-key]")
    ?.getAttribute("data-popup-focus-key")?.trim() || null;
}
```

Add `this.document.addEventListener("focusin", this.onFocusIn);` as the first statement of the existing constructor. In the existing `NavigationStart` branch, call `captureTabSnapshot()` before any code reads or canonicalizes the destination URL. Thus a focused `tab:/tabs/send` updates the Generator snapshot's `scrollTop` but preserves `generator:copy`; on the return click a focused `tab:/tabs/generator` likewise preserves `send:search`. The later `focusin` fired by `FloatingTabSwitcherComponent.activate()` after successful navigation is ignored because it is also a tab key. On `NavigationEnd`, restore only when the destination is a `PopupTabRoute`, using `afterNextRender({ write: () => restoreScrollAndFocus(snapshot) })`. Add `data-popup-focus-key="account-switcher"` to the `<app-current-account>` host; Task 1 restores its first visible enabled focusable descendant.

- [ ] **Step 5: Run GREEN and commit**

Run Step 3 and the prerequisite command from Step 1; expect PASS. Confirm `git diff --name-only` contains no file under `apps/menubar-tauri/src/app/upstream-overlays/{auth,generator,send,settings}` and no transform manifest.

```bash
git add apps/menubar-tauri/src/app/vault/otp.facade.ts apps/menubar-tauri/src/app/vault/otp.facade.spec.ts
git add -p apps/menubar-tauri/src/app/vault/otp-page.component.ts apps/menubar-tauri/src/app/vault/otp-page.component.spec.ts apps/menubar-tauri/src/app/platform/popup-router-cache.service.ts apps/menubar-tauri/src/app/platform/popup-router-cache.service.spec.ts apps/menubar-tauri/src/app/popup-shell/floating-tab-switcher.component.spec.ts apps/menubar-tauri/src/app/popup-header-actions.component.ts apps/menubar-tauri/src/app/popup-header-actions.component.spec.ts
git diff --cached --check
git commit -m "feat: preserve popup tab and focus state"
```

---

### Task 3: Adopt the shared Bottom Sheet for Accessibility permission

**Files:**
- Modify: `apps/menubar-tauri/src/app/official-ui/accessibility-permission-dialog.service.ts`
- Modify: `apps/menubar-tauri/src/app/official-ui/accessibility-permission-dialog.service.spec.ts`
- Modify: `apps/menubar-tauri/src/app/official-ui/accessibility-permission-dialog.component.ts`
- Create: `apps/menubar-tauri/src/app/official-ui/accessibility-permission-dialog.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/official-ui/app-status-feedback-bridge.service.ts`
- Modify: `apps/menubar-tauri/src/app/official-ui/app-status-feedback-bridge.service.spec.ts`
- Modify: `apps/menubar-tauri/src/app/official-ui/app-bottom-sheet.adoption.spec.ts`
- Modify: `apps/menubar-tauri/src/styles/global.css`

**Interfaces:** `present(trigger: HTMLElement | null = activeHTMLElement()): void`, readonly `trigger` signal, one `AppBottomSheetComponent`, Later initial focus, `disableClose` while opening Settings, one assertive inline failure, single trigger restoration.

- [ ] **Step 1: Write RED real-dialog tests**

```ts
it("uses one shared Sheet, focuses Later, traps Tab, and restores trigger", async () => {
  const { fixture, service } = await renderPermissionDialog();
  const trigger = fixture.nativeElement.querySelector<HTMLButtonElement>(".permission-trigger")!;
  trigger.focus();
  service.present(trigger);
  fixture.detectChanges();
  await fixture.whenStable();
  const sheet = fixture.nativeElement.querySelector<HTMLDialogElement>(
    '.app-bottom-sheet[open][data-testid="accessibility-permission-sheet"]',
  )!;
  const later = sheet.querySelector<HTMLButtonElement>('[data-testid="accessibility-later"]')!;
  const settings = sheet.querySelector<HTMLButtonElement>('[data-testid="accessibility-settings"]')!;
  expect(document.activeElement).toBe(later);
  settings.focus();
  settings.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  expect(document.activeElement).toBe(later);
  sheet.dispatchEvent(new Event("cancel", { cancelable: true }));
  fixture.detectChanges();
  await fixture.whenStable();
  expect(document.activeElement).toBe(trigger);
  expect(fixture.nativeElement.querySelectorAll(".accessibility-permission-backdrop")).toHaveLength(0);
});
```

Also reject dismissal while `openingSettings=true`; after a rejected `openUrl`, assert one `[role=alert]`, sanitized copy, and `aria-busy=false`.

- [ ] **Step 2: Run RED**

```bash
npx vitest run apps/menubar-tauri/src/app/official-ui/accessibility-permission-dialog.service.spec.ts apps/menubar-tauri/src/app/official-ui/accessibility-permission-dialog.component.spec.ts apps/menubar-tauri/src/app/official-ui/app-status-feedback-bridge.service.spec.ts apps/menubar-tauri/src/app/official-ui/app-bottom-sheet.adoption.spec.ts apps/menubar-tauri/src/app/official-ui/app-bottom-sheet.component.spec.ts apps/menubar-tauri/src/app/official-ui/app-overlay-stack.service.spec.ts
```

Expected: FAIL on custom backdrop/focus and missing trigger contract.

- [ ] **Step 3: Implement shared Sheet**

The service captures `document.activeElement` by default. The component always renders this Sheet/control skeleton so every RED selector is also a GREEN implementation literal:

```html
<bw-app-bottom-sheet
  #sheet
  testId="accessibility-permission-sheet"
  labelledBy="accessibility-permission-title"
  describedBy="accessibility-permission-description"
  [disableClose]="dialog.openingSettings()"
  (dismissed)="dialog.dismiss()"
>
  <h2 id="accessibility-permission-title">{{ t("i18nAllowAutofill") }}</h2>
  <p id="accessibility-permission-description">{{ t("i18nAccessibilityInstructions") }}</p>
  @if (dialog.launchFailed()) {
    <bw-macos-alert-strip
      urgency="assertive"
      [message]="t('i18nOpenSystemSettingsFailed')"
    />
  }
  <footer [attr.aria-busy]="dialog.openingSettings()">
    <button
      #later
      type="button"
      data-testid="accessibility-later"
      [disabled]="dialog.openingSettings()"
      (click)="dialog.dismiss()"
    >{{ t("i18nLater") }}</button>
    <button
      type="button"
      data-testid="accessibility-settings"
      [disabled]="dialog.openingSettings()"
      (click)="dialog.openSystemSettings()"
    >{{ t(dialog.openingSettings() ? "i18nOpening" : "i18nGoToSystemSettings") }}</button>
  </footer>
</bw-app-bottom-sheet>
```

An `effect()` calls `sheet.open(dialog.trigger(), later)` or `sheet.close()`. Remove the component document Escape listener and all standalone backdrop/position CSS.

Update `AppStatusFeedbackBridgeService` to dismiss duplicate toast then call `present()` while the initiating quick-action control remains active.

- [ ] **Step 4: Run GREEN and commit**

Run Step 2; expect PASS.

```bash
git add apps/menubar-tauri/src/app/official-ui/accessibility-permission-dialog.component.spec.ts
git add -p apps/menubar-tauri/src/app/official-ui/accessibility-permission-dialog.service.ts apps/menubar-tauri/src/app/official-ui/accessibility-permission-dialog.service.spec.ts apps/menubar-tauri/src/app/official-ui/accessibility-permission-dialog.component.ts apps/menubar-tauri/src/app/official-ui/app-status-feedback-bridge.service.ts apps/menubar-tauri/src/app/official-ui/app-status-feedback-bridge.service.spec.ts apps/menubar-tauri/src/app/official-ui/app-bottom-sheet.adoption.spec.ts apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "refactor: adopt shared permission sheet"
```

---

### Task 4: VoiceOver navigation/results and cross-page interaction contracts

**Files:**
- Create: `apps/menubar-tauri/src/app/platform/popup-route-announcer.service.ts`
- Create: `apps/menubar-tauri/src/app/platform/popup-route-announcer.service.spec.ts`
- Modify: `apps/menubar-tauri/src/app/app.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-list-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/otp-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/otp-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/send/send-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/send/send-page.component.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/auth/login-page.component.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/vault/vault-folder-dialog.component.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/vault/archive-trash-page.component.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/vault/vault-row-actions.adapter.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/generator/generator-page.component.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/generator/generator-history-page.component.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/send/retained-text-send-form.service.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/send/text-send-operation.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/settings/p1-pages.spec.ts`

**Interfaces:** `PopupRouteAnnouncerService.start(): void` and `destroy(): void` announce the visible active `popup-header h1` through CDK `LiveAnnouncer` once after SPA navigation, never URL/query/ID. `VaultListPageComponent`, `OtpPageComponent`, and `SendPageComponent` expose `resultAnnouncement: string`; each non-guarded route wrapper renders exactly one polite atomic result-count region. OTP seconds never enter it. Existing owner-plan contracts remain authoritative for form errors, success, dirty Sheets, pending prevention, and stale async results.

- [ ] **Step 1: Write RED announcements and interaction matrix**

```ts
@Component({ standalone: true, imports: [RouterOutlet], template: "<router-outlet />" })
class AnnouncerHostComponent {}

@Component({
  standalone: true,
  imports: [PopupHeaderComponent],
  template: '<popup-header pageTitle="归档" />',
})
class ArchiveHeadingComponent {}

@Component({
  standalone: true,
  imports: [PopupHeaderComponent],
  template: '<popup-header pageTitle="登录" />',
})
class LoginHeadingComponent {}

async function renderAnnouncer(live: Pick<LiveAnnouncer, "announce" | "clear">) {
  await TestBed.configureTestingModule({
    imports: [AnnouncerHostComponent],
    providers: [
      provideRouter([
        { path: "login", component: LoginHeadingComponent },
        { path: "archive", component: ArchiveHeadingComponent },
      ]),
      { provide: LiveAnnouncer, useValue: live },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AnnouncerHostComponent);
  const router = TestBed.inject(Router);
  const service = TestBed.inject(PopupRouteAnnouncerService);
  fixture.detectChanges();
  return { router, fixture, service };
}

it("announces rendered heading without leaking URL data", async () => {
  const live = { announce: vi.fn(async () => undefined), clear: vi.fn() };
  const { router, fixture, service } = await renderAnnouncer(live);
  service.start();
  await router.navigateByUrl("/login");
  fixture.detectChanges();
  await fixture.whenStable();
  expect(live.announce).not.toHaveBeenCalled();
  await router.navigateByUrl("/archive?cipherId=secret-server-id");
  fixture.detectChanges();
  await fixture.whenStable();
  expect(live.announce).toHaveBeenCalledWith("归档", "polite");
  expect(JSON.stringify(live.announce.mock.calls)).not.toContain("secret-server-id");
});
```

Add the route-wrapper result assertions to the three named component specs:

```ts
const resultStatus = host.querySelectorAll('[data-testid="result-announcement"][role="status"]');
expect(resultStatus).toHaveLength(1);
expect(resultStatus[0]!.getAttribute("aria-live")).toBe("polite");
expect(resultStatus[0]!.getAttribute("aria-atomic")).toBe("true");
expect(resultStatus[0]!.textContent).toContain("1");
```

For OTP, use fake timers and prove countdown churn is silent:

```ts
const before = host.querySelector('[data-testid="result-announcement"]')!.textContent;
vi.advanceTimersByTime(1_000);
fixture.detectChanges();
expect(host.querySelector('[data-testid="result-announcement"]')!.textContent).toBe(before);
expect(host.querySelectorAll('[data-testid="result-announcement"]')).toHaveLength(1);
```

The interaction matrix is verification-only here; each row must already be GREEN from its owning prior plan:

| Contract | Real owner/spec | Required assertion |
|---|---|---|
| Login blur and submit | `apps/menubar-tauri/src/app/auth/login-page.component.spec.ts` | blur error is linked by `aria-describedby`; invalid submit focuses email then password; port is not called |
| Vault form validation/pending | `apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.spec.ts` | first invalid field focus; one pending status; repeat submit blocked; readable values retained after sanitized failure |
| Send validation/pending | `apps/menubar-tauri/src/app/send/retained-text-send-form.service.spec.ts` and `apps/menubar-tauri/src/app/send/send-page.component.spec.ts` | Name → Text → Password → Maximum count order; duplicate save blocked; value retention |
| Settings pending/error | `apps/menubar-tauri/src/app/settings/p1-pages.spec.ts` | duplicate mutation blocked; one contextual error; trigger focus restored |
| Dirty/danger Sheet | `apps/menubar-tauri/src/app/vault/vault-folder-dialog.component.spec.ts`, `apps/menubar-tauri/src/app/vault/archive-trash-page.component.spec.ts`, `apps/menubar-tauri/src/app/send/send-page.component.spec.ts`, `apps/menubar-tauri/src/app/settings/p1-pages.spec.ts` | Cancel initially focused; Escape/cancel returns initiating control; retryable failure remains open |
| Late result | `apps/menubar-tauri/src/app/vault/vault-row-actions.adapter.spec.ts`, `apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.spec.ts`, `apps/menubar-tauri/src/app/generator/generator-page.component.spec.ts`, `apps/menubar-tauri/src/app/generator/generator-history-page.component.spec.ts`, `apps/menubar-tauri/src/app/send/text-send-operation.spec.ts` | account, lock, route teardown, same-ID replacement, and component destroy publish no feedback/navigation/focus |

Do not import or edit retained Auth, Settings, Generator, or Send templates. The named owner specs remain the executable late-result evidence; this task only aggregates their exact command below.

- [ ] **Step 2: Run RED**

```bash
npx vitest run apps/menubar-tauri/src/app/platform/popup-route-announcer.service.spec.ts apps/menubar-tauri/src/app/auth/login-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts apps/menubar-tauri/src/app/vault/otp-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-folder-dialog.component.spec.ts apps/menubar-tauri/src/app/vault/archive-trash-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-row-actions.adapter.spec.ts apps/menubar-tauri/src/app/generator/generator-page.component.spec.ts apps/menubar-tauri/src/app/generator/generator-history-page.component.spec.ts apps/menubar-tauri/src/app/send/retained-text-send-form.service.spec.ts apps/menubar-tauri/src/app/send/text-send-operation.spec.ts apps/menubar-tauri/src/app/send/send-page.component.spec.ts apps/menubar-tauri/src/app/settings/p1-pages.spec.ts apps/menubar-tauri/src/app/official-ui/app-feedback.component.spec.ts apps/menubar-tauri/src/app/official-ui/macos-alert-strip.component.spec.ts apps/menubar-tauri/src/app/official-ui/app-bottom-sheet.component.spec.ts
```

Expected: only route/result announcement rows fail. A prerequisite interaction row failure returns to its owning Auth/Vault/Generator-Send/Settings plan; this task does not patch guarded output.

- [ ] **Step 3: Implement announcements and proven page-local gaps**

Implement the service exactly around rendered headings, never route text:

```ts
@Injectable({ providedIn: "root" })
export class PopupRouteAnnouncerService {
  private readonly router = inject(Router);
  private readonly live = inject(LiveAnnouncer);
  private readonly injector = inject(Injector);
  private subscription?: Subscription;
  private latestNavigationId = 0;
  private suppressNextNavigation = true;

  start(): void {
    if (this.subscription) return;
    this.subscription = this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    ).subscribe((event) => {
      if (this.suppressNextNavigation) {
        this.suppressNextNavigation = false;
        return;
      }
      this.latestNavigationId = event.id;
      afterNextRender({ read: () => {
        if (this.latestNavigationId !== event.id) return;
        const heading = [...document.querySelectorAll<HTMLElement>("popup-header h1")]
          .find((node) => !node.closest('[hidden],[aria-hidden="true"]'));
        const text = heading?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        if (text) void this.live.announce(text, "polite");
      } }, { injector: this.injector });
    });
  }

  destroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
    this.latestNavigationId = 0;
    this.suppressNextNavigation = true;
    this.live.clear();
  }
}
```

Because `AppComponent` starts the service before startup navigation, the first `NavigationEnd` is deliberately ignored; later SPA navigations announce. Start/destroy beside current feedback bridges in `AppComponent`.

Result regions use:

```html
<span
  class="tw-sr-only"
  data-testid="result-announcement"
  role="status"
  aria-live="polite"
  aria-atomic="true"
>
  {{ resultAnnouncement }}
</span>
```

Update `resultAnnouncement` only after search/filter count changes in the three non-guarded route wrappers. Initialize it after the first render without announcing; subsequent query/folder/type changes assign `translateOfficialMessage("i18nItemsCount", count)`. Keep OTP countdown state outside this property. Do not create global form/async state services and do not edit any retained template or manifest.

- [ ] **Step 4: Run GREEN and commit**

Run Step 2; expect PASS.

```bash
git add apps/menubar-tauri/src/app/platform/popup-route-announcer.service.ts apps/menubar-tauri/src/app/platform/popup-route-announcer.service.spec.ts
git add -p apps/menubar-tauri/src/app/app.component.ts apps/menubar-tauri/src/app/vault/vault-list-page.component.ts apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts apps/menubar-tauri/src/app/vault/otp-page.component.ts apps/menubar-tauri/src/app/vault/otp-page.component.spec.ts apps/menubar-tauri/src/app/send/send-page.component.ts apps/menubar-tauri/src/app/send/send-page.component.spec.ts
git diff --cached --check
git commit -m "feat: announce ios27 navigation and results"
```

---

### Task 5: Focus, compact mode, motion, themes, and assistive display modes

**Files:**
- Modify: `apps/menubar-tauri/src/styles/macos-tokens.css`
- Modify: `apps/menubar-tauri/src/styles/macos-motion.css`
- Modify: `apps/menubar-tauri/src/styles/macos-materials.css`
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Create: `apps/menubar-tauri/src/app/official-ui/ios27-accessibility.visual.spec.ts`
- Modify: `apps/menubar-tauri/src/app/settings/p1-pages.spec.ts`
- Modify: `apps/menubar-tauri/src/app/layout/popup-layout.component.spec.ts`

**Interfaces:** tokens `--mac-motion-fast:160ms`, `--mac-motion-standard:180ms`, `--mac-motion-slow:200ms`, `--mac-focus-ring-width:2px`, `--mac-row-height:52px`, `--mac-compact-row-height:44px`.

- [ ] **Step 1: Write RED computed-style tests on mounted controls**

Inject tokens/motion/materials/global CSS as raw text and mount real tab switcher, Sheet, input, ordinary group, long text, and row/action fixtures. Assert exact tokens, 2 px focus, 52/44 px rows, 44 px compact actions, shadowless group, 16 px Sheet top radius, no `.975` scale, and `scrollWidth <= clientWidth`. Stub `matchMedia` for dark/system, reduced motion, reduced transparency, contrast, and forced colors; require current-tab/focus/error/danger semantics through system borders/text.

- [ ] **Step 2: Run RED**

```bash
npx vitest run apps/menubar-tauri/src/app/official-ui/ios27-accessibility.visual.spec.ts apps/menubar-tauri/src/app/settings/p1-pages.spec.ts apps/menubar-tauri/src/app/layout/popup-layout.component.spec.ts apps/menubar-tauri/src/app/official-ui/app-bottom-sheet.component.spec.ts apps/menubar-tauri/src/app/official-ui/app-feedback.component.spec.ts
```

Expected: FAIL on current 100 ms motion, 3 px input ring, `scale(0.975)`, compact rhythm, and forced-colors tab state.

- [ ] **Step 3: Implement exact tokens/media rules**

```css
:root {
  --mac-motion-fast: 160ms;
  --mac-motion-standard: 180ms;
  --mac-motion-slow: 200ms;
  --mac-motion-duration: var(--mac-motion-fast);
  --mac-sheet-motion: var(--mac-motion-slow);
  --mac-disclosure-motion: var(--mac-motion-standard);
  --mac-focus-ring-width: 2px;
  --mac-row-height: 52px;
  --mac-compact-row-height: 44px;
}
:where(button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])):focus-visible {
  outline: var(--mac-focus-ring-width) solid var(--mac-focus);
  outline-offset: 2px;
}
:root[data-bw-compact-mode="true"] {
  --bw-row-content-height: var(--mac-compact-row-height);
  --bw-row-gap: 0;
  --bw-section-gap: 8px;
}
.macos-pressable:active { transform: none; opacity: .78; }
@media (prefers-reduced-motion: reduce) {
  :root *, :root *::before, :root *::after {
    animation: none !important;
    scroll-behavior: auto !important;
    transition: none !important;
  }
  :root .macos-pressable:active, :root .app-bottom-sheet { transform: none !important; }
}
```

Reduced transparency uses opaque `--mac-surface-solid` and no filters. Forced colors explicitly styles current tab, focus, invalid fields, and danger controls with `Highlight/HighlightText/Canvas/CanvasText/Mark/MarkText` as available. Remove competing hard-coded 3 px rings only after shared selector coverage passes.

- [ ] **Step 4: Run GREEN and commit**

Run Step 2; expect PASS for normal/compact, light/dark/system, high contrast, reduced transparency/motion, forced colors, and 200% text.

```bash
git add apps/menubar-tauri/src/app/official-ui/ios27-accessibility.visual.spec.ts
git add -p apps/menubar-tauri/src/styles/macos-tokens.css apps/menubar-tauri/src/styles/macos-motion.css apps/menubar-tauri/src/styles/macos-materials.css apps/menubar-tauri/src/styles/global.css apps/menubar-tauri/src/app/settings/p1-pages.spec.ts apps/menubar-tauri/src/app/layout/popup-layout.component.spec.ts
git diff --cached --check
git commit -m "style: normalize ios27 accessibility states"
```

---

### Task 6: Mount every visible production route and enforce structure

**Files:**
- Create: `apps/menubar-tauri/src/app/evidence/ios27-route-structure.harness.ts`
- Create: `apps/menubar-tauri/src/app/ios27-route-structure.spec.ts`
- Modify: `apps/menubar-tauri/src/app/app.routes.spec.ts`
- Modify: `apps/menubar-tauri/src/app/app.component.ts`
- Modify: `apps/menubar-tauri/src/app/app.component.render.spec.ts`
- Verify unchanged prerequisite: `apps/menubar-tauri/src/app/route-shell.guard.spec.ts`

**Interfaces:**

```ts
export interface ProductionRouteStructuralCase {
  readonly route: string;
  readonly family: Ios27PageFamily;
  readonly layer: PopupLayer;
  readonly evidenceSearch: string;
  readonly routeHostSelector: string;
}
export async function mountProductionRoute(testCase: ProductionRouteStructuralCase): Promise<{
  fixture: ComponentFixture<AppComponent>;
  host: HTMLElement;
  router: Router;
}>;
```

The harness mounts real `AppComponent`, production `routes`, routed component, and retained wrapper using `appConfig.providers`. It mirrors `app.config.ts`: call `createSettingsEvidencePreview(search, true)` first; use its providers when non-null, otherwise use `createEvidenceProviders(search, true)`. Install raw token/material/motion/global CSS before fixture creation. Never replace route templates, read source strings, infer DOM from `ɵcmp`, or edit retained output.

- [ ] **Step 1: Create complete route registry and RED assertions**

Use this complete 33-case registry; every evidence literal exists in the current typed evidence-state arrays:

```ts
const structuralCase = (
  route: string, family: Ios27PageFamily, layer: PopupLayer,
  evidenceSearch: string, routeHostSelector: string,
): ProductionRouteStructuralCase => ({ route, family, layer, evidenceSearch, routeHostSelector });

export const productionRouteStructuralCases = [
  structuralCase("/login", "auth", "base", "?authEvidence=email", "bw-login-page"),
  structuralCase("/lock", "auth", "base", "?authEvidence=alternative-unlock-startup", "bw-lock-page"),
  structuralCase("/2fa", "auth", "secondary", "?authEvidence=authenticator", "bw-two-factor-page"),
  structuralCase("/new-device-verification", "auth", "secondary", "?authEvidence=new-device", "bw-new-device-verification-page"),
  structuralCase("/hint", "auth", "secondary", "?authEvidence=hint", "bw-password-hint-page"),
  structuralCase("/account-switcher", "auth", "secondary", "?authEvidence=account-switcher", "bw-official-account-switcher"),
  structuralCase("/tabs/vault", "vault", "base", "?vaultEvidence=populated", "bw-vault-list-page"),
  structuralCase("/tabs/otp", "otp", "base", "?vaultEvidence=populated", "bw-otp-page"),
  structuralCase("/tabs/generator", "generator", "base", "?vaultEvidence=populated", "bw-generator-page"),
  structuralCase("/tabs/send", "send", "base", "?sendEvidence=list-populated", "bw-send-page"),
  structuralCase("/tabs/settings", "settings", "base", "?settingsEvidence=settings-main", "bw-settings-page"),
  structuralCase("/vault-settings", "settings", "secondary", "?settingsEvidence=vault-settings", "bw-vault-settings-page"),
  structuralCase("/account-security", "settings", "secondary", "?settingsEvidence=account-security", "bw-account-security-page"),
  structuralCase("/settings-password", "settings", "secondary", "?settingsEvidence=change-password-handoff", "bw-settings-password-page"),
  structuralCase("/autofill", "settings", "secondary", "?settingsEvidence=one-field-settings", "bw-autofill-settings-page"),
  structuralCase("/keyboard-shortcut", "settings", "secondary", "?settingsEvidence=settings-main", "bw-keyboard-shortcut-page"),
  structuralCase("/appearance", "settings", "secondary", "?settingsEvidence=appearance", "bw-appearance-page"),
  structuralCase("/new-item", "vault", "secondary", "?vaultEvidence=populated", "bw-new-item-page"),
  structuralCase("/folders", "vault", "secondary", "?vaultEvidence=folders-list", "bw-folders-page"),
  structuralCase("/archive", "vault", "secondary", "?vaultEvidence=archive-list", "bw-archive-page"),
  structuralCase("/trash", "vault", "secondary", "?vaultEvidence=trash-list", "bw-trash-page"),
  structuralCase("/view-cipher/calendar", "vault", "secondary", "?vaultEvidence=login-workflow-detail-default", "bw-vault-item-detail-page"),
  structuralCase("/add-cipher?type=1", "vault", "secondary", "?vaultEvidence=login-workflow-form-add", "bw-vault-add-edit-page"),
  structuralCase("/edit-cipher?cipherId=calendar&type=1", "vault", "secondary", "?vaultEvidence=login-workflow-form-edit", "bw-vault-add-edit-page"),
  structuralCase("/clone-cipher?cipherId=calendar&type=1", "vault", "secondary", "?vaultEvidence=login-workflow-form-clone", "bw-vault-add-edit-page"),
  structuralCase("/cipher-password-history?cipherId=calendar", "vault", "secondary", "?vaultEvidence=password-history-populated", "bw-vault-password-history-page"),
  structuralCase("/generator-history", "generator", "secondary", "?vaultEvidence=populated", "bw-generator-history-page"),
  structuralCase("/add-send?type=text", "send", "secondary", "?sendEvidence=form-add", "bw-send-add-edit-page"),
  structuralCase("/edit-send?sendId=m12-text-send&type=text", "send", "secondary", "?sendEvidence=form-edit", "bw-send-add-edit-page"),
  structuralCase("/send-created?sendId=m12-text-send&type=text", "send", "secondary", "?sendEvidence=created", "bw-send-created-page"),
  structuralCase("/about", "document", "secondary", "?settingsEvidence=about", "bw-about-page"),
  structuralCase("/third-party-notices", "document", "secondary", "?settingsEvidence=about", "bw-third-party-notices-page"),
  structuralCase("/third-party-licenses", "document", "secondary", "?settingsEvidence=about", "bw-third-party-licenses-page"),
] as const;
```

At module initialization, validate every evidence literal before TestBed mounts:

```ts
const evidenceValues: Readonly<Record<string, readonly string[]>> = {
  authEvidence: AUTH_EVIDENCE_STATES,
  vaultEvidence: vaultMainEvidenceStates,
  sendEvidence: sendEvidenceStates,
  settingsEvidence: settingsEvidenceStates,
};
for (const c of productionRouteStructuralCases) {
  const entries = [...new URLSearchParams(c.evidenceSearch).entries()];
  if (entries.length !== 1) throw new Error(`One evidence value required for ${c.route}`);
  const [key, value] = entries[0]!;
  if (!evidenceValues[key]?.includes(value)) {
    throw new Error(`Invalid ${key}=${value} for ${c.route}`);
  }
}
```

Implement the harness with the production provider decision and router:

```ts
export async function mountProductionRoute(c: ProductionRouteStructuralCase) {
  const settingsPreview = createSettingsEvidencePreview(c.evidenceSearch, true);
  const evidenceProviders = settingsPreview
    ? settingsPreview.providers
    : createEvidenceProviders(c.evidenceSearch, true);
  const style = document.createElement("style");
  style.dataset.testOwner = "ios27-route-structure";
  style.textContent = [
    "macos-tokens.css", "macos-materials.css", "macos-motion.css", "global.css",
  ].map((file) => readFileSync(
    join(process.cwd(), "apps/menubar-tauri/src/styles", file), "utf8",
  )).join("\n").replace(/^@import[^;]+;\s*/gm, "");
  document.head.append(style);
  document.documentElement.style.width = "480px";
  document.documentElement.style.height = "600px";

  await TestBed.configureTestingModule({
    imports: [AppComponent],
    providers: [...appConfig.providers, ...evidenceProviders],
  }).compileComponents();
  const router = TestBed.inject(Router);
  const fixture = TestBed.createComponent(AppComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  await router.navigateByUrl(c.route);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, host: fixture.nativeElement as HTMLElement, router };
}

afterEach(() => {
  document.querySelectorAll('style[data-test-owner="ios27-route-structure"]').forEach((node) => node.remove());
  document.documentElement.removeAttribute("style");
  delete document.documentElement.dataset.bwTheme;
  delete document.documentElement.dataset.bwCompactMode;
  vi.clearAllTimers();
  TestBed.resetTestingModule();
});
```

Mounted assertion:

```ts
it.each(productionRouteStructuralCases)("mounts $route with one iOS 27 shell", async (c) => {
  const { fixture, host, router } = await mountProductionRoute(c);
  expect(router.url).toBe(c.route);
  const routeHost = host.querySelector<HTMLElement>(c.routeHostSelector)!;
  expect(routeHost).not.toBeNull();
  const appRoot = host.matches("barwarden-root") ? host : host.querySelector<HTMLElement>("barwarden-root")!;
  expect(appRoot.classList).toContain(`ios27-family--${c.family}`);
  expect(routeHost.querySelectorAll("popup-page")).toHaveLength(1);
  expect(routeHost.querySelectorAll('[data-testid="popup-layout-scroll-region"]')).toHaveLength(1);
  const nav = host.querySelectorAll('nav[aria-label="主要导航"],nav[aria-label="Primary navigation"]');
  expect(nav).toHaveLength(c.layer === "base" && c.family !== "auth" ? 1 : 0);
  expect(routeHost.querySelectorAll("popup-header > header")).toHaveLength(1);
  if (c.layer === "secondary") {
    expect(routeHost.querySelector('popup-header button[aria-label="返回"],popup-header button[aria-label="Back"]')).not.toBeNull();
  }
  const scroll = routeHost.querySelector<HTMLElement>('[data-testid="popup-layout-scroll-region"]')!;
  expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
  for (const surface of routeHost.querySelectorAll<HTMLElement>("bit-card,bit-item-group,.macos-group")) {
    expect(getComputedStyle(surface).boxShadow, c.route).toBe("none");
  }
  fixture.destroy();
});
```

Harness sets 480 × 600, leaves actual `scrollWidth` measurable, installs CSS before fixture creation, and resets TestBed/DOM/timers/theme/compact datasets after every case.

- [ ] **Step 2: Run RED**

```bash
npx vitest run apps/menubar-tauri/src/app/app.routes.spec.ts apps/menubar-tauri/src/app/ios27-route-structure.spec.ts apps/menubar-tauri/src/app/route-shell.guard.spec.ts
```

Expected: FAIL on the missing `barwarden-root` family class. Header/scroll/nav/shadow/overflow failures identify an unfinished owning prior page plan and are not repaired in this task.

- [ ] **Step 3: Fix exact routed boundaries**

On every `NavigationEnd`, `AppComponent` reads `deepestIos27RouteData(this.router.routerState.snapshot.root)` into `routeFamily`. Extend the existing component host map without replacing its authentication binding:

```ts
host: {
  "[class.barwarden-root--authentication]": "authenticationLayoutActive()",
  "[class.ios27-family--auth]": "routeFamily() === 'auth'",
  "[class.ios27-family--shell]": "routeFamily() === 'shell'",
  "[class.ios27-family--vault]": "routeFamily() === 'vault'",
  "[class.ios27-family--otp]": "routeFamily() === 'otp'",
  "[class.ios27-family--generator]": "routeFamily() === 'generator'",
  "[class.ios27-family--send]": "routeFamily() === 'send'",
  "[class.ios27-family--settings]": "routeFamily() === 'settings'",
  "[class.ios27-family--document]": "routeFamily() === 'document'",
},
// class field
protected readonly routeFamily = signal<Ios27PageFamily | null>(null);
// in the existing NavigationEnd subscription
this.routeFamily.set(deepestIos27RouteData(this.router.routerState.snapshot.root)?.ios27Family ?? null);
```

Never add classes to retained route components. Mounted header/scroll/nav/shadow failures return to the owning prior page plan rather than being patched by this global task.

- [ ] **Step 4: Run GREEN and commit**

Run Step 2; expect all 33 mounted cases PASS. The existing source graph remains an import/ownership guard, not structural evidence.

```bash
git add apps/menubar-tauri/src/app/evidence/ios27-route-structure.harness.ts apps/menubar-tauri/src/app/ios27-route-structure.spec.ts
git add -p apps/menubar-tauri/src/app/app.routes.spec.ts apps/menubar-tauri/src/app/app.component.ts apps/menubar-tauri/src/app/app.component.render.spec.ts
git diff --cached --check
git commit -m "test: enforce mounted ios27 route coverage"
```

---

### Task 7: Full verification and native visual QA

**Files:**
- Modify: `design-qa.md`
- Add: `docs/superpowers/specs/assets/barwarden-ios27-auth-implementation.png`
- Verify/refresh prior authority: `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-otp-light.png`
- Verify/refresh prior authority: `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-detail.png`
- Add: `docs/superpowers/specs/assets/barwarden-ios27-generator-implementation.png`
- Add: `docs/superpowers/specs/assets/barwarden-ios27-send-implementation.png`
- Add: `docs/superpowers/specs/assets/barwarden-ios27-settings-info-implementation.png`
- Add: `docs/superpowers/specs/assets/barwarden-ios27-overlay-accessibility-implementation.png`

**Interfaces:** `design-qa.md` records date/range, viewport, reference/implementation paths, light/dark/system/compact/assistive states, keyboard/VoiceOver results, issue disposition, and P0/P1/P2. `final result: passed` is legal only with zero P0/P1/P2 and fresh green commands.

**Deterministic native state → file authority:**

| State ID | Tauri `build.devUrl` query / action after opening status popup | Output file |
|---|---|---|
| `auth-email-light` | `?authEvidence=email`; no action | `docs/superpowers/specs/assets/barwarden-ios27-auth-implementation.png` |
| `otp-populated-search` | `?vaultEvidence=populated`; choose OTP tab, enter `Calendar` in search | prior authority `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-otp-light.png` |
| `vault-detail-default` | `?vaultEvidence=login-workflow-detail-default`; evidence startup opens `/view-cipher/calendar` | prior authority `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-detail.png` |
| `generator-default` | `?vaultEvidence=populated`; choose Generator tab | `docs/superpowers/specs/assets/barwarden-ios27-generator-implementation.png` |
| `send-list-populated` | `?sendEvidence=list-populated`; no action | `docs/superpowers/specs/assets/barwarden-ios27-send-implementation.png` |
| `settings-main-system` | `?settingsEvidence=settings-main`; choose System theme | `docs/superpowers/specs/assets/barwarden-ios27-settings-info-implementation.png` |
| `accessibility-permission-sheet` | `?vaultEvidence=populated`; with Barwarden Accessibility permission disabled, invoke a Fill quick action | `docs/superpowers/specs/assets/barwarden-ios27-overlay-accessibility-implementation.png` |

The Auth, Generator, Send, Settings, and permission-Sheet files are the only new images owned by this plan. Reuse the OTP/detail files owned by `2026-08-17-ios27-vault-workflows.md`; do not create `barwarden-ios27-otp-implementation.png` or `barwarden-ios27-vault-workflow-implementation.png` aliases.

**Native QA matrix:**

| Family/state | Required interaction | Pass evidence |
|---|---|---|
| Auth: login, lock, 2FA, new-device, hint, account switcher | visual-order Tab; blur/submit errors; pending repeat-submit prevention; values retained after sanitized failure | paired 480 × 600 light/dark capture plus keyboard log |
| Vault base/detail/form/folders/archive/trash/history | query/folder/type/disclosure and scroll/focus restoration; username/password/OTP quick actions; dirty Sheet; cancel-first destructive confirmation | Vault workflow capture plus state-before/state-after notes |
| OTP | query and scroll/focus restoration; copy success/error; countdown continues | OTP capture plus one result announcement and proof of no per-second VoiceOver chatter |
| Generator/history | type/options retained; copy/error; clear-history Sheet focus return | Generator capture plus focus-owner note |
| Send list/form/created | query/type/scroll retained; menu/form pending/error; dirty Sheet; late owner isolation | Send capture plus pending/late-result notes |
| Settings/About/notices/licenses | compact preference retained; long document scroll; back focus restoration | Settings/info capture in normal and compact modes |
| Overlay/accessibility permission | Escape overlay → Sheet → secondary → hide; initial focus/trap/return; Settings-open busy/failure | overlay capture plus focus and Escape trace |
| Assistive display matrix | light, dark, system, Increase Contrast/forced colors, Reduce Transparency, Reduce Motion, 200% text | identical-state captures or recorded system setting, zero horizontal overflow, visible current/focus/error/danger states |

- [ ] **Step 1: Run fresh gates**

```bash
npm test
npm run typecheck:m14
npm run build:web
git diff --check cfe371a6..HEAD
git diff --stat cfe371a6..HEAD
```

Expected: exit 0. Do not reuse prior logs after code/CSS changes.

- [ ] **Step 2: Capture native 480 × 600 matrix**

For each table row, substitute its exact query into this command, wait for the tray icon, click the Barwarden status item to open the real 480 × 600 WebKit popup, perform only the listed action, then run its exact capture command and click that popup window:

```bash
VITE_BW_VAULT_EVIDENCE=true npx tauri dev -c apps/menubar-tauri/src-tauri/tauri.conf.json -c '{"build":{"devUrl":"http://127.0.0.1:1420/?authEvidence=email"}}'
/usr/sbin/screencapture -x -w docs/superpowers/specs/assets/barwarden-ios27-auth-implementation.png
```

Repeat with these exact launch/capture pairs, stopping the prior `tauri dev` process with Ctrl-C before starting the next pair:

```bash
VITE_BW_VAULT_EVIDENCE=true npx tauri dev -c apps/menubar-tauri/src-tauri/tauri.conf.json -c '{"build":{"devUrl":"http://127.0.0.1:1420/?vaultEvidence=populated"}}'
/usr/sbin/screencapture -x -w docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-otp-light.png

VITE_BW_VAULT_EVIDENCE=true npx tauri dev -c apps/menubar-tauri/src-tauri/tauri.conf.json -c '{"build":{"devUrl":"http://127.0.0.1:1420/?vaultEvidence=login-workflow-detail-default"}}'
/usr/sbin/screencapture -x -w docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-detail.png

VITE_BW_VAULT_EVIDENCE=true npx tauri dev -c apps/menubar-tauri/src-tauri/tauri.conf.json -c '{"build":{"devUrl":"http://127.0.0.1:1420/?vaultEvidence=populated"}}'
/usr/sbin/screencapture -x -w docs/superpowers/specs/assets/barwarden-ios27-generator-implementation.png

VITE_BW_VAULT_EVIDENCE=true npx tauri dev -c apps/menubar-tauri/src-tauri/tauri.conf.json -c '{"build":{"devUrl":"http://127.0.0.1:1420/?sendEvidence=list-populated"}}'
/usr/sbin/screencapture -x -w docs/superpowers/specs/assets/barwarden-ios27-send-implementation.png

VITE_BW_VAULT_EVIDENCE=true npx tauri dev -c apps/menubar-tauri/src-tauri/tauri.conf.json -c '{"build":{"devUrl":"http://127.0.0.1:1420/?settingsEvidence=settings-main"}}'
/usr/sbin/screencapture -x -w docs/superpowers/specs/assets/barwarden-ios27-settings-info-implementation.png

VITE_BW_VAULT_EVIDENCE=true npx tauri dev -c apps/menubar-tauri/src-tauri/tauri.conf.json -c '{"build":{"devUrl":"http://127.0.0.1:1420/?vaultEvidence=populated"}}'
/usr/sbin/screencapture -x -w docs/superpowers/specs/assets/barwarden-ios27-overlay-accessibility-implementation.png
```

Do not reset macOS TCC from a script. For the final pair, the operator disables the Barwarden development app in System Settings → Privacy & Security → Accessibility before invoking Fill. Never capture real credentials, vault values, OTP codes, Send text, or private URLs.

- [ ] **Step 3: Compare paired visuals and fix issues**

For every family, combine implementation with `barwarden-ios27-ui-visual-target.png` or matching `docs/ui-audit-2026-08-17/*.png` at the same state/viewport. Review canvas, hierarchy, radius/shadow, continuous dividers, semantic icons, typography, 16 px margins, 44 px targets, 52/44 px rows, nav clearance, clipping, and overlay shape. Record/fix/recapture every P0/P1/P2.

- [ ] **Step 4: Manual interaction/accessibility matrix**

Verify visual-order Tab, hidden/disabled exclusion, Escape overlay → Sheet → secondary → hide, overlay focus entry/return, detail list scroll/focus return, Vault/Send search/filter + OTP search + Generator options + tab scroll restoration, one VoiceOver heading/result/success/error announcement without OTP-second chatter, light/dark/system, compact, Increase Contrast/forced colors, Reduce Transparency, Reduce Motion, and 200% text without horizontal overflow or covered actions.

Toggle VoiceOver with Command-F5 and append one row per spoken event to `design-qa.md` using exactly:

```markdown
| UTC timestamp | State ID | Focus key/control | Expected speech | Spoken text (verbatim) | Duplicate, secret, URL, or OTP-second leak | Result |
|---|---|---|---|---|---|---|
| 2026-08-17T12:00:00Z | otp-populated-search | result-announcement | one localized result count | 1 个项目 | none | PASS |
```

Record route heading, changed result count, copy success, and contextual error once each. Leave the OTP row focused for three seconds and record one separate `otp-countdown-silence` row whose spoken text is `none`; any per-second utterance is P1.

- [ ] **Step 5: Record pass, independent review, and commit**

Request separate requirements and code-quality reviews for spec + plans + `cfe371a6..HEAD`; resolve all Critical/Important findings. Then write only:

```text
P0: 0
P1: 0
P2: 0
final result: passed
```

```bash
git add -p design-qa.md
git add -f docs/superpowers/specs/assets/barwarden-ios27-auth-implementation.png docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-otp-light.png docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-detail.png docs/superpowers/specs/assets/barwarden-ios27-generator-implementation.png docs/superpowers/specs/assets/barwarden-ios27-send-implementation.png docs/superpowers/specs/assets/barwarden-ios27-settings-info-implementation.png docs/superpowers/specs/assets/barwarden-ios27-overlay-accessibility-implementation.png
git diff --cached --check
git commit -m "test: verify ios27 all-page experience"
```

## Self-review performed

- Coverage: explicit route map; main-tab scroll/search/filter and OTP state; semantic focus owners; layered Escape; permission Sheet; forms/dirty/pending/feedback/late ownership; VoiceOver/dynamic results; compact/dark/system/contrast/transparency/motion/200%; real mounted structure; native paired QA; independent reviews.
- Plan-failure placeholder scan completed with zero matches; every implementation and validation step names its concrete file, assertion, or command.
- Type consistency: `Ios27PageFamily`, `PopupLayer`, `Ios27RouteData`, `PopupFocusKey`, `OtpFacade`, cache methods, and structural case interfaces have one matching definition.

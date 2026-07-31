import "zone.js";
import "@angular/compiler";

import { Dialog as CdkDialog } from "@angular/cdk/dialog";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { importProvidersFrom, provideZoneChangeDetection } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from "@angular/router";
import { BehaviorSubject } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { DialogModule } from "@bitwarden/components/dialog/dialog.module";

import type { AuthSession } from "../../auth/auth-session-store";
import { buildSelfHostedEnvironmentFromServerUrl } from "../../bitwarden-api/bitwarden-api";
import { PopupStateStore } from "../popup-state";
import { POP_OUT_HOST, type PopOutHost } from "../popup-header-actions.component";
import { demoFolders, demoVaultItems } from "../vault-demo";
import type { VaultItem } from "./vault-item.model";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { GeneratorService } from "../generator/generator.service";
import { OfficialLoginCipherFormComponent } from "../upstream-overlays/cipher-form/official-login-cipher-form.component";
import { OfficialPersonalCipherFormComponent } from "../upstream-overlays/cipher-form/official-personal-cipher-form.component";
import {
  CheckboxComponent,
  FormControlComponent,
  OptionComponent,
  SelectComponent,
} from "../official-ui/official-components";
import {
  VAULT_CIPHER_WRITE_PORT,
  type CardCipherDraft,
  type IdentityCipherDraft,
  type LoginCipherCreateDraft,
  type SecureNoteCipherDraft,
  type VaultCipherWritePort,
} from "./vault-cipher-write.service";
import { VaultAddEditPageComponent } from "./vault-add-edit-page.component";
import { VaultFacade } from "./vault.facade";
import { VaultSessionService } from "./vault-session.service";
import { retainOpaqueCipherPayload } from "./opaque-cipher-payload";
import {
  RETAINED_LOGIN_FORM_GENERATOR,
  RETAINED_LOGIN_FORM_STATUS_STORE,
  type RetainedLoginFormSubmit,
} from "./retained-login-form.adapter";
import type { RetainedPersonalCipherFormSubmit } from "./retained-personal-cipher-form.adapter";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("VaultAddEditPageComponent", () => {
  async function createFixture(
    type: string,
    routePath = "add-cipher",
    cipherId = "",
    items = demoVaultItems,
    options: {
      session?: AuthSession;
      cipherWrite?: VaultCipherWritePort;
      popOutHost?: PopOutHost;
      generator?: Pick<GeneratorService, "generate">;
      folderId?: string;
      folders?: typeof demoFolders;
      archivedItems?: readonly VaultItem[];
      deletedItems?: readonly VaultItem[];
      vaultSession?: Pick<VaultSessionService, "syncNow">;
    } = {},
  ) {
    TestBed.resetTestingModule();
    const store = new PopupStateStore();
    store.setItems(items, options.folders);
    store.setArchivedItems(options.archivedItems ?? []);
    store.setDeletedItems(options.deletedItems ?? []);
    if (options.session) {
      store.setUnlocked("operator@example.test");
      store.setActiveSession(options.session);
    }
    const initialParams = {
      ...(type ? { type } : {}),
      ...(cipherId ? { cipherId } : {}),
      ...(options.folderId ? { folderId: options.folderId } : {}),
    };
    const queryParamMap = convertToParamMap(initialParams);
    const queryParamMap$ = new BehaviorSubject(queryParamMap);

    await TestBed.configureTestingModule({
      imports: [VaultAddEditPageComponent],
      providers: [
        OfficialI18nService,
        importProvidersFrom(DialogModule),
        provideZoneChangeDetection(),
        { provide: I18nService, useExisting: OfficialI18nService },
        provideNoopAnimations(),
        provideRouter([{ path: routePath, component: VaultAddEditPageComponent }]),
        { provide: PopupStateStore, useValue: store },
        { provide: VaultFacade, useFactory: () => new VaultFacade(store) },
        { provide: RETAINED_LOGIN_FORM_GENERATOR, useExisting: GeneratorService },
        { provide: RETAINED_LOGIN_FORM_STATUS_STORE, useValue: store },
        { provide: POP_OUT_HOST, useValue: options.popOutHost ?? null },
        ...(options.vaultSession
          ? [{ provide: VaultSessionService, useValue: options.vaultSession }]
          : []),
        ...(options.generator ? [{ provide: GeneratorService, useValue: options.generator }] : []),
        ...(options.cipherWrite ? [{ provide: VAULT_CIPHER_WRITE_PORT, useValue: options.cipherWrite }] : []),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { routeConfig: { path: routePath }, queryParamMap },
            queryParamMap: queryParamMap$.asObservable(),
          },
        },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    let routerUrl = routeUrl(routePath, initialParams);
    Object.defineProperty(router, "url", {
      configurable: true,
      get: () => routerUrl,
    });
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockImplementation(async (url) => {
      routerUrl = String(url);
      return true;
    });

    return {
      fixture: TestBed.createComponent(VaultAddEditPageComponent),
      navigateByUrl,
      router,
      setRouterUrl: (url: string) => { routerUrl = url; },
      setQuery: (params: Record<string, string>) => queryParamMap$.next(convertToParamMap(params)),
      store,
    };
  }

  it("renders the production Login branch through the retained official form only", async () => {
    const session = fakeAuthSession(TEST_USER_KEY);
    const { fixture } = await createFixture("1", "add-cipher", "", demoVaultItems, { session });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges(false);

    const official = fixture.debugElement.query(By.directive(OfficialLoginCipherFormComponent));
    const host = fixture.nativeElement as HTMLElement;
    expect(official?.componentInstance).toBeInstanceOf(OfficialLoginCipherFormComponent);
    expect(host.querySelector("bw-official-login-cipher-form")).not.toBeNull();
    expect(host.querySelector("bw-vault-form-section")).toBeNull();
    expect(host.querySelector("bw-vault-edit-field")).toBeNull();
    expect(host.querySelector("#cipher-name")).toBeNull();
  });

  it.each([
    { routePath: "add-cipher", cipherId: "", mode: "add", name: "", folderId: "work" },
    { routePath: "edit-cipher", cipherId: "github", mode: "edit", name: "GitHub", folderId: "work" },
    { routePath: "clone-cipher", cipherId: "github", mode: "clone", name: "GitHub", folderId: "work" },
  ] as const)(
    "builds exact official $mode config from route query and initial folder",
    async ({ routePath, cipherId, mode, name, folderId }) => {
      const session = fakeAuthSession(TEST_USER_KEY);
      const { fixture } = await createFixture("1", routePath, cipherId, demoVaultItems, {
        session,
        folderId: routePath === "add-cipher" ? folderId : undefined,
        folders: demoFolders,
      });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges(false);

      const official = fixture.debugElement.query(By.directive(OfficialLoginCipherFormComponent))
        .componentInstance as OfficialLoginCipherFormComponent;
      expect(official.config.mode).toBe(mode);
      expect(official.config.cipherType).toBe(CipherType.Login);
      expect(official.config.initialValues?.name).toBe(name);
      expect(official.config.initialValues?.folderId).toBe(folderId);
      expect(official.config.collections).toEqual([]);
      expect(official.config.organizations).toEqual([]);
    },
  );

  it("ignores add-route cipher identity and uses the exact query type and folder", async () => {
    const session = fakeAuthSession(TEST_USER_KEY);
    const { fixture } = await createFixture("3", "add-cipher", "github", demoVaultItems, {
      session,
      folderId: "personal",
      folders: demoFolders,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.cipherType.type).toBe("card");
    expect(fixture.componentInstance.selectedItem).toBeUndefined();
    expect(fixture.componentInstance.folderId).toBe("personal");
    expect(fixture.debugElement.query(By.directive(OfficialLoginCipherFormComponent))).toBeNull();
  });

  it("returns a typed committed result and navigates only to the returned server ID", async () => {
    const cipherWrite = new RecordingCipherWrite();
    vi.spyOn(cipherWrite, "createLoginCipher").mockResolvedValue(savedLogin("returned-server-id"));
    const session = fakeAuthSession(TEST_USER_KEY);
    const { fixture, navigateByUrl, router, store } = await createFixture(
      "1",
      "add-cipher",
      "",
      demoVaultItems,
      { session, cipherWrite },
    );

    const result = await saveOfficialLogin(fixture.componentInstance, loginSubmit("add", "Server Login"));

    expect(result).toEqual({ committed: true, item: savedLogin("returned-server-id") });
    expect(store.snapshot().items.filter((item) => item.id === "returned-server-id")).toEqual([
      savedLogin("returned-server-id"),
    ]);
    expect(navigateByUrl).toHaveBeenCalledWith("/view-cipher/returned-server-id");
    expect(router.url).toBe("/view-cipher/returned-server-id");
  });

  it("replaces the selected edit with exactly the returned server item and ID", async () => {
    const cipherWrite = new RecordingCipherWrite();
    const returned = savedLogin("returned-edit-id", "Returned edit");
    vi.spyOn(cipherWrite, "updateLoginCipher").mockResolvedValue(returned);
    const session = fakeAuthSession(TEST_USER_KEY);
    const { fixture, navigateByUrl, store } = await createFixture(
      "1",
      "edit-cipher",
      "github",
      demoVaultItems,
      { session, cipherWrite },
    );

    await expect(saveOfficialLogin(fixture.componentInstance, loginSubmit("edit", "Edited")))
      .resolves.toEqual({ committed: true, item: returned });

    expect(store.snapshot().items.some((item) => item.id === "github")).toBe(false);
    expect(store.snapshot().items.filter((item) => item.id === returned.id)).toEqual([returned]);
    expect(navigateByUrl).toHaveBeenCalledWith("/view-cipher/returned-edit-id");
  });

  it("replaces an archived Login in its exact collection and navigates to the returned ID", async () => {
    const archived = { ...demoVaultItems[0], id: "archived-login" };
    const returned = savedLogin("returned-archived-id", "Returned archived edit");
    const cipherWrite = new RecordingCipherWrite();
    vi.spyOn(cipherWrite, "updateLoginCipher").mockResolvedValue(returned);
    const session = fakeAuthSession(TEST_USER_KEY);
    const { fixture, navigateByUrl, store } = await createFixture(
      "1",
      "edit-cipher",
      archived.id,
      demoVaultItems.slice(1),
      { session, cipherWrite, archivedItems: [archived] },
    );

    await expect(saveOfficialLogin(fixture.componentInstance, loginSubmit("edit", "Archived edit")))
      .resolves.toEqual({ committed: true, item: returned });

    expect(store.snapshot().items).toEqual(demoVaultItems.slice(1));
    expect(store.snapshot().archivedItems).toEqual([returned]);
    expect(store.snapshot().archivedItems[0]).toBe(returned);
    expect(store.snapshot().deletedItems).toEqual([]);
    expect(navigateByUrl).toHaveBeenCalledWith("/view-cipher/returned-archived-id");
  });

  it("fails closed before transport when an edited Login is deleted", async () => {
    const deleted = { ...demoVaultItems[0], id: "deleted-login" };
    const cipherWrite = new RecordingCipherWrite();
    const updateLoginCipher = vi.spyOn(cipherWrite, "updateLoginCipher");
    const session = fakeAuthSession(TEST_USER_KEY);
    const { fixture, navigateByUrl, store } = await createFixture(
      "1",
      "edit-cipher",
      deleted.id,
      demoVaultItems.slice(1),
      { session, cipherWrite, deletedItems: [deleted] },
    );

    await expect(saveOfficialLogin(fixture.componentInstance, loginSubmit("edit", "Deleted edit")))
      .resolves.toEqual({ committed: false, reason: "failure" });

    expect(updateLoginCipher).not.toHaveBeenCalled();
    expect(store.snapshot().items).toEqual(demoVaultItems.slice(1));
    expect(store.snapshot().deletedItems).toEqual([deleted]);
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it("rejects a stale selected Login object before edit transport", async () => {
    const cipherWrite = new RecordingCipherWrite();
    const updateLoginCipher = vi.spyOn(cipherWrite, "updateLoginCipher");
    const session = fakeAuthSession(TEST_USER_KEY);
    const { fixture, navigateByUrl, store } = await createFixture(
      "1",
      "edit-cipher",
      "github",
      demoVaultItems,
      { session, cipherWrite },
    );
    const replacement = { ...demoVaultItems[0], name: "Synced replacement before save" };
    store.setItems([replacement, ...demoVaultItems.slice(1)]);

    await expect(saveOfficialLogin(fixture.componentInstance, loginSubmit("edit", "Stale form")))
      .resolves.toEqual({ committed: false, reason: "stale" });

    expect(updateLoginCipher).not.toHaveBeenCalled();
    expect(store.snapshot().items[0]).toBe(replacement);
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it("suppresses official success when a bound stale edit is rejected before transport", async () => {
    const cipherWrite = new RecordingCipherWrite();
    const updateLoginCipher = vi.spyOn(cipherWrite, "updateLoginCipher");
    const session = fakeAuthSession(TEST_USER_KEY);
    const { fixture, navigateByUrl, store } = await createFixture(
      "1",
      "edit-cipher",
      "github",
      demoVaultItems,
      { session, cipherWrite },
    );
    const official = await initializeOfficialForm(fixture, "Stale bound form");
    const replacement = { ...demoVaultItems[0], name: "Sync won before submit" };
    store.setItems([replacement, ...demoVaultItems.slice(1)]);

    await official.submit();

    expect(updateLoginCipher).not.toHaveBeenCalled();
    expect(store.snapshot().items[0]).toBe(replacement);
    expect(store.snapshot().statusMessage).not.toMatch(/已添加|已编辑|added|edited/i);
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it("awaits the bound official submit transport without premature local success", async () => {
    await new OfficialI18nService().setLocale("zh-CN");
    const cipherWrite = new RecordingCipherWrite();
    const pending = deferred<VaultItem>();
    vi.spyOn(cipherWrite, "createLoginCipher").mockReturnValue(pending.promise);
    const session = fakeAuthSession(TEST_USER_KEY);
    const { fixture, navigateByUrl, store } = await createFixture("1", "add-cipher", "", demoVaultItems, {
      session,
      cipherWrite,
    });
    const official = await initializeOfficialForm(fixture, "Bound server Login");
    let submitResolved = false;

    const submitting = official.submit().then(() => { submitResolved = true; });
    await vi.waitFor(() => expect(cipherWrite.createLoginCipher).toHaveBeenCalledOnce());

    expect(submitResolved).toBe(false);
    expect(store.snapshot().statusMessage).toBe("");
    expect(navigateByUrl).not.toHaveBeenCalled();

    const returned = savedLogin("bound-server-id", "Bound server Login");
    pending.resolve(returned);
    await submitting;

    expect(submitResolved).toBe(true);
    expect(store.snapshot().items).toContain(returned);
    expect(store.snapshot().statusMessage).toBe("项目已保存");
    expect(navigateByUrl).toHaveBeenCalledWith("/view-cipher/bound-server-id");
  });

  it("suppresses duplicate transport through the bound official submit path", async () => {
    const cipherWrite = new RecordingCipherWrite();
    const pending = deferred<VaultItem>();
    vi.spyOn(cipherWrite, "createLoginCipher").mockReturnValue(pending.promise);
    const session = fakeAuthSession(TEST_USER_KEY);
    const { fixture } = await createFixture("1", "add-cipher", "", demoVaultItems, {
      session,
      cipherWrite,
    });
    const official = await initializeOfficialForm(fixture, "Bound duplicate Login");

    const first = official.submit();
    await vi.waitFor(() => expect(cipherWrite.createLoginCipher).toHaveBeenCalledOnce());
    await official.submit();
    expect(cipherWrite.createLoginCipher).toHaveBeenCalledOnce();

    pending.resolve(savedLogin("bound-duplicate-id"));
    await first;
  });

  it("keeps a committed result and fixed feedback when navigation returns false", async () => {
    const cipherWrite = new RecordingCipherWrite();
    const returned = savedLogin("committed-navigation-false");
    vi.spyOn(cipherWrite, "createLoginCipher").mockResolvedValue(returned);
    const session = fakeAuthSession(TEST_USER_KEY);
    const { fixture, navigateByUrl, store } = await createFixture("1", "add-cipher", "", demoVaultItems, {
      session,
      cipherWrite,
    });
    navigateByUrl.mockResolvedValue(false);

    await expect(saveOfficialLogin(fixture.componentInstance, loginSubmit("add", "Committed")))
      .resolves.toEqual({ committed: true, item: returned });

    expect(store.snapshot().items).toContain(returned);
    expect(store.snapshot().statusMessage).toBe("项目已保存，但无法打开。");
  });

  it("keeps a committed result and fixed feedback when navigation rejects", async () => {
    const cipherWrite = new RecordingCipherWrite();
    const returned = savedLogin("committed-navigation-reject");
    vi.spyOn(cipherWrite, "createLoginCipher").mockResolvedValue(returned);
    const session = fakeAuthSession(TEST_USER_KEY);
    const { fixture, navigateByUrl, store } = await createFixture("1", "add-cipher", "", demoVaultItems, {
      session,
      cipherWrite,
    });
    navigateByUrl.mockRejectedValue(new Error("private router detail"));

    await expect(saveOfficialLogin(fixture.componentInstance, loginSubmit("add", "Committed")))
      .resolves.toEqual({ committed: true, item: returned });

    expect(store.snapshot().items).toContain(returned);
    expect(store.snapshot().statusMessage).toBe("项目已保存，但无法打开。");
    expect(store.snapshot().statusMessage).not.toContain("private router detail");
  });

  it.each([
    { routePath: "add-cipher", mode: "add", cipherId: "", navigation: "false" },
    { routePath: "add-cipher", mode: "add", cipherId: "", navigation: "reject" },
    { routePath: "clone-cipher", mode: "clone", cipherId: "github", navigation: "false" },
    { routePath: "clone-cipher", mode: "clone", cipherId: "github", navigation: "reject" },
    { routePath: "edit-cipher", mode: "edit", cipherId: "github", navigation: "false" },
    { routePath: "edit-cipher", mode: "edit", cipherId: "github", navigation: "reject" },
  ] as const)(
    "seals the bound $mode route after committed navigation $navigation",
    async ({ routePath, mode, cipherId, navigation }) => {
      const cipherWrite = new RecordingCipherWrite();
      const returned = savedLogin(`terminal-${mode}-${navigation}`, "Committed terminal Login");
      const createLoginCipher = vi.spyOn(cipherWrite, "createLoginCipher").mockResolvedValue(returned);
      const updateLoginCipher = vi.spyOn(cipherWrite, "updateLoginCipher").mockResolvedValue(returned);
      const session = fakeAuthSession(TEST_USER_KEY);
      const { fixture, navigateByUrl, store } = await createFixture(
        "1",
        routePath,
        cipherId,
        demoVaultItems,
        { session, cipherWrite },
      );
      const official = await initializeOfficialForm(fixture, "Committed terminal Login");
      if (navigation === "false") {
        navigateByUrl.mockResolvedValue(false);
      } else {
        navigateByUrl.mockRejectedValue(new Error("private navigation failure"));
      }

      await official.submit();
      fixture.changeDetectorRef.detectChanges();

      expect(store.snapshot().statusMessage).toBe("项目已保存，但无法打开。");
      expect(store.snapshot().statusMessage).not.toContain("server-secret");
      expect(fixture.componentInstance.canSubmitOfficialLogin).toBe(false);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
          'footer button[type="submit"]',
        )?.getAttribute("aria-disabled"),
      ).toBe("true");
      expect(
        (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
          'input[formcontrolname="name"]',
        )?.disabled,
      ).toBe(true);
      expect(store.snapshot().items.filter((item) => item.id === returned.id)).toEqual([returned]);
      expect(JSON.stringify(navigateByUrl.mock.calls)).not.toContain("server-secret");

      await expect(
        saveOfficialLogin(
          fixture.componentInstance,
          loginSubmit(mode, "Forbidden direct retry", "server-secret"),
        ),
      ).resolves.toEqual({ committed: false, reason: "stale" });
      await official.submit();

      expect(createLoginCipher).toHaveBeenCalledTimes(mode === "edit" ? 0 : 1);
      expect(updateLoginCipher).toHaveBeenCalledTimes(mode === "edit" ? 1 : 0);
      expect(navigateByUrl).toHaveBeenCalledTimes(1);

      (Reflect.get(official, "cipherForm") as { markAsPristine(): void }).markAsPristine();
      navigateByUrl.mockResolvedValue(false);
      if (navigation === "false") {
        await fixture.componentInstance.backToVault();
      } else {
        await fixture.componentInstance.cancel(document.body);
      }
      expect(navigateByUrl).toHaveBeenLastCalledWith("/tabs/vault");
      expect(fixture.componentInstance.canSubmitOfficialLogin).toBe(false);

      await expect(
        saveOfficialLogin(fixture.componentInstance, loginSubmit(mode, "Retry after back")),
      ).resolves.toEqual({ committed: false, reason: "stale" });
      await official.submit();
      expect(createLoginCipher).toHaveBeenCalledTimes(mode === "edit" ? 0 : 1);
      expect(updateLoginCipher).toHaveBeenCalledTimes(mode === "edit" ? 1 : 0);
    },
  );

  it("suppresses a duplicate official submit without a second transport", async () => {
    const cipherWrite = new RecordingCipherWrite();
    const pending = deferred<VaultItem>();
    vi.spyOn(cipherWrite, "createLoginCipher").mockReturnValue(pending.promise);
    const session = fakeAuthSession(TEST_USER_KEY);
    const { fixture } = await createFixture("1", "add-cipher", "", demoVaultItems, {
      session,
      cipherWrite,
    });
    const submit = loginSubmit("add", "One transport");
    const save = (fixture.componentInstance as unknown as {
      saveOfficialLogin?: (value: RetainedLoginFormSubmit) => Promise<ExpectedLoginSaveResult>;
    }).saveOfficialLogin;
    expect(save).toBeTypeOf("function");
    if (!save) {
      return;
    }

    const first = save.call(fixture.componentInstance, submit);
    await Promise.resolve();
    await expect(save.call(fixture.componentInstance, submit)).resolves.toEqual({
      committed: false,
      reason: "duplicate",
    });
    expect(cipherWrite.createLoginCipher).toHaveBeenCalledOnce();

    pending.resolve(savedLogin("one-transport-id"));
    await expect(first).resolves.toEqual({ committed: true, item: savedLogin("one-transport-id") });
  });

  it.each(["route-away", "account-switch", "lock", "logout", "stale-sync"] as const)(
    "resolves a late create as stale after $s",
    async (cause) => {
      const cipherWrite = new RecordingCipherWrite();
      const pending = deferred<VaultItem>();
      vi.spyOn(cipherWrite, "createLoginCipher").mockReturnValue(pending.promise);
      const session = fakeAuthSession(TEST_USER_KEY);
      const { fixture, navigateByUrl, setRouterUrl, store } = await createFixture(
        "1",
        "add-cipher",
        "",
        demoVaultItems,
        { session, cipherWrite },
      );
      const saving = saveOfficialLogin(fixture.componentInstance, loginSubmit("add", "Late create"));
      await Promise.resolve();

      if (cause === "route-away") {
        setRouterUrl("/tabs/vault");
      } else if (cause === "account-switch") {
        store.setActiveSession({
          ...session,
          token: { ...session.token, accessToken: "other-account-token" },
        });
      } else if (cause === "lock") {
        store.setLocked();
      } else if (cause === "logout") {
        store.setLoggedOut();
      } else {
        store.setItems([...demoVaultItems]);
      }

      pending.resolve(savedLogin(`late-${cause}`));
      await expect(saving).resolves.toEqual({ committed: false, reason: "stale" });
      expect(store.snapshot().items.some((item) => item.id === `late-${cause}`)).toBe(false);
      expect(navigateByUrl).not.toHaveBeenCalled();
    },
  );

  it("resolves a late update as stale after selected item object replacement", async () => {
    const cipherWrite = new RecordingCipherWrite();
    const pending = deferred<VaultItem>();
    vi.spyOn(cipherWrite, "updateLoginCipher").mockReturnValue(pending.promise);
    const session = fakeAuthSession(TEST_USER_KEY);
    const { fixture, navigateByUrl, store } = await createFixture(
      "1",
      "edit-cipher",
      "github",
      demoVaultItems,
      { session, cipherWrite },
    );
    const saving = saveOfficialLogin(fixture.componentInstance, loginSubmit("edit", "Late update"));
    await Promise.resolve();
    const replacement = { ...demoVaultItems[0], name: "Synced replacement" };
    store.setItems([replacement, ...demoVaultItems.slice(1)]);

    pending.resolve(savedLogin("github", "Late update"));
    await expect(saving).resolves.toEqual({ committed: false, reason: "stale" });
    expect(store.snapshot().items[0]).toBe(replacement);
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it("keeps official values and publishes only fixed feedback after server failure", async () => {
    const cipherWrite = new RecordingCipherWrite();
    vi.spyOn(cipherWrite, "createLoginCipher").mockRejectedValue(new Error("private server detail"));
    const session = fakeAuthSession(TEST_USER_KEY);
    const { fixture, navigateByUrl, store } = await createFixture("1", "add-cipher", "", demoVaultItems, {
      session,
      cipherWrite,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const name = host.querySelector<HTMLInputElement>('input[formcontrolname="name"]')!;
    name.value = "Unsent Login";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    const password = host.querySelector<HTMLInputElement>('input[formcontrolname="password"]')!;
    password.value = "failure-secret";
    password.dispatchEvent(new Event("input", { bubbles: true }));
    const official = fixture.debugElement.query(By.directive(OfficialLoginCipherFormComponent))
      .componentInstance as OfficialLoginCipherFormComponent;

    await official.submit();
    await vi.waitFor(() => expect(store.snapshot().statusMessage).toBe("无法保存项目，请重试。"));
    fixture.detectChanges();

    expect(host.querySelector<HTMLInputElement>('input[formcontrolname="name"]')?.value).toBe("Unsent Login");
    expect(host.querySelector<HTMLInputElement>('input[formcontrolname="password"]')?.value).toBe("failure-secret");
    expect(store.snapshot().statusMessage).not.toContain("private server detail");
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it("uses the official required-name validation before transport", async () => {
    const cipherWrite = new RecordingCipherWrite();
    const createLoginCipher = vi.spyOn(cipherWrite, "createLoginCipher");
    const session = fakeAuthSession(TEST_USER_KEY);
    const { fixture } = await createFixture("1", "add-cipher", "", demoVaultItems, {
      session,
      cipherWrite,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const official = fixture.debugElement.query(By.directive(OfficialLoginCipherFormComponent))
      .componentInstance as OfficialLoginCipherFormComponent;

    await official.submit();
    fixture.detectChanges();

    expect(createLoginCipher).not.toHaveBeenCalled();
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLInputElement>('input[formcontrolname="name"]')
        ?.getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("preserves opaque edit ownership and strips it from clone creation", async () => {
    const opaqueLogin = {
      ...demoVaultItems[0],
      id: "opaque-login",
      opaqueServerPayload: retainOpaqueCipherPayload({
        Id: "opaque-login",
        Type: 1,
        FutureServerField: "2.synthetic-opaque",
      }),
    };
    const items = [opaqueLogin, ...demoVaultItems.slice(1)];
    const session = fakeAuthSession(TEST_USER_KEY);
    const editWrite = new RecordingCipherWrite();
    vi.spyOn(editWrite, "updateLoginCipher").mockResolvedValue(savedLogin("opaque-login", "Edited"));
    const edit = await createFixture("1", "edit-cipher", "opaque-login", items, {
      session,
      cipherWrite: editWrite,
    });

    await saveOfficialLogin(edit.fixture.componentInstance, loginSubmit("edit", "Edited"));

    expect(editWrite.updateLoginCipher).toHaveBeenCalledWith(
      session,
      opaqueLogin,
      expect.objectContaining({ name: "Edited" }),
    );

    const cloneWrite = new RecordingCipherWrite();
    vi.spyOn(cloneWrite, "createLoginCipher").mockResolvedValue(savedLogin("clone-server-id", "Clone"));
    const clone = await createFixture("1", "clone-cipher", "opaque-login", items, {
      session,
      cipherWrite: cloneWrite,
    });
    await saveOfficialLogin(clone.fixture.componentInstance, loginSubmit("clone", "Clone"));

    const cloneDraft = vi.mocked(cloneWrite.createLoginCipher).mock.calls[0]?.[1];
    expect(cloneDraft).toEqual(expect.objectContaining({ name: "Clone" }));
    expect(JSON.stringify(cloneDraft)).not.toContain("opaque-login");
    expect(JSON.stringify(cloneDraft)).not.toContain("FutureServerField");
    expect(cloneWrite.calls.some((call) => call.type === "updateLogin")).toBe(false);
  });

  it("fails closed before transport when an edit requires vault sync", async () => {
    const selected = { ...demoVaultItems[0], requiresVaultSyncBeforeEdit: true };
    const cipherWrite = new RecordingCipherWrite();
    const updateLoginCipher = vi.spyOn(cipherWrite, "updateLoginCipher");
    const session = fakeAuthSession(TEST_USER_KEY);
    const { fixture } = await createFixture("1", "edit-cipher", selected.id, [selected], {
      session,
      cipherWrite,
    });

    await expect(saveOfficialLogin(fixture.componentInstance, loginSubmit("edit", "Blocked"))).resolves.toEqual({
      committed: false,
      reason: "failure",
    });
    expect(updateLoginCipher).not.toHaveBeenCalled();
  });

  it("refreshes a sync-required edit and enables the server-backed item", async () => {
    const selected = { ...demoVaultItems[0], requiresVaultSyncBeforeEdit: true };
    const refreshed = { ...demoVaultItems[0], name: "Synced server item" };
    const session = fakeAuthSession(TEST_USER_KEY);
    const syncCompletion = deferred<void>();
    let store!: PopupStateStore;
    const syncNow = vi.fn(() => syncCompletion.promise);
    const created = await createFixture("1", "edit-cipher", selected.id, [selected], {
      session,
      vaultSession: { syncNow },
    });
    store = created.store;

    created.fixture.detectChanges();
    store.setItems([refreshed]);
    syncCompletion.resolve();
    await created.fixture.whenStable();
    created.fixture.detectChanges();

    expect(syncNow).toHaveBeenCalledOnce();
    expect(created.fixture.componentInstance.selectedItem).toBe(refreshed);
    expect(created.fixture.componentInstance.canSubmitOfficialLogin).toBe(true);
  });

  it("never creates a local Login when the unlocked server session is unavailable", async () => {
    const cipherWrite = new RecordingCipherWrite();
    const createLoginCipher = vi.spyOn(cipherWrite, "createLoginCipher");
    const { fixture, navigateByUrl, store } = await createFixture("1", "add-cipher", "", demoVaultItems, {
      cipherWrite,
    });

    await expect(saveOfficialLogin(fixture.componentInstance, loginSubmit("add", "No session"))).resolves.toEqual({
      committed: false,
      reason: "failure",
    });
    expect(createLoginCipher).not.toHaveBeenCalled();
    expect(store.snapshot().items).toEqual(demoVaultItems);
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it.each(["back", "cancel"] as const)(
    "uses the official confirmation dialog for dirty %s and restores trigger focus on cancellation",
    async (action) => {
      const session = fakeAuthSession(TEST_USER_KEY);
      const { fixture, navigateByUrl } = await createFixture("1", "add-cipher", "", demoVaultItems, {
        session,
      });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges(false);
      const host = fixture.nativeElement as HTMLElement;
      const name = host.querySelector<HTMLInputElement>('input[formcontrolname="name"]')!;
      name.value = "Dirty Login";
      name.dispatchEvent(new Event("input", { bubbles: true }));
      fixture.detectChanges(false);
      const trigger = action === "back"
        ? host.querySelector<HTMLButtonElement>('popup-header button[aria-label="返回"]')!
        : host.querySelectorAll<HTMLButtonElement>("footer button")[1]!;
      trigger.focus();

      trigger.click();
      await vi.waitFor(() => expect(TestBed.inject(CdkDialog).openDialogs).toHaveLength(1));
      detectOpenDialogs();
      const dialog = [...document.querySelectorAll<HTMLElement>(".cdk-overlay-pane")]
        .find((pane) => pane.textContent?.includes("放弃更改？"));
      expect(dialog).toBeDefined();
      expect(dialog!.querySelector('form[bit-simple-dialog]')).not.toBeNull();
      expect(dialog!.textContent).toContain("放弃更改？");
      expect(dialog!.textContent).toContain("您有未保存的更改。确定要放弃吗？");
      clickDialogButton("取消");
      await vi.waitFor(() => expect(TestBed.inject(CdkDialog).openDialogs).toHaveLength(0));

      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(trigger);
    },
  );

  it("never serializes an official Login secret into navigation, history, storage, or logs", async () => {
    const cipherWrite = new RecordingCipherWrite();
    vi.spyOn(cipherWrite, "createLoginCipher").mockResolvedValue(savedLogin("redacted-server-id"));
    const localStorageSet = vi.spyOn(Storage.prototype, "setItem");
    const pushState = vi.spyOn(History.prototype, "pushState");
    const replaceState = vi.spyOn(History.prototype, "replaceState");
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const session = fakeAuthSession(TEST_USER_KEY);
    const { fixture, navigateByUrl } = await createFixture("1", "add-cipher", "", demoVaultItems, {
      session,
      cipherWrite,
    });

    await saveOfficialLogin(
      fixture.componentInstance,
      loginSubmit("add", "Redacted", "never-serialize-this-secret"),
    );

    const serializedSideEffects = JSON.stringify([
      navigateByUrl.mock.calls,
      localStorageSet.mock.calls,
      pushState.mock.calls,
      replaceState.mock.calls,
      consoleLog.mock.calls,
      consoleWarn.mock.calls,
      consoleError.mock.calls,
    ]);
    expect(serializedSideEffects).not.toContain("never-serialize-this-secret");
    expect(navigateByUrl).toHaveBeenCalledWith("/view-cipher/redacted-server-id");

    localStorageSet.mockRestore();
    pushState.mockRestore();
    replaceState.mockRestore();
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  it("maps the official add-edit pop-out action to the native menubar window command", async () => {
    const calls: string[] = [];
    const { fixture } = await createFixture("1", "edit-cipher", "github", demoVaultItems, {
      popOutHost: { popOut: async (route: string) => calls.push(route) },
    });
    const router = TestBed.inject(Router);
    Object.defineProperty(router, "url", { value: "/edit-cipher?cipherId=github&type=1", configurable: true });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const popOut = host.querySelector<HTMLButtonElement>('[aria-label="弹出到新窗口"]');
    expect(popOut).not.toBeNull();
    expect(popOut?.disabled).toBe(false);
    popOut!.click();
    await fixture.whenStable();

    expect(calls).toEqual(["/edit-cipher?cipherId=github&type=1"]);
  });

  it("uses the selected cipher type when a conflicting query type is supplied", async () => {
    const { fixture } = await createFixture("3", "edit-cipher", "github");
    fixture.detectChanges();

    expect(fixture.componentInstance.cipherType.type).toBe("login");
    expect((fixture.nativeElement as HTMLElement).textContent).toContain("编辑登录");
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain("支付卡信息");
  });

  it.each(PERSONAL_ROUTE_CASES)(
    "binds $label $mode only through the official form",
    async ({ queryType, routePath, cipherId }) => {
      const { fixture } = await createFixture(queryType, routePath, cipherId, demoVaultItems, {
        session: fakeAuthSession(TEST_USER_KEY),
        cipherWrite: new RecordingCipherWrite(),
      });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges(false);

      const host = fixture.nativeElement as HTMLElement;
      expect(fixture.debugElement.query(By.directive(OfficialPersonalCipherFormComponent))).not.toBeNull();
      expect(host.querySelector("bw-official-personal-cipher-form")).not.toBeNull();
      expect(host.querySelector("#cipher-cardholder")).toBeNull();
      expect(host.querySelector("[aria-label='名字']")).toBeNull();
      expect((fixture.componentInstance as unknown as { save?: unknown }).save).toBeUndefined();
    },
  );

  it.each(PERSONAL_CREATE_CASES)(
    "commits the returned server ID only to active items for $label $mode",
    async ({ type, queryType, routePath, cipherId, mode }) => {
      const write = new RecordingCipherWrite();
      const returned = serverPersonalItem(type, `server-${type}-${mode}`);
      mockPersonalWrite(write, type, mode, Promise.resolve(returned));
      const { fixture, store, navigateByUrl } = await createFixture(
        queryType,
        routePath,
        cipherId,
        demoVaultItems,
        { session: fakeAuthSession(TEST_USER_KEY), cipherWrite: write },
      );

      await expect(saveOfficialPersonal(
        fixture.componentInstance,
        personalSubmit(type, mode),
      )).resolves.toEqual({ committed: true, item: returned });

      expect(store.snapshot().items[0]).toBe(returned);
      expect(store.snapshot().archivedItems).toEqual([]);
      expect(store.snapshot().deletedItems).toEqual([]);
      expect(navigateByUrl).toHaveBeenCalledWith(`/view-cipher/${encodeURIComponent(returned.id)}`);
      expect(personalCallsFor(write, type)).toBe(1);
    },
  );

  it.each(PERSONAL_CREATE_CASES.flatMap((entry) =>
    MALFORMED_PERSONAL_ID_CASES.map((malformedId) => ({ ...entry, malformedId }))))(
    "fails $label $mode when the server returns a $malformedId.label ID without a local fallback",
    async ({ type, queryType, routePath, cipherId, mode, malformedId }) => {
      const write = new RecordingCipherWrite();
      const malformed = malformedId.value(serverPersonalItem(type, `unused-${type}-${mode}`));
      mockPersonalWrite(write, type, mode, Promise.resolve(malformed as VaultItem));
      const { fixture, store, navigateByUrl } = await createFixture(
        queryType,
        routePath,
        cipherId,
        demoVaultItems,
        { session: fakeAuthSession(TEST_USER_KEY), cipherWrite: write },
      );
      await initializeOfficialPersonalForm(fixture, "Retained malformed draft");
      const before = store.snapshot();

      await expect(saveOfficialPersonal(
        fixture.componentInstance,
        personalSubmit(type, mode, "Retained malformed draft"),
      )).resolves.toEqual({ committed: false, reason: "failure" });

      expect(store.snapshot().items).toBe(before.items);
      expect(store.snapshot().archivedItems).toBe(before.archivedItems);
      expect(store.snapshot().deletedItems).toBe(before.deletedItems);
      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(personalNameInput(fixture).value).toBe("Retained malformed draft");
      expect(store.snapshot().statusMessage).toBe("无法保存项目，请重试。");
      expect((fixture.componentInstance as unknown as { canSubmitOfficialPersonal: boolean })
        .canSubmitOfficialPersonal).toBe(true);
      expect(JSON.stringify(store.snapshot())).not.toContain("pending-sync-");
      expect(JSON.stringify(navigateByUrl.mock.calls)).not.toContain("pending-sync-");
    },
  );

  it.each(PERSONAL_TYPES)(
    "replaces the exact active $label edit with the returned server object",
    async ({ type, queryType, itemId }) => {
      const selected = personalItem(type);
      const returned = serverPersonalItem(type, `returned-${type}`);
      const write = new RecordingCipherWrite();
      mockPersonalWrite(write, type, "edit", Promise.resolve(returned));
      const { fixture, store } = await createFixture(queryType, "edit-cipher", itemId, demoVaultItems, {
        session: fakeAuthSession(TEST_USER_KEY),
        cipherWrite: write,
      });

      await expect(saveOfficialPersonal(
        fixture.componentInstance,
        personalSubmit(type, "edit"),
      )).resolves.toEqual({ committed: true, item: returned });

      expect(store.snapshot().items).not.toContain(selected);
      expect(store.snapshot().items.find((item) => item.id === returned.id)).toBe(returned);
      expect(store.snapshot().archivedItems).toEqual([]);
    },
  );

  it.each(PERSONAL_TYPES)(
    "replaces the exact archived $label edit and keeps it archived",
    async ({ type, queryType, itemId }) => {
      const archived = { ...personalItem(type), id: itemId };
      const returned = serverPersonalItem(type, `returned-archived-${type}`);
      const write = new RecordingCipherWrite();
      mockPersonalWrite(write, type, "edit", Promise.resolve(returned));
      const active = demoVaultItems.filter((item) => item.id !== itemId);
      const { fixture, store } = await createFixture(queryType, "edit-cipher", itemId, active, {
        session: fakeAuthSession(TEST_USER_KEY),
        cipherWrite: write,
        archivedItems: [archived],
      });

      await expect(saveOfficialPersonal(
        fixture.componentInstance,
        personalSubmit(type, "edit"),
      )).resolves.toEqual({ committed: true, item: returned });

      expect(store.snapshot().items.some((item) => item.id === returned.id)).toBe(false);
      expect(store.snapshot().archivedItems).toEqual([returned]);
      expect(store.snapshot().archivedItems[0]).toBe(returned);
    },
  );

  it.each(PERSONAL_TYPES)(
    "fails a deleted $label edit before transport",
    async ({ type, queryType, itemId }) => {
      const deleted = { ...personalItem(type), id: itemId };
      const write = new RecordingCipherWrite();
      const active = demoVaultItems.filter((item) => item.id !== itemId);
      const { fixture, store } = await createFixture(queryType, "edit-cipher", itemId, active, {
        session: fakeAuthSession(TEST_USER_KEY),
        cipherWrite: write,
        deletedItems: [deleted],
      });

      await expect(saveOfficialPersonal(
        fixture.componentInstance,
        personalSubmit(type, "edit"),
      )).resolves.toEqual({ committed: false, reason: "failure" });

      expect(personalCallsFor(write, type)).toBe(0);
      expect(store.snapshot().deletedItems).toEqual([deleted]);
      expect(store.snapshot().statusMessage).toBe("无法保存项目，请重试。");
    },
  );

  it.each(PERSONAL_TYPES)(
    "rejects a stale selected $label object before edit transport",
    async ({ type, queryType, itemId }) => {
      const write = new RecordingCipherWrite();
      const { fixture, store } = await createFixture(queryType, "edit-cipher", itemId, demoVaultItems, {
        session: fakeAuthSession(TEST_USER_KEY),
        cipherWrite: write,
      });
      const replacement = { ...personalItem(type), name: "Replacement before submit" };
      store.setItems(store.snapshot().items.map((item) => item.id === itemId ? replacement : item));

      await expect(saveOfficialPersonal(
        fixture.componentInstance,
        personalSubmit(type, "edit"),
      )).resolves.toEqual({ committed: false, reason: "stale" });

      expect(personalCallsFor(write, type)).toBe(0);
      expect(store.snapshot().items.find((item) => item.id === itemId)).toBe(replacement);
    },
  );

  it.each(PERSONAL_TYPES)(
    "fails $label personal organization or collection ownership before transport",
    async ({ type, queryType, itemId }) => {
      for (const ownership of [
        { organizationId: "private-org", collectionIds: [] },
        { organizationId: undefined, collectionIds: ["private-collection"] },
      ]) {
        const selected = { ...personalItem(type), ...ownership };
        const items = demoVaultItems.map((item) => item.id === itemId ? selected : item);
        const write = new RecordingCipherWrite();
        const { fixture } = await createFixture(queryType, "edit-cipher", itemId, items, {
          session: fakeAuthSession(TEST_USER_KEY),
          cipherWrite: write,
        });

        await expect(saveOfficialPersonal(
          fixture.componentInstance,
          personalSubmit(type, "edit"),
        )).resolves.toEqual({ committed: false, reason: "failure" });
        expect(personalCallsFor(write, type)).toBe(0);
        fixture.destroy();
      }
    },
  );

  it.each(PERSONAL_TYPES)(
    "rejects submitted $label organization and collection ownership before transport",
    async ({ type, queryType }) => {
      for (const ownership of [
        { organizationId: "private-org", collectionIds: [] },
        { organizationId: null, collectionIds: ["private-collection"] },
      ]) {
        const write = new RecordingCipherWrite();
        const { fixture } = await createFixture(queryType, "add-cipher", "", demoVaultItems, {
          session: fakeAuthSession(TEST_USER_KEY),
          cipherWrite: write,
        });
        const submit = personalSubmit(type, "add");
        submit.value.organizationId = ownership.organizationId;
        submit.value.collectionIds = ownership.collectionIds;

        await expect(saveOfficialPersonal(fixture.componentInstance, submit)).resolves.toEqual({
          committed: false,
          reason: "failure",
        });
        expect(personalCallsFor(write, type)).toBe(0);
        fixture.destroy();
      }
    },
  );

  it.each(PERSONAL_TYPES)(
    "never creates a local $label when session or user key is missing",
    async ({ type, queryType }) => {
      for (const session of [undefined, fakeAuthSession("")]) {
        const write = new RecordingCipherWrite();
        const { fixture, store } = await createFixture(queryType, "add-cipher", "", demoVaultItems, {
          ...(session ? { session } : {}),
          cipherWrite: write,
        });
        await initializeOfficialPersonalForm(fixture, "Retained value");
        const before = store.snapshot().items;

        await expect(saveOfficialPersonal(
          fixture.componentInstance,
          personalSubmit(type, "add", "Retained value"),
        )).resolves.toEqual({ committed: false, reason: "failure" });

        expect(store.snapshot().items).toBe(before);
        expect(store.snapshot().items.some((item) => item.id.startsWith("local-"))).toBe(false);
        expect(personalNameInput(fixture).value).toBe("Retained value");
        expect(store.snapshot().statusMessage).toBe("无法保存项目，请重试。");
        expect(personalCallsFor(write, type)).toBe(0);
        fixture.destroy();
      }
    },
  );

  it.each(PERSONAL_TYPES)(
    "returns duplicate for a pending $label click and performs one transport",
    async ({ type, queryType }) => {
      const pending = deferred<VaultItem>();
      const write = new RecordingCipherWrite();
      mockPersonalWrite(write, type, "add", pending.promise);
      const { fixture } = await createFixture(queryType, "add-cipher", "", demoVaultItems, {
        session: fakeAuthSession(TEST_USER_KEY),
        cipherWrite: write,
      });
      const submit = personalSubmit(type, "add");

      const first = saveOfficialPersonal(fixture.componentInstance, submit);
      await vi.waitFor(() => expect(personalCallsFor(write, type)).toBe(1));
      await expect(saveOfficialPersonal(fixture.componentInstance, submit)).resolves.toEqual({
        committed: false,
        reason: "duplicate",
      });
      pending.resolve(serverPersonalItem(type, `one-${type}`));
      await expect(first).resolves.toMatchObject({ committed: true });
      expect(personalCallsFor(write, type)).toBe(1);
    },
  );

  it.each(PERSONAL_RACE_CASES)(
    "makes a late $label result stale after $cause ownership replacement",
    async ({ type, queryType, cause }) => {
      const pending = deferred<VaultItem>();
      const write = new RecordingCipherWrite();
      mockPersonalWrite(write, type, "add", pending.promise);
      const session = fakeAuthSession(TEST_USER_KEY);
      const { fixture, store, setRouterUrl } = await createFixture(
        queryType,
        "add-cipher",
        "",
        demoVaultItems,
        { session, cipherWrite: write },
      );
      const before = store.snapshot().items;
      const saving = saveOfficialPersonal(fixture.componentInstance, personalSubmit(type, "add"));
      await vi.waitFor(() => expect(personalCallsFor(write, type)).toBe(1));

      replaceOwnership(cause, store, setRouterUrl, session);
      const replaced = store.snapshot();
      pending.resolve(serverPersonalItem(type, `late-${type}-${cause}`));

      await expect(saving).resolves.toEqual({ committed: false, reason: "stale" });
      expect(store.snapshot().items).toBe(replaced.items);
      expect(store.snapshot().items.some((item) => item.id.startsWith("late-"))).toBe(false);
      if (cause === "route") expect(store.snapshot().items).toBe(before);
    },
  );

  it.each(PERSONAL_TYPES)(
    "makes a late $label edit stale after selected-object replacement",
    async ({ type, queryType, itemId }) => {
      const pending = deferred<VaultItem>();
      const write = new RecordingCipherWrite();
      mockPersonalWrite(write, type, "edit", pending.promise);
      const { fixture, store } = await createFixture(queryType, "edit-cipher", itemId, demoVaultItems, {
        session: fakeAuthSession(TEST_USER_KEY),
        cipherWrite: write,
      });
      const saving = saveOfficialPersonal(fixture.componentInstance, personalSubmit(type, "edit"));
      await vi.waitFor(() => expect(personalCallsFor(write, type)).toBe(1));
      const replacement = { ...personalItem(type), name: "Synchronized replacement" };
      store.setItems(store.snapshot().items.map((item) => item.id === itemId ? replacement : item));

      pending.resolve(serverPersonalItem(type, `late-edit-${type}`));
      await expect(saving).resolves.toEqual({ committed: false, reason: "stale" });
      expect(store.snapshot().items.find((item) => item.id === itemId)).toBe(replacement);
    },
  );

  it.each(PERSONAL_NAVIGATION_CASES)(
    "seals $label $mode after commit when navigation returns $navigationResult",
    async ({ type, queryType, routePath, cipherId, mode, navigationResult }) => {
      const returned = serverPersonalItem(type, `terminal-${type}-${mode}-${navigationResult}`);
      const write = new RecordingCipherWrite();
      mockPersonalWrite(write, type, mode, Promise.resolve(returned));
      const { fixture, navigateByUrl, store } = await createFixture(
        queryType,
        routePath,
        cipherId,
        demoVaultItems,
        { session: fakeAuthSession(TEST_USER_KEY), cipherWrite: write },
      );
      if (navigationResult === "false") {
        navigateByUrl.mockResolvedValue(false);
      } else {
        navigateByUrl.mockRejectedValue(new Error("private navigation failure"));
      }

      const first = await saveOfficialPersonal(
        fixture.componentInstance,
        personalSubmit(type, mode),
      );
      await expect(saveOfficialPersonal(
        fixture.componentInstance,
        personalSubmit(type, mode),
      )).resolves.toEqual({ committed: false, reason: "stale" });

      expect(first).toEqual({ committed: true, item: returned });
      expect(store.snapshot().statusMessage).toBe("项目已保存，但无法打开。");
      expect((fixture.componentInstance as unknown as { canSubmitOfficialPersonal: boolean })
        .canSubmitOfficialPersonal).toBe(false);
      expect(personalCallsFor(write, type)).toBe(1);
    },
  );

  it.each(PERSONAL_TYPES)(
    "keeps official $label values and fixed feedback after server failure",
    async ({ type, queryType }) => {
      const privateFailure = new Error("private server detail");
      const pending = deferred<VaultItem>();
      const write = new RecordingCipherWrite();
      mockPersonalWrite(write, type, "add", pending.promise);
      const consoleSpies = [
        vi.spyOn(console, "log").mockImplementation(() => undefined),
        vi.spyOn(console, "warn").mockImplementation(() => undefined),
        vi.spyOn(console, "error").mockImplementation(() => undefined),
      ];
      const { fixture, store, navigateByUrl } = await createFixture(
        queryType,
        "add-cipher",
        "",
        demoVaultItems,
        { session: fakeAuthSession(TEST_USER_KEY), cipherWrite: write },
      );
      const official = await initializeOfficialPersonalForm(fixture, "Retained private value");

      const submitting = official.submit();
      await vi.waitFor(() => expect(personalCallsFor(write, type)).toBe(1));
      pending.reject(privateFailure);
      await submitting;

      expect(personalCallsFor(write, type)).toBe(1);
      expect(personalNameInput(fixture).value).toBe("Retained private value");
      expect(store.snapshot().statusMessage).toBe("无法保存项目，请重试。");
      expect(store.snapshot().statusMessage).not.toContain(privateFailure.message);
      expect(navigateByUrl).not.toHaveBeenCalled();
      expect((fixture.componentInstance as unknown as { canSubmitOfficialPersonal: boolean })
        .canSubmitOfficialPersonal).toBe(true);
      expect(consoleSpies.flatMap((spy) => spy.mock.calls).flat()).not.toContain(privateFailure);
    },
  );

  it.each(PERSONAL_DIRTY_CASES)(
    "waits for dirty confirmation on $action for $label and restores focus",
    async ({ type, queryType, action }) => {
      const { fixture, navigateByUrl } = await createFixture(queryType, "add-cipher", "", demoVaultItems, {
        session: fakeAuthSession(TEST_USER_KEY),
        cipherWrite: new RecordingCipherWrite(),
      });
      await initializeOfficialPersonalForm(fixture, "Dirty personal value");
      const trigger = action === "back"
        ? (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>("popup-header button")!
        : (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>("footer button")[1]!;
      trigger.focus();

      const navigating = action === "back"
        ? fixture.componentInstance.backToVault()
        : fixture.componentInstance.cancel(trigger);
      await vi.waitFor(() => expect(TestBed.inject(CdkDialog).openDialogs.length).toBe(1));
      detectOpenDialogs();
      clickDialogButton("取消");
      await navigating;

      expect(navigateByUrl).not.toHaveBeenCalledWith("/tabs/vault");
      expect(document.activeElement).toBe(trigger);
    },
  );

  it.each(PERSONAL_DIRTY_CASES)(
    "invalidates pending $label save before awaiting dirty $action confirmation",
    async ({ type, queryType, action }) => {
      const pending = deferred<VaultItem>();
      const returned = serverPersonalItem(type, `dialog-race-${type}-${action}`);
      const write = new RecordingCipherWrite();
      mockPersonalWrite(write, type, "add", pending.promise);
      const { fixture, store, navigateByUrl } = await createFixture(
        queryType,
        "add-cipher",
        "",
        demoVaultItems,
        { session: fakeAuthSession(TEST_USER_KEY), cipherWrite: write },
      );
      const official = await initializeOfficialPersonalForm(fixture, "Retained dialog draft");
      const trigger = action === "back"
        ? (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>("popup-header button")!
        : (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>("footer button")[1]!;
      trigger.focus();

      const submitting = official.submit();
      await vi.waitFor(() => expect(personalCallsFor(write, type)).toBe(1));
      const leaving = action === "back"
        ? fixture.componentInstance.backToVault()
        : fixture.componentInstance.cancel(trigger);
      await vi.waitFor(() => expect(TestBed.inject(CdkDialog).openDialogs.length).toBe(1));
      detectOpenDialogs();

      expect((Reflect.get(official, "cipherForm") as { enabled: boolean }).enabled).toBe(true);
      expect(personalNameInput(fixture).value).toBe("Retained dialog draft");
      expect((fixture.componentInstance as unknown as { canSubmitOfficialPersonal: boolean })
        .canSubmitOfficialPersonal).toBe(true);

      pending.resolve(returned);
      await submitting;
      expect(store.snapshot().items).not.toContain(returned);
      expect(navigateByUrl).not.toHaveBeenCalledWith(
        `/view-cipher/${encodeURIComponent(returned.id)}`,
      );

      clickDialogButton("取消");
      await leaving;
      expect(navigateByUrl).not.toHaveBeenCalledWith("/tabs/vault");
      expect(document.activeElement).toBe(trigger);
      expect(personalNameInput(fixture).value).toBe("Retained dialog draft");
      expect((fixture.componentInstance as unknown as { canSubmitOfficialPersonal: boolean })
        .canSubmitOfficialPersonal).toBe(true);

      await expect(saveOfficialPersonal(
        fixture.componentInstance,
        personalSubmit(type, "add", "Retained dialog draft"),
      )).resolves.toEqual({ committed: true, item: returned });
      expect(personalCallsFor(write, type)).toBe(2);
    },
  );

  it.each([
    { type: "card", queryType: "3", action: "back", navigationResult: "false" },
    { type: "identity", queryType: "4", action: "cancel", navigationResult: "reject" },
  ] as const)(
    "keeps committed terminal and newer status when $action invalidates pending navigation $navigationResult",
    async ({ type, queryType, action, navigationResult }) => {
      const returned = serverPersonalItem(type, `late-navigation-${type}`);
      const write = new RecordingCipherWrite();
      mockPersonalWrite(write, type, "add", Promise.resolve(returned));
      const pendingNavigation = deferred<boolean>();
      const { fixture, store, navigateByUrl } = await createFixture(
        queryType,
        "add-cipher",
        "",
        demoVaultItems,
        { session: fakeAuthSession(TEST_USER_KEY), cipherWrite: write },
      );
      await initializeOfficialPersonalForm(fixture, "Retained committed draft");
      navigateByUrl.mockImplementation((url) =>
        String(url).startsWith("/view-cipher/") ? pendingNavigation.promise : Promise.resolve(true));
      const trigger = action === "back"
        ? (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>("popup-header button")!
        : (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>("footer button")[1]!;
      trigger.focus();

      const saving = saveOfficialPersonal(
        fixture.componentInstance,
        personalSubmit(type, "add", "Retained committed draft"),
      );
      await vi.waitFor(() => expect(navigateByUrl).toHaveBeenCalledWith(
        `/view-cipher/${encodeURIComponent(returned.id)}`,
      ));
      const leaving = action === "back"
        ? fixture.componentInstance.backToVault()
        : fixture.componentInstance.cancel(trigger);
      await vi.waitFor(() => expect(TestBed.inject(CdkDialog).openDialogs.length).toBe(1));
      detectOpenDialogs();
      store.setStatus("New context status");
      clickDialogButton("取消");
      await leaving;

      if (navigationResult === "false") {
        pendingNavigation.resolve(false);
      } else {
        pendingNavigation.reject(new Error("private navigation failure"));
      }

      await expect(saving).resolves.toEqual({ committed: true, item: returned });
      expect(store.snapshot().items[0]).toBe(returned);
      expect(store.snapshot().statusMessage).toBe("New context status");
      expect(document.activeElement).toBe(trigger);
      expect((fixture.componentInstance as unknown as { canSubmitOfficialPersonal: boolean })
        .canSubmitOfficialPersonal).toBe(false);
    },
  );

  it("normalizes a deferred SSH Key add query to the retained Login form", async () => {
    const { fixture } = await createFixture("5");
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges(false);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("popup-page popup-header h1")?.textContent).toContain("新增登录");
    expect(host.querySelector('input[formcontrolname="username"]')).not.toBeNull();
    expect(host.querySelector('textarea[aria-label="私钥"]')).toBeNull();
    expect(host.textContent).not.toContain("SSH 密钥");
  });

  it("marks retained edit forms as a secondary macOS page without primary navigation", async () => {
    const { fixture } = await createFixture("1");
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const page = host.querySelector("popup-page");
    expect(page?.classList).toContain("macos-page");
    expect(page?.classList).toContain("macos-page--vault-form");
    expect(host.querySelector(".cipher-form-scroll")?.classList).toContain("macos-list");
    expect(host.querySelector("bw-floating-tab-switcher")).toBeNull();
  });

  it.each(["edit-cipher", "clone-cipher"])(
    "returns deferred SSH Key %s routes to the vault without mutating data",
    async (routePath) => {
      const write = new RecordingCipherWrite();
      const { fixture, navigateByUrl, store } = await createFixture("5", routePath, "ssh", demoVaultItems, {
        session: fakeAuthSession(TEST_USER_KEY),
        cipherWrite: write,
      });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(navigateByUrl).toHaveBeenCalledWith("/tabs/vault");
      expect(write.calls).toEqual([]);
      expect(store.snapshot().items.find((item) => item.id === "ssh")?.name).toBe("Deploy key");
      expect((fixture.nativeElement as HTMLElement).textContent).not.toContain("SSH 密钥");
    },
  );

});

class RecordingCipherWrite implements VaultCipherWritePort {
  calls: Array<
    | { type: "createLogin"; session: AuthSession; draft: LoginCipherCreateDraft }
    | { type: "updateLogin"; session: AuthSession; item: (typeof demoVaultItems)[number]; draft: LoginCipherCreateDraft }
    | { type: "createSecureNote"; session: AuthSession; draft: SecureNoteCipherDraft }
    | { type: "updateSecureNote"; session: AuthSession; item: (typeof demoVaultItems)[number]; draft: SecureNoteCipherDraft }
    | { type: "createCard"; session: AuthSession; draft: CardCipherDraft }
    | { type: "updateCard"; session: AuthSession; item: (typeof demoVaultItems)[number]; draft: CardCipherDraft }
    | { type: "createIdentity"; session: AuthSession; draft: IdentityCipherDraft }
    | { type: "updateIdentity"; session: AuthSession; item: (typeof demoVaultItems)[number]; draft: IdentityCipherDraft }
  > = [];

  async createLoginCipher(
    session: AuthSession,
    draft: LoginCipherCreateDraft,
  ) {
    this.calls.push({ type: "createLogin", session, draft });
    return {
      id: "server-login",
      type: "login" as const,
      name: draft.name,
      subtitle: draft.username,
      folderId: "",
      folderName: "",
      organizationName: "",
      attachmentCount: 0,
      uris: draft.uri ? [{ id: "server-login-uri-0", uri: draft.uri, matchType: "default" }] : [],
      uri: draft.uri,
      favorite: false,
      createdDate: "2026-07-10T00:00:00.000Z",
      revisionDate: "2026-07-10T00:00:00.000Z",
      notes: draft.notes,
      canLaunch: draft.uri.length > 0,
      canFill: true,
      fields: [
        { id: "username", label: "Username", value: draft.username },
        { id: "password", label: "Password", value: draft.password, concealed: true, type: "hidden" as const },
        { id: "otp", label: "OTP", value: draft.totp, type: "totp" as const },
      ].filter((field) => field.value.length > 0),
    };
  }

  async updateLoginCipher(
    session: AuthSession,
    item: (typeof demoVaultItems)[number],
    draft: LoginCipherCreateDraft,
  ) {
    this.calls.push({ type: "updateLogin", session, item, draft });
    return {
      ...item,
      name: draft.name,
      subtitle: draft.username,
      uri: draft.uri,
      uris: draft.uri ? [{ id: `${item.id}-uri-0`, uri: draft.uri, matchType: "default" }] : [],
      notes: draft.notes,
      revisionDate: "2026-07-10T00:00:00.000Z",
      fields: [
        { id: "username", label: "Username", value: draft.username },
        { id: "password", label: "Password", value: draft.password, concealed: true, type: "hidden" as const },
        { id: "otp", label: "OTP", value: draft.totp, type: "totp" as const },
      ].filter((field) => field.value.length > 0),
    };
  }

  async createSecureNoteCipher(
    session: AuthSession,
    draft: SecureNoteCipherDraft,
  ) {
    this.calls.push({ type: "createSecureNote", session, draft });
    return {
      id: "server-secure-note",
      type: "secure-note" as const,
      name: draft.name,
      subtitle: "Secure note",
      folderId: "",
      folderName: "",
      organizationName: "",
      attachmentCount: 0,
      uris: [],
      uri: "",
      favorite: false,
      createdDate: "2026-07-10T00:00:00.000Z",
      revisionDate: "2026-07-10T00:00:00.000Z",
      notes: draft.notes,
      canLaunch: false,
      canFill: false,
      fields: draft.notes ? [{ id: "notes", label: "Notes", value: draft.notes }] : [],
    };
  }

  async updateSecureNoteCipher(
    session: AuthSession,
    item: (typeof demoVaultItems)[number],
    draft: SecureNoteCipherDraft,
  ) {
    this.calls.push({ type: "updateSecureNote", session, item, draft });
    return {
      ...item,
      name: draft.name,
      subtitle: "Secure note",
      notes: draft.notes,
      revisionDate: "2026-07-10T00:00:00.000Z",
      fields: draft.notes ? [{ id: "notes", label: "Notes", value: draft.notes }] : [],
    };
  }

  async createCardCipher(
    session: AuthSession,
    draft: CardCipherDraft,
  ) {
    this.calls.push({ type: "createCard", session, draft });
    return cardItem("server-card", draft);
  }

  async updateCardCipher(
    session: AuthSession,
    item: (typeof demoVaultItems)[number],
    draft: CardCipherDraft,
  ) {
    this.calls.push({ type: "updateCard", session, item, draft });
    return { ...item, ...cardItem(item.id, draft) };
  }

  async createIdentityCipher(
    session: AuthSession,
    draft: IdentityCipherDraft,
  ) {
    this.calls.push({ type: "createIdentity", session, draft });
    return identityItem("server-identity", draft);
  }

  async updateIdentityCipher(
    session: AuthSession,
    item: (typeof demoVaultItems)[number],
    draft: IdentityCipherDraft,
  ) {
    this.calls.push({ type: "updateIdentity", session, item, draft });
    return { ...item, ...identityItem(item.id, draft) };
  }

}

function cardItem(id: string, draft: CardCipherDraft) {
  return {
    id,
    type: "card" as const,
    name: draft.name,
    subtitle: draft.number ? `•••• ${draft.number.slice(-4)}` : "支付卡",
    folderId: "",
    folderName: "",
    organizationName: "",
    attachmentCount: 0,
    uris: [],
    uri: "",
    favorite: false,
    createdDate: "2026-07-10T00:00:00.000Z",
    revisionDate: "2026-07-10T00:00:00.000Z",
    notes: draft.notes,
    canLaunch: false,
    canFill: false,
    fields: [
      { id: "cardholder-name", label: "Cardholder", value: draft.cardholderName },
      { id: "number", label: "Number", value: draft.number, concealed: true },
      { id: "exp-month", label: "Expiration month", value: draft.expMonth },
      { id: "exp-year", label: "Expiration year", value: draft.expYear },
      { id: "code", label: "Security code", value: draft.code, concealed: true, type: "hidden" as const },
    ].filter((field) => field.value.length > 0),
  };
}

function identityItem(id: string, draft: IdentityCipherDraft) {
  return {
    id,
    type: "identity" as const,
    name: draft.name,
    subtitle: draft.email || [draft.firstName, draft.lastName].filter(Boolean).join(" "),
    folderId: "",
    folderName: "",
    organizationName: "",
    attachmentCount: 0,
    uris: [],
    uri: "",
    favorite: false,
    createdDate: "2026-07-10T00:00:00.000Z",
    revisionDate: "2026-07-10T00:00:00.000Z",
    notes: draft.notes,
    canLaunch: false,
    canFill: false,
    fields: [
      { id: "first-name", label: "First name", value: draft.firstName },
      { id: "last-name", label: "Last name", value: draft.lastName },
      { id: "email", label: "Email", value: draft.email },
      { id: "phone", label: "Phone", value: draft.phone },
      { id: "address", label: "Address", value: draft.address1 },
    ].filter((field) => field.value.length > 0),
  };
}

function fakeAuthSession(userKeyB64: string): AuthSession {
  return {
    environment: buildSelfHostedEnvironmentFromServerUrl("https://bitwarden.example.com"),
    token: {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
    },
    crypto: { userKeyB64 },
  };
}

const TEST_USER_KEY =
  "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4/QA==";

type PersonalType = "card" | "identity" | "secure-note";
type PersonalMode = RetainedPersonalCipherFormSubmit["mode"];

const PERSONAL_TYPES = [
  { type: "card", label: "Card", queryType: "3", cipherType: CipherType.Card, itemId: "card" },
  { type: "identity", label: "Identity", queryType: "4", cipherType: CipherType.Identity, itemId: "identity" },
  { type: "secure-note", label: "Secure Note", queryType: "2", cipherType: CipherType.SecureNote, itemId: "note" },
] as const;

const PERSONAL_ROUTE_CASES = PERSONAL_TYPES.flatMap((entry) => [
  { ...entry, mode: "add" as const, routePath: "add-cipher", cipherId: "" },
  { ...entry, mode: "edit" as const, routePath: "edit-cipher", cipherId: entry.itemId },
  { ...entry, mode: "clone" as const, routePath: "clone-cipher", cipherId: entry.itemId },
]);

const PERSONAL_CREATE_CASES = PERSONAL_TYPES.flatMap((entry) => [
  { ...entry, mode: "add" as const, routePath: "add-cipher", cipherId: "" },
  { ...entry, mode: "clone" as const, routePath: "clone-cipher", cipherId: entry.itemId },
]);

const PERSONAL_NAVIGATION_CASES = PERSONAL_ROUTE_CASES.flatMap((entry) => [
  { ...entry, navigationResult: "false" as const },
  { ...entry, navigationResult: "reject" as const },
]);
const MALFORMED_PERSONAL_ID_CASES = [
  {
    label: "missing",
    value: (valid: VaultItem) => {
      const withoutId = { ...valid } as Partial<VaultItem>;
      delete withoutId.id;
      return withoutId;
    },
  },
  { label: "undefined", value: (valid: VaultItem) => ({ ...valid, id: undefined }) },
  { label: "null", value: (valid: VaultItem) => ({ ...valid, id: null }) },
  { label: "non-string", value: (valid: VaultItem) => ({ ...valid, id: {} }) },
  { label: "blank", value: (valid: VaultItem) => ({ ...valid, id: "" }) },
  { label: "whitespace", value: (valid: VaultItem) => ({ ...valid, id: "   " }) },
] as const;
const PERSONAL_RACE_CAUSES = [
  "route",
  "account-switch",
  "lock",
  "logout",
  "session-object",
  "active",
  "archived",
  "deleted",
  "sync",
] as const;
const PERSONAL_RACE_CASES = PERSONAL_TYPES.flatMap((entry) =>
  PERSONAL_RACE_CAUSES.map((cause) => ({ ...entry, cause })),
);
const PERSONAL_DIRTY_CASES = PERSONAL_TYPES.flatMap((entry) => [
  { ...entry, action: "back" as const },
  { ...entry, action: "cancel" as const },
]);

type ExpectedPersonalSaveResult =
  | { readonly committed: true; readonly item: VaultItem }
  | { readonly committed: false; readonly reason: "duplicate" | "stale" | "failure" };

type ExpectedLoginSaveResult =
  | { readonly committed: true; readonly item: VaultItem }
  | { readonly committed: false; readonly reason: "duplicate" | "stale" | "failure" };

async function initializeOfficialPersonalForm(
  fixture: ComponentFixture<VaultAddEditPageComponent>,
  name: string,
): Promise<OfficialPersonalCipherFormComponent> {
  fixture.changeDetectorRef.detectChanges();
  const official = fixture.debugElement.query(By.directive(OfficialPersonalCipherFormComponent))
    .componentInstance as OfficialPersonalCipherFormComponent;
  await vi.waitFor(() => {
    expect({
      loading: Reflect.get(official, "loading"),
      initialized: Reflect.get(official, "_firstInitialized"),
    }).toEqual({ loading: false, initialized: true });
  });
  fixture.changeDetectorRef.detectChanges();
  await fixture.whenStable();
  personalNameInput(fixture).value = name;
  personalNameInput(fixture).dispatchEvent(new Event("input", { bubbles: true }));
  fixture.changeDetectorRef.detectChanges();
  return official;
}

function personalNameInput(
  fixture: ComponentFixture<VaultAddEditPageComponent>,
): HTMLInputElement {
  const input = fixture.nativeElement.querySelector<HTMLInputElement>('input[formcontrolname="name"]');
  expect(input).not.toBeNull();
  return input!;
}

async function saveOfficialPersonal(
  component: VaultAddEditPageComponent,
  submit: RetainedPersonalCipherFormSubmit,
): Promise<ExpectedPersonalSaveResult> {
  const save = (component as unknown as {
    saveOfficialPersonal?: (
      value: RetainedPersonalCipherFormSubmit,
    ) => Promise<ExpectedPersonalSaveResult>;
  }).saveOfficialPersonal;
  expect(save).toBeTypeOf("function");
  return save!.call(component, submit);
}

function personalSubmit(
  type: PersonalType,
  mode: PersonalMode,
  name = "Personal item",
): RetainedPersonalCipherFormSubmit {
  const cipherType = PERSONAL_TYPES.find((entry) => entry.type === type)!.cipherType;
  return {
    mode,
    cipherType,
    value: CipherView.fromJSON({
      type: cipherType,
      name,
      organizationId: null,
      collectionIds: [],
      fields: [],
      card: {
        cardholderName: "Cardholder",
        brand: "Visa",
        number: "4111111111111111",
        expMonth: "04",
        expYear: "2029",
        code: "123",
      },
      identity: {
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.test",
        phone: "+1 555 0100",
        address1: "1 Main Street",
      },
      secureNote: { type: 0 },
      notes: "Private notes",
    })!,
  };
}

function personalItem(type: PersonalType): VaultItem {
  return demoVaultItems.find((item) => item.type === type)!;
}

function serverPersonalItem(type: PersonalType, id: string): VaultItem {
  return {
    ...personalItem(type),
    id,
    name: `Returned ${type}`,
    organizationId: undefined,
    collectionIds: [],
  };
}

function mockPersonalWrite(
  write: RecordingCipherWrite,
  type: PersonalType,
  mode: PersonalMode,
  result: Promise<VaultItem>,
): void {
  const create = mode !== "edit";
  if (type === "card") {
    vi.spyOn(write, create ? "createCardCipher" : "updateCardCipher").mockReturnValue(result);
  } else if (type === "identity") {
    vi.spyOn(write, create ? "createIdentityCipher" : "updateIdentityCipher").mockReturnValue(result);
  } else {
    vi.spyOn(write, create ? "createSecureNoteCipher" : "updateSecureNoteCipher").mockReturnValue(result);
  }
}

function personalCallsFor(write: RecordingCipherWrite, type: PersonalType): number {
  return write.calls.filter((call) =>
    type === "card"
      ? call.type === "createCard" || call.type === "updateCard"
      : type === "identity"
        ? call.type === "createIdentity" || call.type === "updateIdentity"
        : call.type === "createSecureNote" || call.type === "updateSecureNote",
  ).length + personalSpyCalls(write, type);
}

function personalSpyCalls(write: RecordingCipherWrite, type: PersonalType): number {
  const methods = type === "card"
    ? [write.createCardCipher, write.updateCardCipher]
    : type === "identity"
      ? [write.createIdentityCipher, write.updateIdentityCipher]
      : [write.createSecureNoteCipher, write.updateSecureNoteCipher];
  return methods.reduce((count, method) => count + (vi.isMockFunction(method) ? method.mock.calls.length : 0), 0);
}

function replaceOwnership(
  cause: (typeof PERSONAL_RACE_CAUSES)[number],
  store: PopupStateStore,
  setRouterUrl: (url: string) => void,
  session: AuthSession,
): void {
  if (cause === "route") setRouterUrl("/tabs/vault");
  if (cause === "account-switch") store.setUnlocked("other@example.test");
  if (cause === "lock") store.setLocked();
  if (cause === "logout") store.setLoggedOut();
  if (cause === "session-object") store.setActiveSession({ ...session });
  if (cause === "active") store.setItems([...store.snapshot().items]);
  if (cause === "archived") store.setArchivedItems([...store.snapshot().archivedItems]);
  if (cause === "deleted") store.setDeletedItems([...store.snapshot().deletedItems]);
  if (cause === "sync") {
    const state = store.snapshot();
    store.setItems([...state.items], [...state.folders]);
    store.setArchivedItems([...state.archivedItems]);
    store.setDeletedItems([...state.deletedItems]);
    store.setOrganizationData([...state.organizations], [...state.collections]);
  }
}

async function initializeOfficialForm(
  fixture: ComponentFixture<VaultAddEditPageComponent>,
  name: string,
): Promise<OfficialLoginCipherFormComponent> {
  fixture.changeDetectorRef.detectChanges();
  const official = fixture.debugElement.query(By.directive(OfficialLoginCipherFormComponent))
    .componentInstance as OfficialLoginCipherFormComponent;
  await vi.waitFor(() => {
    expect({
      loading: Reflect.get(official, "loading"),
      initialized: Reflect.get(official, "_firstInitialized"),
    }).toEqual({ loading: false, initialized: true });
  });
  fixture.changeDetectorRef.detectChanges();
  await fixture.whenStable();
  await Promise.resolve();
  fixture.changeDetectorRef.detectChanges();
  const renderedNameInput = fixture.nativeElement.querySelector<HTMLInputElement>(
    'input[formcontrolname="name"]',
  )!;
  expect(renderedNameInput).not.toBeNull();
  renderedNameInput.value = name;
  renderedNameInput.dispatchEvent(new Event("input", { bubbles: true }));
  fixture.changeDetectorRef.detectChanges();
  return official;
}

async function saveOfficialLogin(
  component: VaultAddEditPageComponent,
  submit: RetainedLoginFormSubmit,
): Promise<ExpectedLoginSaveResult> {
  const save = (component as unknown as {
    saveOfficialLogin?: (value: RetainedLoginFormSubmit) => Promise<ExpectedLoginSaveResult>;
  }).saveOfficialLogin;
  expect(save).toBeTypeOf("function");
  return save!.call(component, submit);
}

function loginSubmit(
  mode: RetainedLoginFormSubmit["mode"],
  name: string,
  password = "server-secret",
): RetainedLoginFormSubmit {
  return {
    mode,
    value: CipherView.fromJSON({
      type: CipherType.Login,
      name,
      favorite: true,
      folderId: "work",
      reprompt: 1,
      fields: [
        { name: "Environment", value: "Production", type: FieldType.Text },
        { name: "PIN", value: "1234", type: FieldType.Hidden },
        { name: "Enabled", value: "true", type: FieldType.Boolean },
      ],
      login: {
        username: "operator@example.test",
        password,
        totp: "otpauth://totp/example",
        uris: [
          { uri: "https://one.example.test" },
          { uri: "https://two.example.test", match: 1 },
        ],
      },
      notes: "Operational note",
    })!,
  };
}

function savedLogin(id: string, name = "Server Login"): VaultItem {
  return {
    id,
    type: "login",
    name,
    subtitle: "operator@example.test",
    folderId: "work",
    folderName: "Work",
    organizationName: "",
    attachmentCount: 0,
    uris: [{ id: `${id}-uri-0`, uri: "https://one.example.test", matchType: "default" }],
    uri: "https://one.example.test",
    favorite: true,
    createdDate: "2026-07-10T00:00:00.000Z",
    revisionDate: "2026-07-17T00:00:00.000Z",
    notes: "Operational note",
    canLaunch: true,
    canFill: true,
    fields: [
      { id: "username", label: "Username", value: "operator@example.test" },
      { id: "password", label: "Password", value: "server-secret", type: "hidden", concealed: true },
    ],
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function routeUrl(routePath: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return `/${routePath}${query ? `?${query}` : ""}`;
}

function detectOpenDialogs(): void {
  for (const ref of TestBed.inject(CdkDialog).openDialogs) {
    ref.componentRef?.changeDetectorRef.detectChanges();
    const containerChangeDetector = Reflect.get(
      ref.containerInstance,
      "_changeDetectorRef",
    ) as { detectChanges(): void };
    containerChangeDetector.detectChanges();
  }
}

function clickDialogButton(text: string): void {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>(".cdk-overlay-container button"),
  ].find((candidate) => candidate.textContent?.trim() === text);
  expect(button, `dialog button ${text}`).toBeDefined();
  button!.click();
}

function setInput(host: HTMLElement, label: string, value: string): void {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  expect(input).not.toBeNull();
  input!.value = value;
  input!.dispatchEvent(new Event("input", { bubbles: true }));
}

function setTextarea(host: HTMLElement, label: string, value: string): void {
  const textarea = host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`);
  expect(textarea).not.toBeNull();
  textarea!.value = value;
  textarea!.dispatchEvent(new Event("input", { bubbles: true }));
}

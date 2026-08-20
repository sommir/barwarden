import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { Component, type Type } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { provideRouter, Router } from "@angular/router";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppComponent, POPUP_LIFECYCLE_HOST } from "../app.component";
import { AuthFacade } from "../auth/auth.facade";
import { VaultTimeoutService } from "../auth/vault-timeout.service";
import { AppFeedbackService } from "../official-ui/app-feedback.service";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { PopupStateStore } from "../popup-state";
import { demoVaultItems, type VaultItem } from "../vault-demo";
import { ArchivePageComponent } from "./archive-page.component";
import { TrashPageComponent } from "./trash-page.component";
import { VaultActionsService } from "./vault-actions.service";

@Component({ standalone: true, template: "" })
class VaultRouteStubComponent {}

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

afterEach(() => {
  TestBed.resetTestingModule();
});

describe("recovery confirmation feedback ownership", () => {
  it.each([
    {
      location: "archive" as const,
      pageType: ArchivePageComponent,
      item: { ...demoVaultItems[0], id: "archive-retry", name: "Archive retry" },
      sheetTestId: "archive-delete-confirmation",
      failure: "Unable to move item to trash. Please retry.",
      success: "Moved item to trash",
      actionName: "deleteArchivedItemWithOutcome" as const,
    },
    {
      location: "trash" as const,
      pageType: TrashPageComponent,
      item: { ...demoVaultItems[1], id: "trash-retry", name: "Trash retry" },
      sheetTestId: "permanent-delete-confirmation",
      failure: "Unable to permanently delete item. Please retry.",
      success: "Item permanently deleted",
      actionName: "permanentlyDeleteItemWithOutcome" as const,
    },
  ])(
    "keeps the $location Sheet as the only failure announcer and permits a terminal retry",
    async ({ location, pageType, item, sheetTestId, failure, success, actionName }) => {
      const action = vi.fn()
        .mockResolvedValueOnce({ committed: false, reason: "failure", status: failure })
        .mockResolvedValueOnce(committed(item, success));
      const actions = { [actionName]: action };
      const harness = await renderRecoveryRoot(location, pageType, item, actions);

      const sheet = harness.host.querySelector<HTMLDialogElement>(
        `[data-testid="${sheetTestId}"]`,
      )!;
      Object.defineProperty(sheet, "showModal", {
        configurable: true,
        value: vi.fn(() => sheet.setAttribute("open", "")),
      });

      if (harness.page instanceof ArchivePageComponent) {
        await harness.page.requestDelete(item.id);
      } else {
        await harness.page.deleteForever(item.id);
      }
      harness.fixture.detectChanges();
      const submit = sheet.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      submit.click();
      await harness.fixture.whenStable();
      harness.fixture.detectChanges();
      await Promise.resolve();
      harness.fixture.detectChanges();

      expect(sheet.open).toBe(true);
      expect(harness.page.confirmationError()).toBe(failure);
      expect(sheet.querySelector("[data-testid='recovery-confirmation-error'][role='alert']")?.textContent)
        .toContain(failure);
      expect(harness.host.querySelectorAll("[role='alert']")).toHaveLength(1);
      expect(harness.host.querySelector(".app-feedback__announcer[role='alert']")).toBeNull();
      expect(harness.feedback.snapshot()).toBeNull();
      expect(harness.store.snapshot().statusMessage).toBe("");

      submit.click();
      await harness.fixture.whenStable();
      harness.fixture.detectChanges();
      await Promise.resolve();
      harness.fixture.detectChanges();

      expect(action).toHaveBeenCalledTimes(2);
      expect(sheet.open).toBe(false);
      expect(harness.store.snapshot().statusMessage).toBe(success);
      expect(harness.feedback.snapshot()).toMatchObject({ kind: "success", message: success });
      expect(harness.host.querySelectorAll(".app-feedback__announcer[role='status']"))
        .toHaveLength(1);
    },
  );

  it("continues to route a non-confirmation Trash restore failure through root feedback", async () => {
    const item = { ...demoVaultItems[0], id: "restore-failure", name: "Restore failure" };
    const failure = "Unable to restore item. Please retry.";
    const actions = {
      restoreDeletedItemWithOutcome: vi.fn(async () => ({
        committed: false as const,
        reason: "failure" as const,
        status: failure,
      })),
    };
    const harness = await renderRecoveryRoot("trash", TrashPageComponent, item, actions);

    await harness.page.restore(item.id);
    await harness.fixture.whenStable();
    harness.fixture.detectChanges();
    await Promise.resolve();
    harness.fixture.detectChanges();

    expect(harness.store.snapshot().statusMessage).toBe(failure);
    expect(harness.feedback.snapshot()).toMatchObject({ kind: "warning", message: failure });
    expect(harness.host.querySelectorAll("[role='alert']")).toHaveLength(1);
    expect(harness.host.querySelector(".app-feedback__announcer[role='alert']")?.textContent)
      .toContain(failure);
  });
});

async function renderRecoveryRoot<T extends ArchivePageComponent | TrashPageComponent>(
  location: "archive" | "trash",
  pageType: Type<T>,
  item: VaultItem,
  actions: object,
): Promise<{
  readonly feedback: AppFeedbackService;
  readonly fixture: ComponentFixture<AppComponent>;
  readonly host: HTMLElement;
  readonly page: T;
  readonly store: PopupStateStore;
}> {
  const store = new PopupStateStore();
  store.setUnlocked("person@example.test");
  store.setActiveSession({} as never);
  if (location === "archive") {
    store.setArchivedItems([item]);
  } else {
    store.setDeletedItems([item]);
  }

  await TestBed.configureTestingModule({
    imports: [AppComponent],
    providers: [
      provideRouter([
        { path: "tabs/vault", component: VaultRouteStubComponent },
        { path: "archive", component: ArchivePageComponent },
        { path: "trash", component: TrashPageComponent },
      ]),
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
      { provide: AuthFacade, useValue: { restoreStartup: vi.fn(async () => "unlocked") } },
      { provide: PopupStateStore, useValue: store },
      { provide: VaultTimeoutService, useValue: { recordActivity: vi.fn() } },
      { provide: POPUP_LIFECYCLE_HOST, useValue: { hidePopup: vi.fn(async () => undefined) } },
      { provide: VaultActionsService, useValue: actions },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AppComponent);
  fixture.detectChanges();
  const router = TestBed.inject(Router);
  await vi.waitFor(() => expect(router.url).toBe("/tabs/vault"));
  await router.navigateByUrl(`/${location}`);
  await fixture.whenStable();
  fixture.detectChanges();

  return {
    feedback: TestBed.inject(AppFeedbackService),
    fixture,
    host: fixture.nativeElement as HTMLElement,
    page: fixture.debugElement.query(By.directive(pageType)).componentInstance as T,
    store,
  };
}

function committed(item: VaultItem, status: string) {
  return {
    committed: true as const,
    status,
    result: { kind: "removed" as const, item },
  };
}

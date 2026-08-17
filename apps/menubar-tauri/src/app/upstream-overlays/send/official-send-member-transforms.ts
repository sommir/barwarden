import { createHash } from "node:crypto";

import ts from "typescript";

import addEditHtmlPatch from "./source-patches/official-send-add-edit.component.html.patch?raw";
import addEditTypeScriptPatch from "./source-patches/official-send-add-edit.component.ts.patch?raw";
import createdTypeScriptPatch from "./source-patches/official-send-created.component.ts.patch?raw";
import detailsHtmlPatch from "./source-patches/official-send-details.component.html.patch?raw";
import detailsTypeScriptPatch from "./source-patches/official-send-details.component.ts.patch?raw";
import listItemsTypeScriptPatch from "./source-patches/official-send-list-items-container.component.ts.patch?raw";
import listTypeScriptPatch from "./source-patches/official-send-list.component.ts.patch?raw";
import optionsHtmlPatch from "./source-patches/official-send-options.component.html.patch?raw";
import optionsTypeScriptPatch from "./source-patches/official-send-options.component.ts.patch?raw";
import textDetailsHtmlPatch from "./source-patches/official-send-text-details.component.html.patch?raw";
import textDetailsTypeScriptPatch from "./source-patches/official-send-text-details.component.ts.patch?raw";

export type ExactContinuousBlockTransform = {
  readonly search: string;
  readonly replacement: string;
  readonly oldStart?: number;
  readonly oldCount?: number;
  readonly newCount?: number;
};

export type ExactContinuousSourceContract = {
  readonly authority: string;
  readonly runtime: string;
  readonly authoritySha256: string;
  readonly transforms: readonly ExactContinuousBlockTransform[];
  readonly patch?: string;
};

const replaceSendItemsServiceStateWithTypedInputs = [
  {
    search: '<popup-page [hideOverflow]="showSkeletonsLoaders$ | async">',
    replacement: '<popup-page [hideOverflow]="loading()">',
  },
  {
    search: `  <ng-container *ngIf="listState !== sendState.Empty && !(showSkeletonsLoaders$ | async)">
    <div
      *ngIf="listState === sendState.NoResults"
      class="tw-flex tw-flex-col tw-justify-center tw-h-auto tw-pt-12"
    >
      <bit-no-items [icon]="noResultsIcon">
        <ng-container slot="title">{{ "noItemsMatchSearch" | i18n }}</ng-container>
        <ng-container slot="description">{{ "clearFiltersOrTryAnother" | i18n }}</ng-container>
      </bit-no-items>
    </div>
    <app-send-list-items-container [headerText]="title | i18n" [sends]="sends$ | async" />
  </ng-container>
  @if (showSkeletonsLoaders$ | async) {
    <vault-fade-in-out-skeleton>
      <vault-loading-skeleton></vault-loading-skeleton>
    </vault-fade-in-out-skeleton>
  }`,
    replacement: `  @if (state() !== "empty" && !loading()) {
    @if (state() === "no-results") {
      <div class="tw-flex tw-flex-col tw-justify-center tw-h-auto tw-pt-12">
        <bit-no-items>
          <ng-container slot="title">{{ "i18nNoMatchingSends" | i18n }}</ng-container>
          <ng-container slot="description">{{ "i18nNoSearchMatchesHint" | i18n }}</ng-container>
        </bit-no-items>
      </div>
    }
    <bw-official-send-list-items-container
      [headerText]="'i18nAllSends' | i18n"
      [sends]="sends()"
      (open)="open.emit($event)"
      (copyLink)="copyLink.emit($event)"
      (delete)="delete.emit($event)"
    />
  }
  @if (loading()) {
    <bit-item-group class="macos-send-list" [attr.aria-label]="'i18nLoadingSends' | i18n">
      @for (row of [0, 1, 2, 3, 4]; track row) {
        <div class="tw-flex tw-items-center tw-gap-3 tw-h-[59px] tw-px-3">
          <bit-skeleton edgeShape="circle" class="tw-size-8 tw-flex-none" />
          <bit-skeleton class="tw-h-4 tw-flex-1" />
        </div>
      }
    </bit-item-group>
  }`,
  },
] as const;

const replaceBrowserAccountAndPopOutWithExistingPopupHeaderSlots = [
  {
    search: `  <popup-header slot="header" [pageTitle]="'send' | i18n">
    <ng-container slot="end">
      <tools-new-send-dropdown *ngIf="!sendsDisabled"></tools-new-send-dropdown>
      <app-pop-out></app-pop-out>
      <app-current-account></app-current-account>
    </ng-container>
  </popup-header>`,
    replacement: `  <popup-header slot="header" pageTitle="Send">
    <ng-container slot="end">
      @if (!disabled()) {
        <button class="macos-send__new-action" data-testid="send-new-action" bitButton buttonType="primary" type="button" [attr.aria-label]="'i18nAddTextSend' | i18n" (click)="open.emit(undefined)">
          {{ "new" | i18n }}
        </button>
      }
    </ng-container>
  </popup-header>`,
  },
] as const;

const retainOfficialPolicySearchFilterLoadingEmptyAndNoResultsBlocks = [
  {
    search: `  <ng-container slot="above-scroll-area">
    <bit-callout *ngIf="sendsDisabled" [title]="'sendDisabled' | i18n">
      {{ "sendDisabledWarning" | i18n }}
    </bit-callout>
    <ng-container *ngIf="listState !== sendState.Empty">
      <tools-send-search></tools-send-search>
      <app-send-list-filters></app-send-list-filters>
    </ng-container>
  </ng-container>`,
    replacement: `  <ng-container slot="above-scroll-area">
    @if (disabled()) {
      <bit-callout class="send-disabled-callout" [title]="'i18nSendDisabled' | i18n">
        {{ "i18nOrganizationPolicyDisabledSend" | i18n }}
      </bit-callout>
    }
    @if (state() !== "empty") {
      <div class="tw-flex tw-gap-1 tw-items-center">
        <bit-search
          data-popup-focus-key="send:search"
          class="tw-flex-1"
          autocomplete="off"
          [placeholder]="'i18nSearchSend' | i18n"
          [ngModel]="query()"
          (ngModelChange)="queryChange.emit($event ?? '')"
        />
        <button
          class="macos-send__filter-action"
          data-testid="send-filter-action"
          bitIconButton="bwi-sliders"
          buttonType="primaryGhost"
          type="button"
          [attr.aria-label]="'i18nFilterSend' | i18n"
          [attr.aria-expanded]="filtersVisible()"
          (click)="toggleFilters.emit()"
        ></button>
      </div>
      @if (filtersVisible()) {
        <div class="send-filter-disclosure">
          <select [attr.aria-label]="'type' | i18n" (change)="filterChange.emit(inputValue($event))">
            <option value="">{{ "type" | i18n }}</option>
            <option value="text">{{ "i18nTextSend" | i18n }}</option>
          </select>
        </div>
      }
    }
  </ng-container>`,
  },
] as const;

const removeFileNewSendChoice = [
  {
    search: `  <div
    *ngIf="listState === sendState.Empty"
    class="tw-flex tw-flex-col tw-h-full tw-justify-center"
  >
    <bit-no-items [icon]="noItemIcon" class="tw-text-main">
      <ng-container slot="title">{{ "sendsTitleNoItems" | i18n }}</ng-container>
      <ng-container slot="description">
        <p bitTypography="body2" class="tw-mx-6 tw-mt-2">{{ "sendsBodyNoItems" | i18n }}</p>
      </ng-container>
      <tools-new-send-dropdown
        [hideIcon]="true"
        *ngIf="!sendsDisabled"
        slot="button"
        [buttonType]="'secondary'"
      ></tools-new-send-dropdown>
    </bit-no-items>
  </div>`,
    replacement: `  @if (state() === "empty" && !loading()) {
    <div class="tw-flex tw-flex-col tw-h-full tw-justify-center">
      <bit-no-items class="tw-text-main">
        <ng-container slot="title">{{ "i18nSendEmptyTitle" | i18n }}</ng-container>
        <ng-container slot="description">
          <p bitTypography="body2" class="tw-mx-6 tw-mt-2">{{ "i18nSendEmptyDescription" | i18n }}</p>
        </ng-container>
        @if (!disabled()) {
          <button class="macos-send__empty-create-action" data-testid="send-empty-create-action" slot="button" bitButton buttonType="secondary" type="button" [attr.aria-label]="'i18nAddTextSend' | i18n" (click)="open.emit(undefined)">
            {{ "i18nCreateSend" | i18n }}
          </button>
        }
      </bit-no-items>
    </div>
  }`,
  },
] as const;

export const sendListTemplateTransforms = [
  removeFileNewSendChoice,
  replaceSendItemsServiceStateWithTypedInputs,
  replaceBrowserAccountAndPopOutWithExistingPopupHeaderSlots,
  retainOfficialPolicySearchFilterLoadingEmptyAndNoResultsBlocks,
] as const;

const removeSendTypeFileIconBlock = [
  {
    search: `          @if (send.type === sendType.Text) {
            <bit-icon name="bwi-file-text" class="bwi-lg tw-text-muted tw-w-6" />
          }
          @if (send.type === sendType.File) {
            <bit-icon name="bwi-file" class="bwi-lg tw-text-muted tw-w-6" />
          }`,
    replacement: '          <bit-icon name="bwi-file-text" class="bwi-lg tw-text-muted tw-w-6" />',
  },
] as const;

const replaceRouterLinkWithOpenOutput = [
  {
    search: `<bit-section *ngIf="sends?.length > 0" disableMargin>
  <bit-section-header>
    <h2 class="tw-font-medium" bitTypography="h6">
      {{ headerText }}
    </h2>
    <span bitTypography="body1" slot="end">{{ sends.length }}</span>
  </bit-section-header>
  <bit-item-group>
    <bit-item *ngFor="let send of sends">`,
    replacement: `<bit-section class="send-list-section" *ngIf="sends().length > 0" disableMargin>
  <bit-section-header>
    <h2 class="tw-font-medium" bitTypography="h6">
      {{ headerText() }}
    </h2>
    <span bitTypography="body1" slot="end">{{ sends().length }}</span>
  </bit-section-header>
  <bit-item-group class="macos-send-list">
    <bit-item class="macos-send-row" *ngFor="let send of sends(); trackBy: trackById">`,
  },
  {
    search: `        appA11yTitle="{{ 'edit' | i18n }} - {{ send.name }}"
        routerLink="/edit-send"
        [queryParams]="{ sendId: send.id, type: send.type }"
        appStopClick`,
    replacement: `        [attr.aria-label]="'i18nViewItem' | i18n: send.name"
        [attr.data-popup-focus-key]="'send-item:' + send.id"
        (click)="open.emit(send)"`,
  },
] as const;

const replaceClipboardAndDeleteServicesWithTypedOutputs = [
  {
    search: `          @if (send.authType !== authType.None) {
            <bit-icon
              name="bwi-lock"
              [bitTooltip]="
                (send.authType === authType.Email ? 'emailProtected' : 'passwordProtected') | i18n
              "
            ></bit-icon>
          }
          @if (send.disabled) {
            <bit-icon
              name="bwi-exclamation-triangle"
              [bitTooltip]="'sendNotCompliantWithYourOrgsPolicy' | i18n"
            ></bit-icon>
          }
          @if (send.expired) {
            <bit-icon name="bwi-clock" [bitTooltip]="'expired' | i18n"></bit-icon>
          }
          @if (send.maxAccessCountReached) {
            <bit-icon
              name="bwi-exclamation-triangle"
              [bitTooltip]="'maxAccessCountReached' | i18n"
            ></bit-icon>
          }`,
    replacement: `          @if (send.hasPassword) {
            <bit-icon name="bwi-lock" [title]="'i18nPasswordProtected' | i18n"></bit-icon>
          }
          @if (send.disabled) {
            <bit-icon name="bwi-exclamation-triangle" [title]="'i18nSendPolicyViolation' | i18n"></bit-icon>
          }
          @if (send.expired) {
            <bit-icon name="bwi-clock" [title]="'i18nExpired' | i18n"></bit-icon>
          }
          @if (send.maxAccessCountReached) {
            <bit-icon name="bwi-exclamation-triangle" [title]="'i18nMaxAccessReached' | i18n"></bit-icon>
          }`,
  },
  {
    search: '{{ "deletionDate" | i18n }}:&nbsp;{{ send.deletionDate | date: "mediumDate" }}',
    replacement: '{{ "i18nDeleteDateValue" | i18n: (send.deletionDate | date: "mediumDate") }}',
  },
  {
    search: `        <bit-item-action>
          <button
            class="tw-p-1"
            bitIconButton="bwi-clone"
            size="small"
            type="button"
            (click)="copySendLink(send)"
            label="{{ 'copyLink' | i18n }} - {{ send.name }}"
          ></button>
        </bit-item-action>`,
    replacement: `        <bit-item-action class="macos-send-row__actions">
          <button
            class="tw-p-1"
            [attr.data-popup-focus-key]="'send-item:' + send.id + ':copy'"
            bitIconButton="bwi-clone"
            size="small"
            type="button"
            (click)="copyLink.emit({ send, trigger: $event })"
            [attr.aria-label]="'i18nCopySendLinkFor' | i18n: send.name"
          ></button>
        </bit-item-action>`,
  },
  {
    search: `        <bit-item-action>
          <button
            bitIconButton="bwi-trash"
            size="small"
            type="button"
            (click)="deleteSend(send)"
            label="{{ 'delete' | i18n }} - {{ send.name }}"
          ></button>
        </bit-item-action>`,
    replacement: `        <bit-item-action class="macos-send-row__actions">
          <button
            #moreTrigger
            [attr.data-popup-focus-key]="'send-item:' + send.id + ':more'"
            bitIconButton="bwi-ellipsis-v"
            size="small"
            type="button"
            [label]="(('i18nMore' | i18n) + ' - ' + send.name)"
            [bitMenuTriggerFor]="sendActions"
          ></button>
          <bit-menu #sendActions [ariaLabel]="(('i18nMore' | i18n) + ' - ' + send.name)">
            <button
              class="macos-send-row__delete-action"
              data-testid="send-delete-action"
              type="button"
              bitMenuItem
              variant="danger"
              (click)="requestDelete(send, moreTrigger)"
            >
              {{ "i18nDelete" | i18n }}
            </button>
          </bit-menu>
        </bit-item-action>`,
  },
] as const;

export const sendRowTemplateTransforms = [
  removeSendTypeFileIconBlock,
  replaceRouterLinkWithOpenOutput,
  replaceClipboardAndDeleteServicesWithTypedOutputs,
] as const;

const sendCreatedTemplateTransforms = [
  {
    search: `    [pageTitle]="'createdSend' | i18n"
    showBackButton
    [backAction]="goBack.bind(this)"`,
    replacement: `    [pageTitle]="'i18nSendCreated' | i18n"
    showBackButton
    [backAction]="backAction"`,
  },
  {
    search: "      <app-pop-out></app-pop-out>",
    replacement: '      <button bitIconButton="bwi-popout" type="button" [attr.aria-label]="\'i18nPopOut\' | i18n" (click)="popOut.emit()"></button>',
  },
  {
    search: `  <div
    class="tw-flex tw-bg-background-alt tw-flex-col tw-justify-center tw-items-center tw-gap-2 tw-h-full tw-px-5"
  >`,
    replacement: `  <section class="macos-send-created__summary" aria-labelledby="send-created-title">`,
  },
  {
    search: `    <div class="tw-size-[95px] tw-content-center">
      <bit-svg [content]="sendCreatedIcon"></bit-svg>
    </div>
`,
    replacement: "",
  },
  {
    search: `    <h3 tabindex="0" appAutofocus class="tw-font-medium">
      {{ "createdSendSuccessfully" | i18n }}
    </h3>
    <p class="tw-text-center">
      @let translationKey =
        send.authType === AuthType.Email
          ? "sendCreatedDescriptionEmail"
          : send.authType === AuthType.Password
            ? "sendCreatedDescriptionPassword"
            : "sendCreatedDescriptionV2";
      {{ translationKey | i18n: formattedExpirationTime }}
    </p>
    <button bitButton type="button" buttonType="primary" (click)="copyLink()">
      <b>{{ "copyLink" | i18n }}</b>
    </button>`,
    replacement: `    <div class="macos-send-created__icon" aria-hidden="true">
      <bit-svg [content]="sendCreatedIcon" />
    </div>
    <h2 id="send-created-title" tabindex="-1">{{ "i18nSendCreatedSuccess" | i18n }}</h2>
    <p>
      @if (send().hasPassword) {
        {{ "i18nSendPasswordExpires" | i18n: formattedExpiration() }}
      } @else {
        {{ "i18nSendExpires" | i18n: formattedExpiration() }}
      }
    </p>
    <label for="send-created-link">{{ "i18nCopySendLink" | i18n }}</label>
    <input
      id="send-created-link"
      data-testid="created-link"
      type="text"
      readonly
      [value]="link()"
      [attr.aria-label]="'i18nCopySendLink' | i18n"
    />`,
  },
  {
    search: `  </div>
  <popup-footer slot="footer">`,
    replacement: `  </section>
  <popup-footer slot="footer">`,
  },
  {
    search: `    <button bitButton type="button" buttonType="primary" (click)="copyLink()">
      <b>{{ "copyLink" | i18n }}</b>
    </button>
    <button bitButton type="button" buttonType="secondary" (click)="goBack()">
      {{ "close" | i18n }}
    </button>`,
    replacement: `    <button data-testid="created-copy" bitButton type="button" buttonType="primary" (click)="copyLink.emit($event)">
      {{ "i18nCopySendLink" | i18n }}
    </button>
    <button data-testid="created-close" bitButton type="button" buttonType="secondary" (click)="close.emit()">
      {{ "close" | i18n }}
    </button>`,
  },
] as const;

export const sendTemplateContracts = [
  {
    authority: "apps/browser/src/tools/popup/send-v2/send-v2.component.html",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.html",
    authoritySha256: "43e955124658d0c0b4d7683557ac119950c63df500b854e73da83a022ffb2e82",
    transforms: sendListTemplateTransforms.flat(),
  },
  {
    authority: "libs/tools/send/send-ui/src/send-list-items-container/send-list-items-container.component.html",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list-items-container.component.html",
    authoritySha256: "550f4fd09d002e5ac80c8f45e3f62ca8949478f6ff2a03ca77902eff58bc5e02",
    transforms: sendRowTemplateTransforms.flat(),
  },
  {
    authority: "apps/browser/src/tools/popup/send-v2/send-created/send-created.component.html",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-created.component.html",
    authoritySha256: "9770325116224a4b10722b54ceb001ea6e1436223d56ebd527190b1e24eb9e88",
    transforms: sendCreatedTemplateTransforms,
  },
  {
    authority: "libs/tools/send/send-ui/src/send-form/components/send-details/send-details.component.html",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-details.component.html",
    authoritySha256: "c352417674e54cbdf368d68a393b5f93b6397ea67b4277a13346c12fc3e11fb1",
    patch: detailsHtmlPatch,
    transforms: staticPatchTransforms(detailsHtmlPatch),
  },
  {
    authority: "libs/tools/send/send-ui/src/send-form/components/send-details/send-text-details.component.html",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-text-details.component.html",
    authoritySha256: "6f618f3dea5b370c131494a945e7023b38b7038cfcf9f8a7162944bb8834893f",
    patch: textDetailsHtmlPatch,
    transforms: staticPatchTransforms(textDetailsHtmlPatch),
  },
  {
    authority: "libs/tools/send/send-ui/src/send-form/components/options/send-options.component.html",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-options.component.html",
    authoritySha256: "de83dc0a6e24c1bb5fd41480eeab668b674a4dd5f509f072b0824c47326d7bf4",
    patch: optionsHtmlPatch,
    transforms: staticPatchTransforms(optionsHtmlPatch),
  },
  {
    authority: "apps/browser/src/tools/popup/send-v2/add-edit/send-add-edit.component.html",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-add-edit.component.html",
    authoritySha256: "a2730a0d91b19ac28e272471d02c6a1244d1c0bfff2399e3881ba78b63c3f803",
    patch: addEditHtmlPatch,
    transforms: staticPatchTransforms(addEditHtmlPatch),
  },
] as const satisfies readonly ExactContinuousSourceContract[];

// Task 4 retains these authorities through exact, auditable local projections. The
// template contracts above remain executable because the parent and child sources
// require distinct TypeScript and template removals.
export const retainedTextSendFormAuthorities = [
  "libs/tools/send/send-ui/src/send-form/components/send-details/send-details.component.html",
  "libs/tools/send/send-ui/src/send-form/components/send-details/send-text-details.component.html",
  "libs/tools/send/send-ui/src/send-form/components/options/send-options.component.html",
  "apps/browser/src/tools/popup/send-v2/add-edit/send-add-edit.component.html",
] as const;

export function applyExactContinuousBlockTransforms(
  authoritySource: string,
  contract: ExactContinuousSourceContract,
): string {
  if (contract.patch !== undefined) {
    return applyStaticUnifiedPatch(authoritySource, contract.patch);
  }
  let transformed = authoritySource;
  for (const [index, operation] of contract.transforms.entries()) {
    const matches = operation.search.length === 0 ? 0 : transformed.split(operation.search).length - 1;
    if (matches !== 1) {
      throw new Error(`${contract.authority} block ${index + 1} must match exactly once; received ${matches}`);
    }
    if (operation.search === authoritySource) {
      throw new Error(`${contract.authority} cannot replace the whole source`);
    }
    transformed = transformed.replace(operation.search, operation.replacement);
  }
  return transformed;
}

function staticPatchTransforms(patch: string): readonly ExactContinuousBlockTransform[] {
  return parseStaticUnifiedPatch(patch).map((hunk) => ({
    oldStart: hunk.oldStart,
    oldCount: hunk.oldCount,
    newCount: hunk.newCount,
    search: hunk.lines.filter((line) => line.startsWith("-") || line.startsWith(" "))
      .map((line) => line.slice(1)).join("\n"),
    replacement: hunk.lines.filter((line) => line.startsWith("+") || line.startsWith(" "))
      .map((line) => line.slice(1)).join("\n"),
  }));
}

function applyStaticUnifiedPatch(authoritySource: string, patch: string): string {
  const authorityHasFinalNewline = authoritySource.endsWith("\n");
  const authorityLines = (authorityHasFinalNewline ? authoritySource.slice(0, -1) : authoritySource)
    .split("\n");
  const output: string[] = [];
  let cursor = 0;

  for (const hunk of parseStaticUnifiedPatch(patch)) {
    const hunkStart = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1;
    if (hunkStart < cursor || hunkStart > authorityLines.length) {
      throw new Error(`Static patch hunk starts outside pinned authority at line ${hunk.oldStart}`);
    }
    output.push(...authorityLines.slice(cursor, hunkStart));
    let authorityCursor = hunkStart;
    let removed = 0;
    let added = 0;

    for (const line of hunk.lines) {
      const marker = line[0];
      const content = line.slice(1);
      if (marker === "-" || marker === " ") {
        if (authorityLines[authorityCursor] !== content) {
          throw new Error(`Static patch authority mismatch at line ${authorityCursor + 1}`);
        }
        authorityCursor += 1;
        removed += 1;
      }
      if (marker === "+" || marker === " ") {
        output.push(content);
        added += 1;
      }
    }
    if (removed !== hunk.oldCount || added !== hunk.newCount) {
      throw new Error(`Static patch hunk count mismatch at line ${hunk.oldStart}`);
    }
    cursor = authorityCursor;
  }

  output.push(...authorityLines.slice(cursor));
  return `${output.join("\n")}${authorityHasFinalNewline ? "\n" : ""}`;
}

type StaticPatchHunk = {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newCount: number;
  readonly lines: readonly string[];
};

function parseStaticUnifiedPatch(patch: string): readonly StaticPatchHunk[] {
  const lines = patch.replace(/\n+$/, "").split("\n");
  if (lines[0] !== "--- authority" || lines[1] !== "+++ runtime") {
    throw new Error("Static Task 4 patch must declare authority and runtime labels");
  }
  const hunks: StaticPatchHunk[] = [];
  for (let index = 2; index < lines.length;) {
    const header = lines[index]?.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/);
    if (!header) throw new Error(`Invalid static patch hunk header: ${lines[index] ?? "<missing>"}`);
    index += 1;
    const hunkLines: string[] = [];
    while (index < lines.length && !lines[index]!.startsWith("@@ ")) {
      if (!/^[ +\-]/.test(lines[index]!)) {
        throw new Error(`Invalid static patch hunk line: ${lines[index]}`);
      }
      hunkLines.push(lines[index]!);
      index += 1;
    }
    hunks.push({
      oldStart: Number(header[1]),
      oldCount: header[2] === undefined ? 1 : Number(header[2]),
      newCount: header[4] === undefined ? 1 : Number(header[4]),
      lines: hunkLines,
    });
  }
  if (hunks.length === 0) throw new Error("Static Task 4 patch must contain at least one hunk");
  return hunks;
}

type SendTypeScriptContract = {
  readonly authority: string;
  readonly runtime: string;
  readonly authorityClass: string;
  readonly runtimeClass: string;
  readonly authoritySha256: string;
  readonly requiredRuntimeMembers: readonly string[];
  readonly requiredImports: readonly { readonly module: string; readonly bindings: readonly string[] }[];
  readonly mutationSearch: string;
  readonly mutationReplacement: string;
  readonly patch: string;
  readonly transforms: readonly ExactContinuousBlockTransform[];
};

export const sendTypeScriptContracts = [
  {
    authority: "libs/tools/send/send-ui/src/send-list/send-list.component.ts",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.ts",
    authorityClass: "SendListComponent", runtimeClass: "OfficialSendListComponent",
    authoritySha256: "34992501db328590360fa2dc4b9e935ce399afa3451757da4e5a17dba8c03aac",
    requiredRuntimeMembers: ["sends", "query", "filtersVisible", "loading", "disabled", "state", "queryChange", "toggleFilters", "filterChange", "open", "copyLink", "delete", "inputValue"],
    requiredImports: [{ module: "@angular/core", bindings: ["ChangeDetectionStrategy", "Component", "input", "output"] }, { module: "@angular/forms", bindings: ["FormsModule"] }, { module: "./official-send-list-items-container.component", bindings: ["OfficialSendListItemsContainerComponent", "OfficialTextSendListItem"] }],
    mutationSearch: "readonly queryChange", mutationReplacement: "readonly damagedQueryChange",
    patch: listTypeScriptPatch, transforms: staticPatchTransforms(listTypeScriptPatch),
  },
  {
    authority: "libs/tools/send/send-ui/src/send-list-items-container/send-list-items-container.component.ts",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list-items-container.component.ts",
    authorityClass: "SendListItemsContainerComponent", runtimeClass: "OfficialSendListItemsContainerComponent",
    authoritySha256: "e341b2b8bfec76b52003a91186e05dcfee16ec9e403be658d18ac4d189c8a24b",
    requiredRuntimeMembers: ["sends", "headerText", "open", "copyLink", "delete", "requestDelete", "trackById"],
    requiredImports: [{ module: "@angular/common", bindings: ["CommonModule"] }, { module: "@angular/core", bindings: ["ChangeDetectionStrategy", "Component", "input", "output"] }, { module: "../../official-ui/official-components", bindings: ["MenuComponent", "MenuItemComponent", "MenuTriggerForDirective"] }],
    mutationSearch: "readonly copyLink", mutationReplacement: "readonly damagedCopyLink",
    patch: listItemsTypeScriptPatch, transforms: staticPatchTransforms(listItemsTypeScriptPatch),
  },
  {
    authority: "apps/browser/src/tools/popup/send-v2/send-created/send-created.component.ts",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-created.component.ts",
    authorityClass: "SendCreatedComponent", runtimeClass: "OfficialSendCreatedComponent",
    authoritySha256: "84f5fa48f78a9b9d52189fb43812ed7bd638f17e9f9f0f77d057a0911e27e5ae",
    requiredRuntimeMembers: ["send", "formattedExpiration", "link", "copyLink", "close", "popOut", "sendCreatedIcon", "backAction"],
    requiredImports: [{ module: "@angular/core", bindings: ["ChangeDetectionStrategy", "Component", "input", "output"] }, { module: "@bitwarden/assets/svg", bindings: ["ActiveSendIcon"] }, { module: "@bitwarden/components", bindings: ["SvgModule"] }],
    mutationSearch: "readonly backAction", mutationReplacement: "readonly damagedBackAction",
    patch: createdTypeScriptPatch, transforms: staticPatchTransforms(createdTypeScriptPatch),
  },
  {
    authority: "libs/tools/send/send-ui/src/send-form/components/send-details/send-details.component.ts",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-details.component.ts",
    authorityClass: "SendDetailsComponent", runtimeClass: "OfficialSendDetailsComponent",
    authoritySha256: "6eec99e7e0d83214b0b88cb3c55702d85ee518e0b58e89c059cfe1bc70293012",
    requiredRuntimeMembers: ["editing", "disabled", "originalHadPassword", "hideEmailAllowed", "value", "errors", "touched", "valueChange", "fieldBlur", "removePassword", "generatePassword", "copyPassword", "datePresetOptions:get", "authOptions:get", "authorizationOptions:get", "inputValue", "deletionPreset", "authType", "deletionLabel", "authTypeLabel"],
    requiredImports: [{ module: "@angular/core", bindings: ["ChangeDetectionStrategy", "Component", "ElementRef", "afterRenderEffect", "inject", "input", "output"] }, { module: "@angular/forms", bindings: ["FormsModule"] }, { module: "../../send/retained-text-send-form.service", bindings: ["RetainedTextSendErrors", "RetainedTextSendField", "RetainedTextSendFormValue"] }, { module: "./official-send-options.component", bindings: ["OfficialSendOptionsComponent"] }, { module: "./official-send-text-details.component", bindings: ["OfficialSendTextDetailsComponent"] }],
    mutationSearch: "get authorizationOptions()", mutationReplacement: "get damagedAuthorizationOptions()",
    patch: detailsTypeScriptPatch, transforms: staticPatchTransforms(detailsTypeScriptPatch),
  },
  {
    authority: "libs/tools/send/send-ui/src/send-form/components/send-details/send-text-details.component.ts",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-text-details.component.ts",
    authorityClass: "SendTextDetailsComponent", runtimeClass: "OfficialSendTextDetailsComponent",
    authoritySha256: "25925ca466087bdc3604462cec5db5409f375a4dd1c0494b7ab4fe936197db8d",
    requiredRuntimeMembers: ["editing", "value", "errors", "touched", "valueChange", "fieldBlur", "inputValue", "checked", "showHiddenCheckbox"],
    requiredImports: [{ module: "@angular/core", bindings: ["ChangeDetectionStrategy", "Component", "ElementRef", "afterRenderEffect", "inject", "input", "output"] }, { module: "../../send/retained-text-send-form.service", bindings: ["RetainedTextSendErrors", "RetainedTextSendField", "RetainedTextSendFormValue"] }],
    mutationSearch: "showHiddenCheckbox", mutationReplacement: "damagedShowHiddenCheckbox",
    patch: textDetailsTypeScriptPatch, transforms: staticPatchTransforms(textDetailsTypeScriptPatch),
  },
  {
    authority: "libs/tools/send/send-ui/src/send-form/components/options/send-options.component.ts",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-options.component.ts",
    authorityClass: "SendOptionsComponent", runtimeClass: "OfficialSendOptionsComponent",
    authoritySha256: "b8d23cdecd7b7df82ef54e072628b668e0fae78faf47237f5a8b10015b1b950c",
    requiredRuntimeMembers: ["editing", "hideEmailAllowed", "value", "errors", "touched", "valueChange", "fieldBlur", "inputValue", "checked", "anyOptionFieldVisible", "maxAccessCountVisible", "hideEmailVisible", "privateNoteVisible", "syncMaxAccessCountAccessibility"],
    requiredImports: [{ module: "@angular/core", bindings: ["ChangeDetectionStrategy", "Component", "ElementRef", "afterRenderEffect", "inject", "input", "output"] }, { module: "../../send/retained-text-send-form.service", bindings: ["RetainedTextSendErrors", "RetainedTextSendField", "RetainedTextSendFormValue"] }],
    mutationSearch: "privateNoteVisible", mutationReplacement: "damagedPrivateNoteVisible",
    patch: optionsTypeScriptPatch, transforms: staticPatchTransforms(optionsTypeScriptPatch),
  },
  {
    authority: "apps/browser/src/tools/popup/send-v2/add-edit/send-add-edit.component.ts",
    runtime: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-add-edit.component.ts",
    authorityClass: "SendAddEditComponent", runtimeClass: "OfficialSendAddEditComponent",
    authoritySha256: "5da4021ac7001642173b7e7ae8771adf67b8e50590ca7d6c88d720d67f9823de",
    requiredRuntimeMembers: ["mode", "editing", "disabled", "pending", "valid", "unavailable", "value", "errors", "touched", "originalHadPassword", "hideEmailAllowed", "status", "backAction", "edit", "save", "cancel", "back", "delete", "removePassword", "generatePassword", "copyPassword", "valueChange", "fieldBlur", "editingChange", "focusFirstError", "title:get"],
    requiredImports: [{ module: "@angular/core", bindings: ["ChangeDetectionStrategy", "Component", "input", "output"] }, { module: "../../send/retained-text-send-form.service", bindings: ["RetainedTextSendErrors", "RetainedTextSendField", "RetainedTextSendFormValue"] }, { module: "./official-send-details.component", bindings: ["OfficialSendDetailsComponent"] }],
    mutationSearch: "readonly backAction", mutationReplacement: "readonly damagedBackAction",
    patch: addEditTypeScriptPatch, transforms: staticPatchTransforms(addEditTypeScriptPatch),
  },
] as const satisfies readonly SendTypeScriptContract[];

export function validateSendTypeScriptContract(authority: string, runtime: string, contract: SendTypeScriptContract): string[] {
  if (createHash("sha256").update(authority).digest("hex") !== contract.authoritySha256) return [`${contract.authority} pinned authority drift`];
  if (applyStaticUnifiedPatch(authority, contract.patch) !== runtime) {
    return [`${contract.runtime} differs from its static exact transform`];
  }
  const authorityClass = classMembers(authority, contract.authorityClass);
  const runtimeClass = classMembers(runtime, contract.runtimeClass);
  if (!authorityClass) return [`${contract.authorityClass} missing from authority`];
  if (!runtimeClass) return [`${contract.runtimeClass} missing from runtime`];
  return contract.requiredRuntimeMembers.filter((member) => !runtimeClass.has(member)).map((member) => `${contract.runtimeClass}.${member} is missing`);
}

export function validateSendTypeScriptImportContract(authority: string, runtime: string, contract: SendTypeScriptContract): string[] {
  if (!classMembers(authority, contract.authorityClass)) return [`${contract.authorityClass} missing from authority`];
  const imports = importedBindings(runtime);
  return contract.requiredImports.flatMap(({ module, bindings }) => {
    const available = imports.get(module) ?? new Set<string>();
    return bindings.filter((binding) => !available.has(binding)).map((binding) => `${contract.runtime} missing ${binding} from ${module}`);
  });
}

function classMembers(source: string, className: string): Set<string> | null {
  const file = ts.createSourceFile("official-send-contract.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = file.statements.find((statement): statement is ts.ClassDeclaration => ts.isClassDeclaration(statement) && statement.name?.text === className);
  if (!declaration) return null;
  return new Set(declaration.members.flatMap((member) => {
    if (ts.isConstructorDeclaration(member)) return ["constructor"];
    const name = member.name?.getText(file);
    if (!name) return [];
    return [ts.isGetAccessorDeclaration(member) ? `${name}:get` : name];
  }));
}

function importedBindings(source: string): Map<string, Set<string>> {
  const file = ts.createSourceFile("official-send-imports.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return new Map(file.statements.filter(ts.isImportDeclaration).map((statement) => [
    (statement.moduleSpecifier as ts.StringLiteral).text,
    new Set(statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) ? statement.importClause.namedBindings.elements.map((element) => element.name.text) : []),
  ]));
}

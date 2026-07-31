import type { AuthSession } from "../../src/auth/auth-session-store";
import type { BitwardenApiClient } from "../../src/bitwarden-api/bitwarden-api";
import type {
  VaultCipherWritePort,
} from "../../src/app/vault/vault-cipher-write.service";
import type { VaultFolderService } from "../../src/app/vault/vault-folder.service";
import type { VaultItem } from "../../src/app/vault/vault-item.model";
import type { VaultSyncResult } from "../../src/vault/vault-sync.service";
import { fixedLiveStage, fixedLiveStageAsync } from "./live-standard-password-login";
import {
  assertLiveCleanup,
  runLiveMutation,
  type LiveRunContext,
  type LiveServiceClass,
  type LiveStageResult,
} from "./live-test-protocol";

export type VaultScenarioKind = "login" | "card" | "identity" | "secure-note";

type PersonalCipherCreateExpectation =
  | { readonly kind: "login"; readonly name: string; readonly username: string }
  | {
      readonly kind: "card";
      readonly name: string;
      readonly brand: string;
      readonly cardholderName: string;
    }
  | {
      readonly kind: "identity";
      readonly name: string;
      readonly firstName: string;
      readonly title: string;
    }
  | {
      readonly kind: "secure-note";
      readonly name: string;
      readonly noteType: number;
      readonly notes: string;
    };

type LiveVaultApi = Pick<BitwardenApiClient,
  "getSync" | "putPartialCipher" | "putArchiveCiphers" | "putUnarchiveCiphers" |
  "putDeleteCipher" | "putRestoreCipher" | "deleteCipher"
>;

export interface LiveVaultDependencies {
  readonly session: AuthSession;
  readonly api: LiveVaultApi;
  readonly context: LiveRunContext;
  readonly folders: Pick<VaultFolderService, "create" | "update" | "delete">;
  readonly writes: Pick<VaultCipherWritePort, keyof VaultCipherWritePort>;
  readonly syncProjection: () => Promise<VaultSyncResult>;
}

export interface LiveVaultReadOnlySnapshot {
  readonly vaultSyncStatus: "fresh" | "stale" | "unavailable";
  readonly lastSuccessfulSyncDate: Date | null;
  readonly items: readonly VaultItem[];
  readonly folders: VaultSyncResult["folders"];
  readonly sends: VaultSyncResult["sends"];
  readonly message?: string;
}

export interface LiveVaultReadOnlyDependencies {
  readonly service: LiveServiceClass;
  readonly syncNow: () => Promise<void>;
  readonly snapshot: () => LiveVaultReadOnlySnapshot;
  readonly useTransportFailure: () => void;
  readonly failInitial: () => Promise<LiveVaultReadOnlySnapshot>;
  readonly assertRetained: (snapshot: LiveVaultReadOnlySnapshot) => void;
}

export async function runFolderScenario(deps: LiveVaultDependencies): Promise<LiveStageResult> {
  const { api, context, folders, session } = deps;
  let removed = false;
  let folderId = "";
  const remove = async () => {
    if (!folderId || removed) return;
    const outcome = await folders.delete(session, folderId, { isCurrent: () => true });
    if (!outcome.committed) throw new Error("Live folder delete did not complete");
    removed = true;
  };

  return runLiveMutation(context, "folder", [], async () => {
    const createdName = `${context.prefix} Folder`;
    const createdOutcome = await fixedLiveStageAsync("Live folder create did not complete", () =>
      folders.create(session, createdName, { isCurrent: () => true }),
    );
    if (!createdOutcome.committed || !createdOutcome.folder) {
      throw new Error("Live folder create did not complete");
    }
    folderId = createdOutcome.folder.id;
    context.cleanup.register("folder", remove);
    context.track("folder", folderId, createdOutcome.folder.name);

    await assertFolderState(
      deps,
      folderId,
      true,
      "Live folder create sync did not complete",
      createdName,
      "Live folder create projection did not match",
    );
    const updatedName = `${context.prefix} Folder updated`;
    const updatedOutcome = await fixedLiveStageAsync("Live folder update did not complete", () =>
      folders.update(session, folderId, updatedName, { isCurrent: () => true }),
    );
    if (!updatedOutcome.committed || updatedOutcome.folder?.id !== folderId) {
      throw new Error("Live folder update did not complete");
    }
    await assertFolderState(
      deps,
      folderId,
      true,
      "Live folder update sync did not complete",
      updatedName,
      "Live folder update projection did not match",
    );
    await fixedLiveStageAsync("Live folder delete did not complete", remove);
    await assertFolderState(deps, folderId, false, "Live folder delete sync did not complete");
  }, () => verifyLiveCleanupAbsence(deps));
}

export async function runPersonalCipherScenario(
  kind: VaultScenarioKind,
  deps: LiveVaultDependencies,
): Promise<LiveStageResult> {
  const { api, context, session, writes } = deps;
  let cipherId = "";
  let removed = false;
  const remove = async () => {
    if (!cipherId || removed) return;
    await api.deleteCipher(cipherId, session.token.accessToken);
    removed = true;
  };

  return runLiveMutation(context, kind, [], async () => {
    const requestedCreate = personalCipherCreateExpectation(kind, context.prefix);
    const created = await createPersonalCipher(requestedCreate, writes, session);
    cipherId = created.id;
    context.cleanup.register("cipher", remove);
    context.track("cipher", cipherId, requestedCreate.name);
    const createdProjection = await assertCipherState(
      deps,
      cipherId,
      "active",
      "Live cipher create sync did not complete",
    );
    const projectedCreated = createdProjection.items.find((item) => item.id === cipherId);
    assertCreatedCipherProjection(requestedCreate, projectedCreated);

    const updated = await updatePersonalCipher(
      kind,
      writes,
      session,
      projectedCreated!,
      context.prefix,
    );
    if (updated.id !== cipherId || !updated.favorite) {
      throw new Error("Live cipher update did not complete");
    }
    const updatedProjection = await assertCipherState(
      deps,
      cipherId,
      "active",
      "Live cipher update sync did not complete",
    );
    const projectedUpdated = updatedProjection.items.find((item) => item.id === cipherId);
    const expectedUpdatedName = `${context.prefix} ${scenarioLabel(kind)} updated`;
    assertUpdatedCipherProjection(kind, projectedUpdated, expectedUpdatedName);

    await fixedLiveStageAsync("Live cipher favorite did not complete", () =>
      api.putPartialCipher(cipherId, session.token.accessToken, { favorite: true }),
    );
    const favoriteProjection = await assertCipherState(
      deps,
      cipherId,
      "active",
      "Live cipher favorite sync did not complete",
    );
    if (!favoriteProjection.items.some((item) => item.id === cipherId && item.favorite)) {
      throw new Error("Live cipher favorite sync did not complete");
    }
    await fixedLiveStageAsync("Live cipher archive did not complete", () =>
      api.putArchiveCiphers([cipherId], session.token.accessToken),
    );
    await assertCipherState(deps, cipherId, "archived", "Live cipher archive sync did not complete");
    await fixedLiveStageAsync("Live cipher unarchive did not complete", () =>
      api.putUnarchiveCiphers([cipherId], session.token.accessToken),
    );
    await assertCipherState(deps, cipherId, "active", "Live cipher unarchive sync did not complete");
    await fixedLiveStageAsync("Live cipher soft delete did not complete", () =>
      api.putDeleteCipher(cipherId, session.token.accessToken),
    );
    await assertCipherState(deps, cipherId, "deleted", "Live cipher delete sync did not complete");
    await fixedLiveStageAsync("Live cipher restore did not complete", () =>
      api.putRestoreCipher(cipherId, session.token.accessToken),
    );
    await assertCipherState(deps, cipherId, "active", "Live cipher restore sync did not complete");
    await fixedLiveStageAsync("Live cipher permanent delete did not complete", remove);
    await assertCipherState(deps, cipherId, "absent", "Live cipher permanent delete sync did not complete");
  }, () => verifyLiveCleanupAbsence(deps));
}

export async function runVaultReadOnlyScenario(
  deps: LiveVaultReadOnlyDependencies,
): Promise<readonly LiveStageResult[]> {
  await fixedLiveStageAsync(
    "Live vault read-only sync did not complete",
    deps.syncNow,
  );
  const fresh = fixedLiveStage(
    "Live vault read-only cache apply did not complete",
    () => {
      const snapshot = deps.snapshot();
      if (snapshot.vaultSyncStatus !== "fresh" || !snapshot.lastSuccessfulSyncDate) {
        throw new Error("Live vault sync did not produce fresh cache");
      }
      return snapshot;
    },
  );

  fixedLiveStage("Live vault read-only transport switch did not complete", () =>
    deps.useTransportFailure(),
  );
  await fixedLiveStageAsync(
    "Live vault read-only offline sync did not complete",
    deps.syncNow,
  );
  const stale = fixedLiveStage(
    "Live vault read-only offline sync did not complete",
    () => {
      const snapshot = deps.snapshot();
      if (
        snapshot.vaultSyncStatus !== "stale" ||
        snapshot.lastSuccessfulSyncDate?.getTime() !== fresh.lastSuccessfulSyncDate.getTime() ||
        snapshot.message !== "无法同步，正在显示已保存的密码库数据。"
      ) {
        throw new Error("Live vault offline cache did not remain available");
      }
      return snapshot;
    },
  );
  fixedLiveStage("Live vault read-only cache assertion did not complete", () =>
    deps.assertRetained(stale),
  );

  const unavailable = await fixedLiveStageAsync(
    "Live vault read-only initial sync did not complete",
    async () => {
      const snapshot = await deps.failInitial();
      if (
        snapshot.vaultSyncStatus !== "unavailable" ||
        snapshot.lastSuccessfulSyncDate !== null ||
        snapshot.message !== "无法加载密码库，请重试。"
      ) {
        throw new Error("Live vault initial offline state did not become unavailable");
      }
      return snapshot;
    },
  );
  fixedLiveStage("Live vault read-only cache assertion did not complete", () =>
    deps.assertRetained(unavailable),
  );

  return ["sync", "sync"].map((stage) => ({
    service: deps.service,
    mode: "read-only" as const,
    stage: stage as "sync",
    status: "passed" as const,
  }));
}

async function createPersonalCipher(
  requested: PersonalCipherCreateExpectation,
  writes: LiveVaultDependencies["writes"],
  session: AuthSession,
): Promise<VaultItem> {
  switch (requested.kind) {
    case "login":
      return fixedLiveStageAsync("Live cipher create did not complete", () => writes.createLoginCipher(session, {
        name: requested.name, username: requested.username, password: "synthetic-password", totp: "",
        uri: "https://login.example.test", notes: "isolated mutation smoke", favorite: false, reprompt: true,
      }));
    case "card":
      return fixedLiveStageAsync("Live cipher create did not complete", () => writes.createCardCipher(session, {
        name: requested.name, cardholderName: requested.cardholderName, brand: requested.brand, number: "4111111111111111",
        expMonth: "04", expYear: "2029", code: "123", notes: "isolated mutation smoke", favorite: false,
        reprompt: true, fields: [{ name: "Region", value: "APAC", type: 0 }],
      }));
    case "identity":
      return fixedLiveStageAsync("Live cipher create did not complete", () => writes.createIdentityCipher(session, {
        name: requested.name, title: requested.title, firstName: requested.firstName, middleName: "Augusta", lastName: "Lovelace",
        username: "synthetic-identity", company: "Analytical Engines", ssn: "000-00-0000", passportNumber: "P1234567",
        licenseNumber: "L7654321", email: "identity@example.test", phone: "+44 20 0000", address1: "12 Engine Lane",
        address2: "Suite 2", address3: "Research Park", city: "London", state: "Greater London", postalCode: "N1 1AA",
        country: "United Kingdom", notes: "isolated mutation smoke", favorite: false, reprompt: true,
        fields: [{ name: "Region", value: "EU", type: 0 }],
      }));
    case "secure-note":
      return fixedLiveStageAsync("Live cipher create did not complete", () => writes.createSecureNoteCipher(session, {
        name: requested.name, notes: requested.notes, noteType: requested.noteType, favorite: false,
        reprompt: true, fields: [{ name: "Region", value: "EU", type: 0 }],
      }));
  }
}

function personalCipherCreateExpectation(
  kind: VaultScenarioKind,
  prefix: string,
): PersonalCipherCreateExpectation {
  switch (kind) {
    case "login":
      return { kind, name: `${prefix} Login`, username: "synthetic-user" };
    case "card":
      return {
        kind,
        name: `${prefix} Card`,
        brand: "Visa",
        cardholderName: "Synthetic User",
      };
    case "identity":
      return { kind, name: `${prefix} Identity`, firstName: "Ada", title: "Dr" };
    case "secure-note":
      return {
        kind,
        name: `${prefix} Secure Note`,
        noteType: 0,
        notes: "isolated mutation smoke",
      };
  }
}

async function updatePersonalCipher(
  kind: VaultScenarioKind,
  writes: LiveVaultDependencies["writes"],
  session: AuthSession,
  item: VaultItem,
  prefix: string,
): Promise<VaultItem> {
  switch (kind) {
    case "login":
      return fixedLiveStageAsync("Live cipher update did not complete", () => writes.updateLoginCipher(session, item, {
        name: `${prefix} Login updated`, username: "synthetic-user-updated", password: "synthetic-password-updated", totp: "",
        uri: "https://updated.example.test", notes: "isolated mutation smoke updated", favorite: true, reprompt: true,
      }));
    case "card":
      return fixedLiveStageAsync("Live cipher update did not complete", () => writes.updateCardCipher(session, item, {
        name: `${prefix} Card updated`, cardholderName: "Synthetic User Updated", brand: "Mastercard", number: "5555555555554444",
        expMonth: "08", expYear: "2031", code: "987", notes: "isolated mutation smoke updated", favorite: true,
        reprompt: true, fields: [{ name: "Region", value: "EU", type: 0 }],
      }));
    case "identity":
      return fixedLiveStageAsync("Live cipher update did not complete", () => writes.updateIdentityCipher(session, item, {
        name: `${prefix} Identity updated`, title: "Prof", firstName: "Grace", middleName: "Brewster", lastName: "Hopper",
        username: "synthetic-identity-updated", company: "Compiler Systems", ssn: "111-11-1111", passportNumber: "P7654321",
        licenseNumber: "L1234567", email: "identity-updated@example.test", phone: "+1 555 0100", address1: "1 Compiler Way",
        address2: "Floor 3", address3: "", city: "Arlington", state: "Virginia", postalCode: "22201", country: "United States",
        notes: "isolated mutation smoke updated", favorite: true, reprompt: true, fields: [{ name: "Region", value: "US", type: 0 }],
      }));
    case "secure-note":
      return fixedLiveStageAsync("Live cipher update did not complete", () => writes.updateSecureNoteCipher(session, item, {
        name: `${prefix} Secure Note updated`, notes: "isolated mutation smoke updated", noteType: 0,
        favorite: true, reprompt: true, fields: [{ name: "Region", value: "US", type: 0 }],
      }));
  }
}

async function assertFolderState(
  deps: LiveVaultDependencies,
  folderId: string,
  present: boolean,
  message: string,
  expectedName?: string,
  projectionMessage = message,
): Promise<void> {
  const sync = await fixedLiveStageAsync(message, () => deps.api.getSync(deps.session.token.accessToken));
  const rawIds = collectionIds(sync, "Folders", "folders");
  if (rawIds.has(folderId) !== present) throw new Error(message);
  const projected = await fixedLiveStageAsync(message, deps.syncProjection);
  const projectedFolder = projected.folders.find((folder) => folder.id === folderId);
  if (
    Boolean(projectedFolder) !== present ||
    (present && projectedFolder?.name !== expectedName)
  ) {
    throw new Error(projectionMessage);
  }
}

async function assertCipherState(
  deps: LiveVaultDependencies,
  cipherId: string,
  state: "active" | "archived" | "deleted" | "absent",
  message: string,
): Promise<VaultSyncResult> {
  const sync = await fixedLiveStageAsync(message, () => deps.api.getSync(deps.session.token.accessToken));
  const raw = collectionRecords(sync, "Ciphers", "ciphers");
  const matches = raw.filter((entry) => entryId(entry) === cipherId);
  const rawState = matches.length === 0 ? "absent" : recordCipherState(matches[0]!);
  if (rawState !== state) throw new Error(message);
  const projected = await fixedLiveStageAsync(message, deps.syncProjection);
  const lists = {
    active: projected.items,
    archived: projected.archivedItems,
    deleted: projected.deletedItems,
    absent: [],
  } as const;
  const inExpected = lists[state].some((item) => item.id === cipherId);
  const inOther = Object.entries(lists)
    .filter(([key]) => key !== state)
    .some(([, items]) => items.some((item) => item.id === cipherId));
  if ((state !== "absent" && !inExpected) || inOther) throw new Error(message);
  return projected;
}

async function verifyLiveCleanupAbsence(deps: LiveVaultDependencies): Promise<void> {
  const cleanupSync = await fixedLiveStageAsync("Live cleanup sync did not complete", () =>
    deps.api.getSync(deps.session.token.accessToken),
  );
  const decrypted = await fixedLiveStageAsync("Live cleanup projection did not complete", deps.syncProjection);
  assertLiveCleanup(cleanupSync, decrypted, deps.context);
}

function collectionIds(value: unknown, pascalCase: string, camelCase: string): Set<string> {
  return new Set(collectionRecords(value, pascalCase, camelCase).flatMap(entryId));
}

function collectionRecords(value: unknown, pascalCase: string, camelCase: string): readonly Record<string, unknown>[] {
  if (!isRecord(value)) throw new Error("Live vault sync response must be structured");
  const collection = value[pascalCase] ?? value[camelCase];
  if (!Array.isArray(collection)) throw new Error("Live vault sync response must include collection structure");
  return collection.filter(isRecord);
}

function entryId(entry: Record<string, unknown>): string | null {
  const id = entry["Id"] ?? entry["id"];
  return typeof id === "string" ? id : null;
}

function recordCipherState(cipher: Record<string, unknown>): "active" | "archived" | "deleted" {
  if (cipher["DeletedDate"] ?? cipher["deletedDate"]) return "deleted";
  if (cipher["ArchivedDate"] ?? cipher["archivedDate"]) return "archived";
  return "active";
}

function assertCreatedCipherProjection(
  requested: PersonalCipherCreateExpectation,
  item: VaultItem | undefined,
): void {
  if (!item || item.type !== requested.kind || item.name !== requested.name) {
    throw new Error("Live cipher create projection did not match");
  }
  switch (requested.kind) {
    case "login":
      if (!item.fields.some((field) =>
        field.id === "username" && field.value === requested.username)) {
        throw new Error("Live Login create projection did not match");
      }
      return;
    case "card":
      if (
        item.card?.brand !== requested.brand ||
        item.card.cardholderName !== requested.cardholderName
      ) {
        throw new Error("Live Card create projection did not match");
      }
      return;
    case "identity":
      if (
        item.identity?.firstName !== requested.firstName ||
        item.identity.title !== requested.title
      ) {
        throw new Error("Live Identity create projection did not match");
      }
      return;
    case "secure-note":
      if (
        item.secureNote?.type !== requested.noteType ||
        item.notes !== requested.notes
      ) {
        throw new Error("Live Secure Note create projection did not match");
      }
  }
}

function assertUpdatedCipherProjection(
  kind: VaultScenarioKind,
  item: VaultItem | undefined,
  expectedName: string,
): void {
  if (!item || item.name !== expectedName || !item.favorite || item.type !== kind) {
    throw new Error("Live cipher update projection did not match");
  }
  switch (kind) {
    case "login":
      if (
        !item.fields.some((field) => field.id === "username" && field.value === "synthetic-user-updated") ||
        !item.passwordHistory?.some((entry) => entry.password === "synthetic-password")
      ) {
        throw new Error("Live Login update projection did not match");
      }
      return;
    case "card":
      if (item.card?.brand !== "Mastercard") {
        throw new Error("Live Card update projection did not match");
      }
      return;
    case "identity":
      if (item.identity?.firstName !== "Grace") {
        throw new Error("Live Identity update projection did not match");
      }
      return;
    case "secure-note":
      if (item.notes !== "isolated mutation smoke updated") {
        throw new Error("Live Secure Note update projection did not match");
      }
  }
}

function scenarioLabel(kind: VaultScenarioKind): string {
  return kind === "secure-note"
    ? "Secure Note"
    : `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

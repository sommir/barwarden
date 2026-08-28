import {
  immutableAuthorizationMap,
  type ContextualCandidate,
} from "../autofill/autofill-fill-context.model";
import type { AutoFillVaultContextState } from "../autofill/autofill-vault-context.service";
import { PopupStateStore } from "../popup-state";

const candidates: readonly ContextualCandidate[] = Object.freeze([
  Object.freeze({
    cipherId: "mail",
    displayName: "Demo Mail",
    username: "demo-user@example.test",
    group: "exact" as const,
    reason: "service_identifier",
    availableFields: Object.freeze(["username", "password", "totp"] as const),
    authorizations: immutableAuthorizationMap([
      ["username", { contextToken: "readme-username", requiresMismatchConfirmation: false }],
      ["password", { contextToken: "readme-password", requiresMismatchConfirmation: false }],
      ["totp", { contextToken: "readme-totp", requiresMismatchConfirmation: false }],
    ]),
  }),
  Object.freeze({
    cipherId: "calendar",
    displayName: "Demo Calendar",
    username: "calendar-user@example.test",
    group: "relevant" as const,
    reason: "service_identifier",
    availableFields: Object.freeze(["username", "password"] as const),
    authorizations: immutableAuthorizationMap([
      ["username", { contextToken: "readme-calendar-username", requiresMismatchConfirmation: false }],
      ["password", { contextToken: "readme-calendar-password", requiresMismatchConfirmation: false }],
    ]),
  }),
]);

const state: AutoFillVaultContextState = Object.freeze({
  status: "ready" as const,
  epoch: 1,
  application: Object.freeze({
    bundleId: "com.example.DemoBrowser",
    appName: "Demo Browser",
  }),
  serviceIdentifiers: Object.freeze(["https://login.example.test"]),
  context: Object.freeze({
    bundleId: "com.example.DemoBrowser",
    appName: "Demo Browser",
    fillContextToken: "00000000-0000-4000-8000-000000000016",
    focusedField: Object.freeze({ kind: "username" as const, confidence: "high" as const }),
    action: Object.freeze({
      mode: "form" as const,
      fields: Object.freeze(["username", "password", "totp"] as const),
    }),
  }),
  session: Object.freeze({
    accountId: "evidence-user",
    generation: "00000000-0000-4000-8000-000000000017",
    vaultRevision: 16,
  }),
  candidates,
});

export function createReadmeDemoAutoFillContext(store: PopupStateStore) {
  const snapshot = store.snapshot();
  store.setItems(
    snapshot.items,
    snapshot.folders,
    snapshot.lastSyncDate ?? new Date("2026-08-28T00:00:00.000Z"),
    "evidence-user",
  );
  let selectedCipherId: string | null = null;
  return {
    snapshot: () => state,
    subscribe: () => () => undefined,
    beginFromEntry: async () => state,
    beginFromVaultOpen: async () => state,
    select: (cipherId: string) => {
      const candidate = candidates.find((value) => value.cipherId === cipherId) ?? null;
      selectedCipherId = candidate?.cipherId ?? null;
      return candidate;
    },
    selected: (cipherId: string) => selectedCipherId === cipherId
      ? {
          application: state.status === "ready" ? state.application : null,
          context: state.status === "ready" ? state.context : null,
          session: state.status === "ready" ? state.session : null,
          candidate: candidates.find((value) => value.cipherId === cipherId) ?? null,
        }
      : null,
    navigationChanged: () => undefined,
    invalidate: () => undefined,
  };
}

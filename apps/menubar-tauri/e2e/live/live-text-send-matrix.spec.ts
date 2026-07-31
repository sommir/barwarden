import { expect, test } from "@playwright/test";

import { BitwardenApiClient, FetchHttpTransport, type HttpTransport } from "../../src/bitwarden-api/bitwarden-api";
import { PopupStateStore } from "../../src/app/popup-state";
import {
  cloudInputNames,
  loginLiveServiceWithChallenge,
  livePasswordLoginAndSync,
  officialCloudEnvironment,
  requireLiveInputSet,
  selfHostedInputNames,
  selfHostedLiveEnvironment,
} from "./live-standard-password-login";
import {
  LiveTextSendTransportGuard,
  runTextSendScenario,
  type LiveTextSendDependencies,
} from "./live-text-send-scenarios";
import {
  liveTextSendFailureId,
  recordLiveGateFailure,
  recordLiveGateRows,
  type LiveGateFailureId,
} from "./m14-live-gate-result";
import {
  createLiveRunContext,
  resolveLiveServiceDisposition,
  type LiveServiceClass,
  type LiveStageResult,
} from "./live-test-protocol";

test.use({ screenshot: "off", trace: "off", video: "off" });
test.describe.configure({ mode: "serial", timeout: 180_000 });

for (const service of ["cloud-us", "cloud-eu", "self-hosted"] as const) {
  test(`runs or externally declares the ${service} Text Send mutation row`, async () => {
    const names = service === "self-hosted" ? selfHostedInputNames : cloudInputNames;
    const disposition = resolveLiveServiceDisposition(service, names, "mutation", process.env);
    if (disposition.status !== "ready") {
      recordLiveGateRows(externalTextSendRows(service, disposition));
      test.skip(true, disposition.reasonCode);
      return;
    }

    let loginDisposition;
    try {
      loginDisposition = await loginForService(service);
    } catch {
      failWithFixedIdentifier(liveTextSendFailureId(service, "text-send"));
    }
    if (loginDisposition.status !== "ready") {
      const blocked = { status: loginDisposition.status, reasonCode: loginDisposition.reasonCode } as const;
      recordLiveGateRows(externalTextSendRows(service, blocked));
      test.skip(true, loginDisposition.reasonCode);
      return;
    }
    let failureStage: "text-send" | "file-send-non-interference" = "text-send";
    try {
      const { session } = loginDisposition.login;
      const { dependencies, transport } = await mutationDependencies(service, session);
      const results = await runTextSendScenario(dependencies, (stage) => {
        failureStage = stage;
      });

      expect(results).toEqual([
        { service, mode: "mutation", stage: "text-send", status: "passed" },
        { service, mode: "mutation", stage: "file-send-non-interference", status: "passed" },
      ]);
      transport.assertNoFileSendEndpoint();
      recordLiveGateRows(results);
    } catch {
      failWithFixedIdentifier(liveTextSendFailureId(service, failureStage));
    }
  });
}

function externalTextSendRows(
  service: LiveServiceClass,
  disposition: Exclude<ReturnType<typeof resolveLiveServiceDisposition>, { status: "ready" }>,
): LiveStageResult[] {
  return ["text-send", "file-send-non-interference"].map((stage) => ({
    service,
    mode: "mutation",
    stage: stage as "text-send" | "file-send-non-interference",
    ...disposition,
  }));
}

function failWithFixedIdentifier(identifier: LiveGateFailureId): never {
  try {
    recordLiveGateFailure(identifier);
  } catch {
    // The controller will use its fixed fallback if the child artifact is unavailable.
  }
  throw new Error(identifier);
}

async function loginForService(service: LiveServiceClass) {
  if (service === "self-hosted") {
    const inputs = requireLiveInputSet(selfHostedInputNames);
    return loginLiveServiceWithChallenge(
      selfHostedLiveEnvironment(inputs.BARWARDEN_LIVE_SERVER_URL),
      inputs.BARWARDEN_LIVE_EMAIL,
      inputs.BARWARDEN_LIVE_PASSWORD,
      process.env,
    );
  }

  const inputs = requireLiveInputSet(cloudInputNames);
  const selected = inputs.BARWARDEN_LIVE_CLOUD_REGION.trim().toUpperCase() === "EU" ? "cloud-eu" : "cloud-us";
  if (selected !== service) throw new Error("Live cloud service selection drift");
  return loginLiveServiceWithChallenge(
    officialCloudEnvironment(inputs.BARWARDEN_LIVE_CLOUD_REGION),
    inputs.BARWARDEN_LIVE_CLOUD_EMAIL,
    inputs.BARWARDEN_LIVE_CLOUD_PASSWORD,
    process.env,
  );
}

async function mutationDependencies(
  service: LiveServiceClass,
  session: Awaited<ReturnType<typeof livePasswordLoginAndSync>>["session"],
): Promise<{ readonly dependencies: LiveTextSendDependencies; readonly transport: RecordingTextSendTransport }> {
  const runtime = await liveTextSendRuntime();
  const transport = new RecordingTextSendTransport();
  const api = new BitwardenApiClient(session.environment, transport);
  const actions = new runtime.BitwardenSendActions(session, transport);
  const store = new PopupStateStore();
  store.setActiveSession(session);
  store.setUnlocked("");
  const clipboard = new RecordingClipboard();
  const sync = new runtime.VaultSyncService({ getSync: (accessToken) => api.getSync(accessToken) });

  return {
    dependencies: {
      session,
      api,
      actions,
      store,
      operation: new runtime.TextSendOperation({
        store,
        actions,
        navigation: { currentUrl: () => "/tabs/send" },
      }),
      context: createLiveRunContext(service, "mutation"),
      linkBuilder: new runtime.SendLinkBuilder(store),
      clipboard,
      transportGuard: transport,
      syncProjection: () => sync.sync(session),
      assertGeneratedArtifactAbsence: () => transport.assertNoFileSendEndpoint(),
    },
    transport,
  };
}

async function liveTextSendRuntime() {
  const [actions, created, operation, sync] = await Promise.all([
    import("../../src/app/send/send-actions.service"),
    import("../../src/app/send/send-created-page.component"),
    import("../../src/app/send/text-send-operation"),
    import("../../src/vault/vault-sync.service"),
  ]);
  return {
    BitwardenSendActions: actions.BitwardenSendActions,
    SendLinkBuilder: created.SendLinkBuilder,
    TextSendOperation: operation.TextSendOperation,
    VaultSyncService: sync.VaultSyncService,
  };
}

class RecordingClipboard {
  private copies = 0;

  async copyText(_value: string): Promise<void> {
    this.copies += 1;
  }

  copyCallCount(): number {
    return this.copies;
  }
}

class RecordingTextSendTransport implements HttpTransport {
  private readonly transport = new FetchHttpTransport(30_000);
  private readonly guard = new LiveTextSendTransportGuard();
  private rejectedFileSendEndpoint = false;

  protectFileSendIds(ids: ReadonlySet<string>): void {
    this.guard.protectFileSendIds(ids);
  }

  async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    try {
      this.guard.assertAllowed(url, init);
    } catch {
      this.rejectedFileSendEndpoint = true;
      throw new Error("Live Text Send transport called a File Send endpoint");
    }
    return this.transport.fetchJson<T>(url, init);
  }

  assertNoFileSendEndpoint(): void {
    if (this.rejectedFileSendEndpoint) {
      throw new Error("Live Text Send transport called a File Send endpoint");
    }
  }
}

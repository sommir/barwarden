import { describe, expect, it, vi } from "vitest";

import { PopupStateStore } from "../popup-state";
import { AppFeedbackService } from "./app-feedback.service";
import {
  ACCESSIBILITY_PERMISSION_STATUS,
  AccessibilityPermissionDialogService,
} from "./accessibility-permission-dialog.service";
import { AppStatusFeedbackBridgeService } from "./app-status-feedback-bridge.service";

describe("AppStatusFeedbackBridgeService", () => {
  it("publishes success and failure status receipts through the one live feedback channel", async () => {
    const store = new PopupStateStore();
    const feedback = new AppFeedbackService();
    const bridge = new AppStatusFeedbackBridgeService(store, feedback);
    bridge.start();

    store.setStatus("Password copied");
    await Promise.resolve();
    expect(feedback.snapshot()).toMatchObject({
      kind: "success",
      message: "Password copied",
    });

    store.setStatus("无法复制，请重试。");
    await Promise.resolve();
    expect(feedback.snapshot()).toMatchObject({
      kind: "warning",
      message: "无法复制，请重试。",
    });

    bridge.destroy();
  });

  it("does not announce twice when an action already published the same receipt", async () => {
    const store = new PopupStateStore();
    const feedback = new AppFeedbackService();
    const bridge = new AppStatusFeedbackBridgeService(store, feedback);
    bridge.start();

    store.setStatus("Send deleted");
    const explicit = feedback.show("Send deleted", { kind: "success" });
    await Promise.resolve();

    expect(feedback.snapshot()?.id).toBe(explicit.id);
    bridge.destroy();
  });

  it("coalesces rapid status updates so stale receipts are never announced", async () => {
    const store = new PopupStateStore();
    const feedback = new AppFeedbackService();
    const bridge = new AppStatusFeedbackBridgeService(store, feedback);
    bridge.start();

    store.setStatus("First");
    store.setStatus("Second");
    await Promise.resolve();

    expect(feedback.snapshot()).toMatchObject({ message: "Second" });
    bridge.destroy();
  });

  it("publishes a fresh receipt for every repeated copy action with the same message", async () => {
    const store = new PopupStateStore();
    const feedback = new AppFeedbackService();
    const bridge = new AppStatusFeedbackBridgeService(store, feedback);
    bridge.start();

    store.setStatus("Password copied");
    await Promise.resolve();
    const firstId = feedback.snapshot()!.id;

    store.setStatus("Password copied");
    await Promise.resolve();

    expect(feedback.snapshot()).toMatchObject({
      id: firstId + 1,
      message: "Password copied",
    });
    bridge.destroy();
  });

  it("requests accessibility authorization instead of showing a paste warning toast", () => {
    const store = new PopupStateStore();
    const feedback = new AppFeedbackService();
    const permissionDialog = { present: vi.fn() } as unknown as AccessibilityPermissionDialogService;
    const bridge = new AppStatusFeedbackBridgeService(store, feedback, permissionDialog);
    bridge.start();

    store.setStatus(ACCESSIBILITY_PERMISSION_STATUS);

    expect(permissionDialog.present).toHaveBeenCalledOnce();
    expect(feedback.snapshot()).toBeNull();
    bridge.destroy();
  });
});

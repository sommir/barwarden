import { invoke } from "@tauri-apps/api/core";

export function captureNativeAutoFillProjectionBinding(accountId: string): Promise<unknown> {
  return invoke("autofill_capture_projection_binding", { accountId });
}

export function replaceNativeAutoFillProjection(input: unknown, bindingToken: string): Promise<void> {
  return invoke("autofill_replace_projection", { input, bindingToken });
}

export function clearNativeAutoFillProjection(accountId: string): Promise<void> {
  return invoke("autofill_clear_projection", { accountId });
}

export function lockNativeAutoFillProjection(): Promise<void> {
  return invoke("autofill_lock_projection");
}

export function resetNativeAutoFillProjectionForReprojection(): Promise<void> {
  return invoke("autofill_reset_projection_for_reprojection");
}

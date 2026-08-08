import { invoke } from "@tauri-apps/api/core";

export function replaceNativeAutoFillProjection(input: unknown): Promise<void> {
  return invoke("autofill_replace_projection", { input });
}

export function clearNativeAutoFillProjection(accountId: string): Promise<void> {
  return invoke("autofill_clear_projection", { accountId });
}

export function lockNativeAutoFillProjection(): Promise<void> {
  return invoke("autofill_lock_projection");
}

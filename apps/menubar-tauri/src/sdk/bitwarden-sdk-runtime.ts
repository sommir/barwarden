import {
  __wbg_set_wasm,
  init_sdk,
  PasswordManagerClient,
  PureCrypto,
} from "@bitwarden/sdk-internal/bitwarden_wasm_internal_bg.js";

export { init_sdk, PasswordManagerClient, PureCrypto };

export function init(wasm: WebAssembly.Exports | WebAssembly.Module): void {
  __wbg_set_wasm(wasm);
}

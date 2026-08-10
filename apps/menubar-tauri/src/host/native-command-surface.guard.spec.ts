import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const allowedCommands = [
  "autofill_accessibility_status",
  "autofill_agent_lock",
  "autofill_agent_probe",
  "autofill_agent_register",
  "autofill_agent_registration_status",
  "autofill_agent_session",
  "autofill_agent_status",
  "autofill_agent_unregister",
  "autofill_begin_reprompt",
  "autofill_begin_batch_reprompt",
  "autofill_biometric_reprompt",
  "autofill_cancel_reprompt",
  "autofill_cancel_batch_reprompt",
  "autofill_capture_projection_binding",
  "autofill_clear_projection",
  "autofill_entry_context",
  "autofill_fill_detected",
  "autofill_lock_projection",
  "autofill_query_candidates",
  "autofill_release_secret",
  "autofill_replace_projection",
  "autofill_reset_projection_for_reprojection",
  "autofill_request_accessibility_permission",
  "autofill_set_accessibility_fallback",
  "biometric_disable",
  "biometric_enable",
  "biometric_status",
  "biometric_unlock",
  "clear_global_shortcut",
  "copy_text",
  "get_account_lock_intents",
  "get_global_shortcut",
  "get_launch_at_login",
  "hide_popup",
  "http_fetch_json",
  "open_url",
  "paste_text",
  "popup_window_metrics",
  "pop_out",
  "secure_compare_and_swap",
  "secure_delete",
  "secure_get",
  "secure_get_or_create_uuid",
  "secure_set",
  "session_broker_attach",
  "session_broker_handoff",
  "session_broker_mutate",
  "session_broker_set_handoff",
  "session_broker_snapshot",
  "set_account_lock_intents",
  "set_popup_height",
  "set_global_shortcut",
  "set_launch_at_login",
  "show_popup",
].sort();

describe("native command surface", () => {
  it("matches the exact Plan A Rust and TypeScript allowlist", () => {
    const rust = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src-tauri/src/main.rs"),
      "utf8",
    );
    const host = [
      "autofill-projection.host.ts",
      "tauri-host.service.ts",
      "launch-at-login.ts",
    ].map((file) =>
      readFileSync(join(process.cwd(), "apps/menubar-tauri/src/host", file), "utf8"),
    ).join("\n");
    const handler = rust.match(/generate_handler!\[([\s\S]*?)\]/)?.[1] ?? "";
    const rustCommands = [...handler.matchAll(/\b\w+::(\w+)\s*,/g)]
      .map((match) => match[1])
      .sort();
    const hostCommands = [...new Set(
      [...host.matchAll(/(?:this\.)?invoke(?:Secure)?(?:<[^>]+>)?\(\s*"([a-z_]+)"/g)]
        .map((match) => match[1]),
    )].sort();

    expect(rustCommands).toEqual(allowedCommands);
    expect(hostCommands).toEqual(allowedCommands);
  });
});

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("native popup window contract", () => {
  it("stays a Dock-hidden menu-bar utility with its tray entry", () => {
    const infoPlist = join(
      process.cwd(),
      "apps/menubar-tauri/src-tauri/Info.plist",
    );
    const lsUiElement = execFileSync(
      "plutil",
      ["-extract", "LSUIElement", "raw", "-o", "-", infoPlist],
      { encoding: "utf8" },
    ).trim();
    const main = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src-tauri/src/main.rs"),
      "utf8",
    );

    expect(lsUiElement).toBe("true");
    expect(main).toContain(
      "app.set_activation_policy(tauri::ActivationPolicy::Accessory);",
    );
    expect(main).toContain("tray::setup_tray(app.handle())?;");
  });

  it("keeps the 480 by 600 main popup transparent, shadowed, and undecorated", () => {
    const config = JSON.parse(
      readFileSync(
        join(process.cwd(), "apps/menubar-tauri/src-tauri/tauri.conf.json"),
        "utf8",
      ),
    ) as {
      app: {
        windows: Array<Record<string, unknown>>;
      };
    };

    expect(config.app.windows.find((window) => window["label"] === "main")).toMatchObject({
      label: "main",
      width: 480,
      height: 600,
      minHeight: 600,
      transparent: true,
      shadow: true,
      decorations: false,
    });
  });

  it("clips the native AppKit content layer to the popup radius", () => {
    const main = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src-tauri/src/main.rs"),
      "utf8",
    );
    const source = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src-tauri/src/window.rs"),
      "utf8",
    );

    expect(main).toContain("window::configure_native_popup_window(app.handle())?;");
    expect(source).toContain("const POPUP_CORNER_RADIUS: f64 = 14.0;");
    expect(source).toContain("ns_window.setOpaque(false);");
    expect(source).toContain("ns_window.setBackgroundColor(Some(&NSColor::clearColor()));");
    expect(source).toContain("content_view.setWantsLayer(true);");
    expect(source).toContain("layer.setCornerRadius(POPUP_CORNER_RADIUS);");
    expect(source).toContain("layer.setMasksToBounds(true);");
    expect(source).toContain("ns_window.invalidateShadow();");
  });

  it("keeps native pop-out controls while hiding its title and shows the Dock only for its lifetime", () => {
    const source = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src-tauri/src/window.rs"),
      "utf8",
    );

    expect(source).toContain("const MAIN_WINDOW_LABEL: &str = \"main\";");
    expect(source).toContain("const POPOUT_WINDOW_LABEL: &str = \"popout\";");
    expect(source).toMatch(
      /WebviewWindowBuilder::new\([\s\S]*?POPOUT_WINDOW_LABEL[\s\S]*?\.decorations\(true\)[\s\S]*?\.title_bar_style\(tauri::TitleBarStyle::Overlay\)[\s\S]*?\.hidden_title\(true\)/,
    );
    expect(source).toContain("tauri::ActivationPolicy::Regular");
    expect(source).toContain("tauri::ActivationPolicy::Accessory");
    expect(source).toContain("WindowEvent::Destroyed");
  });

  it("keeps the popup visible while native keychain or Touch ID commands are pending", () => {
    const root = process.cwd();
    const main = readFileSync(join(root, "apps/menubar-tauri/src-tauri/src/main.rs"), "utf8");
    const keychain = readFileSync(join(root, "apps/menubar-tauri/src-tauri/src/keychain.rs"), "utf8");
    const biometric = readFileSync(join(root, "apps/menubar-tauri/src-tauri/src/biometric.rs"), "utf8");

    expect(main).toContain(".manage(window::PopupVisibilityHold::default())");
    const commandBody = (source: string, command: string) => {
      const start = source.indexOf(`pub async fn ${command}`);
      const end = source.indexOf("\n#[", start + 1);
      return source.slice(start, end === -1 ? undefined : end);
    };
    for (const command of [
      "secure_get",
      "secure_set",
      "secure_delete",
      "secure_compare_and_swap",
      "secure_get_or_create_uuid",
    ]) {
      expect(commandBody(keychain, command)).toContain("acquire()");
    }
    for (const command of ["biometric_enable", "biometric_unlock", "biometric_disable"]) {
      expect(commandBody(biometric, command)).toContain("acquire()");
    }
    expect(commandBody(biometric, "biometric_status")).not.toContain("acquire()");
  });

  it("grants the exact Rust popout builder label an IPC/event capability", () => {
    const source = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src-tauri/src/window.rs"),
      "utf8",
    );
    const capability = JSON.parse(
      readFileSync(
        join(process.cwd(), "apps/menubar-tauri/src-tauri/capabilities/default.json"),
        "utf8",
      ),
    ) as { windows: readonly string[]; permissions: readonly string[] };
    const popoutLabel = source.match(
      /const POPOUT_WINDOW_LABEL:\s*&str\s*=\s*"([^"]+)"/,
    )?.[1];

    expect(popoutLabel).toBe("popout");
    expect(capability.windows).toContain(popoutLabel);
    expect(capability.permissions).toContain("core:event:default");
  });
});

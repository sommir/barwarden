import { invoke } from "@tauri-apps/api/core";

export interface LaunchAtLoginHost {
  getLaunchAtLogin(): Promise<boolean>;
  setLaunchAtLogin(enabled: boolean): Promise<boolean>;
}

export interface NativeAutostartApi {
  isEnabled(): Promise<boolean>;
  enable(): Promise<void>;
  disable(): Promise<void>;
}

export const nativeAutostartApi: NativeAutostartApi = {
  isEnabled: () => invoke<boolean>("get_launch_at_login"),
  enable: async () => {
    await invoke<boolean>("set_launch_at_login", { enabled: true });
  },
  disable: async () => {
    await invoke<boolean>("set_launch_at_login", { enabled: false });
  },
};

export class LaunchAtLoginHostError extends Error {
  override readonly name = "LaunchAtLoginHostError";

  constructor() {
    super("Launch at login unavailable.");
  }
}

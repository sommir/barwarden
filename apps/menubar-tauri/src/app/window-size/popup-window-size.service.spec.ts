import { describe, expect, it } from "vitest";

import {
  parsePreferredHeight,
  PopupWindowSizeService,
  type PopupWindowSizeHost,
  type PopupWindowSizePlatform,
} from "./popup-window-size.service";

class FakeHost implements PopupWindowSizeHost {
  readonly requested: number[] = [];
  metrics = { currentHeight: 600, maximumHeight: 900 };

  getPopupWindowMetrics(): Promise<typeof this.metrics> {
    return Promise.resolve(this.metrics);
  }

  setPopupHeight(height: number): Promise<typeof this.metrics> {
    this.requested.push(height);
    this.metrics = { ...this.metrics, currentHeight: height };
    return Promise.resolve(this.metrics);
  }
}

class FakePlatform implements PopupWindowSizePlatform {
  height = 600;
  preference: string | null = null;
  listener: (() => void) | null = null;
  readonly writes: string[] = [];

  viewportHeight = () => this.height;
  onResize = (listener: () => void) => {
    this.listener = listener;
    return () => { this.listener = null; };
  };
  readPreference = () => this.preference;
  writePreference = (value: string) => { this.writes.push(value); };
  resize(height: number): void { this.height = height; this.listener?.(); }
}

describe("PopupWindowSizeService", () => {
  it("restores a valid remembered popup height", async () => {
    const host = new FakeHost();
    const platform = new FakePlatform();
    platform.preference = "720";
    const service = new PopupWindowSizeService(host, platform);

    await service.start();

    expect(host.requested).toEqual([720]);
  });

  it("remembers only user-driven window resizes and never route content", async () => {
    const host = new FakeHost();
    const platform = new FakePlatform();
    const service = new PopupWindowSizeService(host, platform);
    await service.start();

    platform.resize(744);

    expect(platform.writes).toEqual(["744"]);
    expect(host.requested).toEqual([]);
  });

  it("clamps restored and manually resized heights to native popup bounds", async () => {
    const host = new FakeHost();
    const platform = new FakePlatform();
    platform.preference = "1200";
    const service = new PopupWindowSizeService(host, platform);
    await service.start();
    platform.resize(1200);

    expect(host.requested).toEqual([900]);
    expect(platform.writes).toEqual(["900"]);
  });

  it("ignores invalid persisted height values", () => {
    expect(parsePreferredHeight(null)).toBeNull();
    expect(parsePreferredHeight("599")).toBeNull();
    expect(parsePreferredHeight("invalid")).toBeNull();
    expect(parsePreferredHeight("680")).toBe(680);
  });

  it("removes the native resize listener on destroy", async () => {
    const host = new FakeHost();
    const platform = new FakePlatform();
    const service = new PopupWindowSizeService(host, platform);
    await service.start();
    service.destroy();
    platform.resize(720);

    expect(platform.writes).toEqual([]);
  });
});

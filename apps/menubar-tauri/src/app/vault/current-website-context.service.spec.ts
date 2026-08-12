import { describe, expect, it } from "vitest";

import type {
  CapturedWebsiteContext,
  WebsiteContextHost,
} from "../../host/website-context";
import { CurrentWebsiteContextService } from "./current-website-context.service";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("CurrentWebsiteContextService", () => {
  it("keeps the newest refresh when an older native result resolves last", async () => {
    const first = deferred<CapturedWebsiteContext>();
    const second = deferred<CapturedWebsiteContext>();
    const queue = [first.promise, second.promise];
    const host: WebsiteContextHost = {
      capturedWebsiteContext: () => queue.shift()!,
    };
    const service = new CurrentWebsiteContextService(host);

    const older = service.refresh();
    const newer = service.refresh();
    second.resolve({
      status: "available",
      generation: 2,
      browserBundleId: "com.google.Chrome",
      url: "https://new.example.com/",
    });
    await newer;
    first.resolve({
      status: "available",
      generation: 1,
      browserBundleId: "com.google.Chrome",
      url: "https://old.example.com/",
    });
    await older;

    expect(service.url()).toBe("https://new.example.com/");
  });

  it("clears unavailable, failed, and in-flight contexts without logging private data", async () => {
    const pending = deferred<CapturedWebsiteContext>();
    const responses: Array<Promise<CapturedWebsiteContext>> = [
      Promise.resolve({
        status: "available",
        generation: 1,
        browserBundleId: "com.apple.Safari",
        url: "https://secret.example.com/",
      }),
      Promise.resolve({ status: "unavailable", generation: 2, reason: "no-active-tab" }),
      Promise.reject(new Error("private native detail")),
      pending.promise,
    ];
    const service = new CurrentWebsiteContextService({
      capturedWebsiteContext: () => responses.shift()!,
    });

    await service.refresh();
    expect(service.url()).toBe("https://secret.example.com/");
    await service.refresh();
    expect(service.url()).toBeNull();
    await service.refresh();
    expect(service.url()).toBeNull();
    const refresh = service.refresh();
    service.clear();
    pending.resolve({
      status: "available",
      generation: 4,
      browserBundleId: "com.apple.Safari",
      url: "https://late.example.com/",
    });
    await refresh;
    expect(service.url()).toBeNull();
  });
});

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  validatePinnedMemberTransforms,
  type PinnedMemberTransformContract,
} from "../../official-source-body-contract";
import { reconstructNewDeviceTemplate } from "./new-device-template-transform";
import { newDeviceMemberContract } from "./official-new-device-member-transforms";

const root = process.cwd();
const overlay = (path: string) => join(
  root,
  "apps/menubar-tauri/src/app/upstream-overlays/auth/new-device",
  path,
);

describe("official new-device source overlay", () => {
  const authoritySource = () => readFileSync(join(
    root,
    "vendor/bitwarden-clients/libs/auth/src/angular/new-device-verification/new-device-verification.component.ts",
  ), "utf8");
  it("derives submit and lifecycle members from pinned authority and exact statement transforms", () => {
    const runtime = readFileSync(overlay("official-new-device-verification.component.ts"), "utf8");

    expect(validatePinnedMemberTransforms(
      authoritySource(),
      runtime,
      newDeviceMemberContract,
    )).toEqual([]);
  });

  it("rejects submit and lifecycle body mutation without changing imports or member names", () => {
    const runtime = readFileSync(overlay("official-new-device-verification.component.ts"), "utf8");
    const mutatedSubmit = runtime.replace(
      "await this.transferRoute(outcome);",
      'this.store.setStatus("mutated");',
    );
    const mutatedDestroy = runtime.replace(
      "this.alive = false;\n    this.operationEpoch += 1;",
      "this.alive = true;\n    this.operationEpoch += 1;",
    );

    expect(validatePinnedMemberTransforms(
      authoritySource(),
      mutatedSubmit,
      newDeviceMemberContract,
    )).toContain("OfficialNewDeviceVerificationComponent.submit derived body mismatch");
    expect(validatePinnedMemberTransforms(
      authoritySource(),
      mutatedDestroy,
      newDeviceMemberContract,
    )).toContain("OfficialNewDeviceVerificationComponent.ngOnDestroy derived body mismatch");
  });

  it("rejects pinned authority drift and ambiguous member transforms", () => {
    const authority = authoritySource();
    const runtime = readFileSync(overlay("official-new-device-verification.component.ts"), "utf8");
    const drifted = authority.replace("this.destroy$.next();", "this.destroy$.complete();");
    const ambiguous: PinnedMemberTransformContract = {
      ...newDeviceMemberContract,
      transforms: [
        ...newDeviceMemberContract.transforms,
        { ...newDeviceMemberContract.transforms[3], runtimeMember: "ngOnInit" },
      ],
    };

    expect(validatePinnedMemberTransforms(
      drifted,
      runtime,
      newDeviceMemberContract,
    )).toEqual(["NewDeviceVerificationComponent pinned authority drift"]);
    expect(validatePinnedMemberTransforms(
      authority,
      runtime,
      ambiguous,
    )).toContain("NewDeviceVerificationComponent.submit transform is ambiguous");
  });
  it("reconstructs the local template exactly from pinned authority transforms", () => {
    const authority = readFileSync(join(
      root,
      "vendor/bitwarden-clients/libs/auth/src/angular/new-device-verification/new-device-verification.component.html",
    ), "utf8");
    const runtime = readFileSync(overlay("official-new-device-verification.component.html"), "utf8");

    expect(reconstructNewDeviceTemplate(authority)).toBe(runtime);
  });

  it("rejects authority mutation instead of accepting a rehashed local template", () => {
    const authority = readFileSync(join(
      root,
      "vendor/bitwarden-clients/libs/auth/src/angular/new-device-verification/new-device-verification.component.html",
    ), "utf8");
    const mutated = authority.replace('[disabled]="disableRequestOTP"', '[attr.aria-disabled]="disableRequestOTP"');

    expect(() => reconstructNewDeviceTemplate(mutated)).toThrow(
      "New-device authority drift: resend disabled input",
    );
  });

  it("pins the source-derived runtime and excludes secret-bearing official services", () => {
    const manifestPath = overlay("official-new-device-verification.transform-manifest.json");

    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      revision: string;
      authorities: readonly { path: string; sha256: string }[];
      localRuntimes: readonly { path: string; sha256: string }[];
      removed: readonly string[];
    };
    expect(manifest.revision).toBe("f47b6946e01aed474875789081966d311d5b8289");
    expect(manifest.authorities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "libs/auth/src/angular/new-device-verification/new-device-verification.component.ts",
      }),
      expect.objectContaining({
        path: "libs/auth/src/angular/new-device-verification/new-device-verification.component.html",
      }),
    ]));
    for (const runtime of manifest.localRuntimes) {
      const source = readFileSync(join(root, runtime.path), "utf8");
      expect(createHash("sha256").update(source).digest("hex")).toBe(runtime.sha256);
    }
    expect(manifest.removed).toEqual(expect.arrayContaining([
      "official ApiService and LoginStrategyService",
      "official AccountService and MasterPasswordService",
      "official LogService and error logging",
    ]));

    const runtime = readFileSync(overlay("official-new-device-verification.component.ts"), "utf8");
    for (const forbidden of [
      "ApiService",
      "LoginStrategyService",
      "AccountService",
      "MasterPasswordService",
      "LogService",
      "console.",
      "deviceIdentifier",
    ]) {
      expect(runtime).not.toContain(forbidden);
    }
    expect(runtime).toContain("OfficialNewDeviceAdapter");
  });
});

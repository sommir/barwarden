import "zone.js";
import "@angular/compiler";

import { firstValueFrom, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { OfficialEnvironmentAdapter } from "../../../auth/official-environment.adapter";
import { OfficialEnvironmentSelectorComponent } from "./official-environment-selector.component";

describe("OfficialEnvironmentSelectorComponent", () => {
  it("does not invalidate the login form while the self-hosted drawer is only being opened", () => {
    const environment = environmentAdapter();
    const component = new OfficialEnvironmentSelectorComponent(environment);
    const validity = vi.fn();
    component.environmentValidChange.subscribe(validity);

    component.toggle("SelfHosted");

    expect(validity).not.toHaveBeenCalled();
  });

  it("publishes a valid environment only after a cloud or self-hosted choice is committed", async () => {
    const environment = environmentAdapter();
    const component = new OfficialEnvironmentSelectorComponent(environment);
    const validity = vi.fn();
    component.environmentValidChange.subscribe(validity);

    component.toggle("EU");
    component.selectSelfHosted("https://vault.example.test");

    expect(validity).toHaveBeenNthCalledWith(1, true);
    expect(validity).toHaveBeenNthCalledWith(2, true);
    expect(environment.selectCloud).toHaveBeenCalledWith("EU");
    expect(environment.selectSelfHosted).toHaveBeenCalledWith("https://vault.example.test");
    await expect(firstValueFrom(component.selectedRegion$)).resolves.toBeUndefined();
  });

  it("prefills the self-hosted picker with the previously saved URL", () => {
    const environment = environmentAdapter();
    environment.lastSelfHostedServerUrl.mockReturnValue("https://vault.example.test");
    const component = new OfficialEnvironmentSelectorComponent(environment);
    const open = vi.fn();
    (component as unknown as { selfHostedDialog: { open: typeof open } }).selfHostedDialog = { open };

    component.toggle("SelfHosted", document.body);

    expect(open).toHaveBeenCalledWith(document.body, "https://vault.example.test", true);
  });
});

function environmentAdapter(): OfficialEnvironmentAdapter {
  return {
    selected$: of(undefined),
    currentEnvironment: vi.fn(() => ({ webVaultUrl: "https://vault.bitwarden.com" })),
    lastSelfHostedServerUrl: vi.fn(() => ""),
    selectCloud: vi.fn(),
    selectSelfHosted: vi.fn(),
  } as unknown as OfficialEnvironmentAdapter;
}

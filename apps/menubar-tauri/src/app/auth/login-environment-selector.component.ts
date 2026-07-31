import { Component, EventEmitter, Input, Output } from "@angular/core";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { I18nPipe } from "../official-ui/official-ui-common";

const US_SERVER_URL = "https://vault.bitwarden.com";
const EU_SERVER_URL = "https://vault.bitwarden.eu";
const HOSTNAME_WITH_PORT =
  /^(?:localhost|(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z\d](?:[a-z\d-]*[a-z\d])?):\d+(?:[/?#]|$)/i;

@Component({
  selector: "bw-login-environment-selector",
  standalone: true,
  imports: [I18nPipe],
  template: `
    <section class="official-login-environment" data-testid="environment-selector">
      <button
        class="official-login-environment-trigger"
        type="button"
        data-testid="environment-trigger"
        [attr.aria-expanded]="menuOpen"
        aria-controls="login-environment-menu"
        (click)="menuOpen = !menuOpen"
      >
        {{ "accessing" | i18n }}: {{ selectedLabel }} <i class="bwi bwi-angle-down" aria-hidden="true"></i>
      </button>
      @if (menuOpen) {
        <div id="login-environment-menu" class="official-login-environment-menu" role="menu">
          <button
            class="official-login-environment-option"
            type="button"
            role="menuitemradio"
            data-testid="environment-us"
            [attr.aria-checked]="isSelected(US_SERVER_URL)"
            (click)="selectHosted(US_SERVER_URL)"
          >
            <i class="bwi bwi-check official-login-environment-check" aria-hidden="true"></i>
            <span>vault.bitwarden.com</span>
          </button>
          <button
            class="official-login-environment-option"
            type="button"
            role="menuitemradio"
            data-testid="environment-eu"
            [attr.aria-checked]="isSelected(EU_SERVER_URL)"
            (click)="selectHosted(EU_SERVER_URL)"
          >
            <i class="bwi bwi-check official-login-environment-check" aria-hidden="true"></i>
            <span>vault.bitwarden.eu</span>
          </button>
          <button
            class="official-login-environment-option"
            type="button"
            role="menuitemradio"
            data-testid="environment-self-hosted"
            [attr.aria-checked]="isSelfHosted"
            (click)="selectSelfHosted()"
          >
            <i class="bwi bwi-check official-login-environment-check" aria-hidden="true"></i>
            <span>{{ "selfHostedEnvironment" | i18n }}</span>
          </button>
        </div>
      }
      @if (showSelfHostedInput) {
        <label class="official-login-self-hosted">
          <span>{{ "baseUrl" | i18n }}</span>
          <input
            type="url"
            inputmode="url"
            autocomplete="url"
            placeholder="https://server.example.com"
            data-testid="self-hosted-server-url"
            [value]="selfHostedServerUrl"
            (input)="onSelfHostedServerUrlInput($event)"
          />
        </label>
      }
    </section>
  `,
})
export class LoginEnvironmentSelectorComponent {
  readonly US_SERVER_URL = US_SERVER_URL;
  readonly EU_SERVER_URL = EU_SERVER_URL;

  @Input() serverUrl = US_SERVER_URL;
  @Output() serverUrlChange = new EventEmitter<string>();
  @Output() environmentValidChange = new EventEmitter<boolean>();

  menuOpen = false;
  showSelfHostedInput = false;
  selfHostedServerUrl = "";

  get isSelfHosted(): boolean {
    return this.showSelfHostedInput || !this.isHostedServer(this.serverUrl);
  }

  get selectedLabel(): string {
    if (this.serverUrl === EU_SERVER_URL) {
      return "vault.bitwarden.eu";
    }
    if (this.serverUrl === US_SERVER_URL) {
      return "vault.bitwarden.com";
    }
    return translateOfficialMessage("selfHostedEnvironment");
  }

  isSelected(serverUrl: string): boolean {
    return this.serverUrl === serverUrl;
  }

  selectHosted(serverUrl: string): void {
    this.serverUrl = serverUrl;
    this.showSelfHostedInput = false;
    this.menuOpen = false;
    this.serverUrlChange.emit(serverUrl);
    this.environmentValidChange.emit(true);
  }

  selectSelfHosted(): void {
    this.selfHostedServerUrl = this.isHostedServer(this.serverUrl) ? "" : this.serverUrl;
    this.serverUrl = "";
    this.showSelfHostedInput = true;
    this.menuOpen = false;
    this.environmentValidChange.emit(false);
  }

  onSelfHostedServerUrlInput(event: Event): void {
    this.selfHostedServerUrl = event.target instanceof HTMLInputElement ? event.target.value : "";
    const normalizedServerUrl = normalizeSelfHostedServerUrl(this.selfHostedServerUrl);
    if (!normalizedServerUrl) {
      this.environmentValidChange.emit(false);
      return;
    }

    this.serverUrl = normalizedServerUrl;
    this.serverUrlChange.emit(normalizedServerUrl);
    this.environmentValidChange.emit(true);
  }

  private isHostedServer(serverUrl: string): boolean {
    return serverUrl === US_SERVER_URL || serverUrl === EU_SERVER_URL;
  }
}

function normalizeSelfHostedServerUrl(serverUrl: string): string {
  const value = serverUrl.trim();
  if (!value) {
    return "";
  }

  const hasExplicitScheme = !HOSTNAME_WITH_PORT.test(value) && /^[a-z][a-z\d+.-]*:/i.test(value);
  if ((hasExplicitScheme && !/^https:\/\//i.test(value)) || (!hasExplicitScheme && value.includes("://"))) {
    return "";
  }

  const withProtocol = hasExplicitScheme ? value : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return "";
    }

    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

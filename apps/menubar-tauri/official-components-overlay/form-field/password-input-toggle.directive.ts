import {
  AfterContentInit,
  DestroyRef,
  Directive,
  EventEmitter,
  Host,
  HostBinding,
  HostListener,
  inject,
  model,
  OnChanges,
  Output,
  signal,
} from "@angular/core";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { BitIconButtonComponent } from "../icon-button/icon-button.component";

import { BitFormFieldComponent } from "./form-field.component";

@Directive({
  selector: "[bitPasswordInputToggle]",
  host: {
    "[attr.aria-pressed]": "toggled()",
  },
})
export class BitPasswordInputToggleDirective implements AfterContentInit, OnChanges {
  /**
   * Whether the input is toggled to show the password.
   */
  readonly toggled = model(false);
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-output-emitter-ref
  @Output() toggledChange = new EventEmitter<boolean>();

  @HostBinding("attr.title")
  get title(): string {
    this.locale();
    return this.i18nService.t(this.toggled() ? "hidePassword" : "showPassword");
  }

  @HostBinding("attr.aria-label")
  get label(): string {
    return this.title;
  }

  @HostBinding("attr.aria-description")
  get description(): string {
    this.locale();
    return this.i18nService.t("toggleVisibility");
  }

  private readonly i18nService = inject(I18nService);
  private readonly locale = signal("");
  private readonly localeSubscription = this.i18nService.locale$.subscribe((locale) => {
    this.locale.set(locale);
  });

  /**
   * Click handler to toggle the state of the input type.
   */
  @HostListener("click") onClick() {
    this.toggled.update((toggled) => !toggled);
    this.toggledChange.emit(this.toggled());

    this.update();
  }

  constructor(
    @Host() private button: BitIconButtonComponent,
    private formField: BitFormFieldComponent,
  ) {
    inject(DestroyRef).onDestroy(() => this.localeSubscription.unsubscribe());
  }

  get icon() {
    return this.toggled() ? "bwi-eye-slash" : "bwi-eye";
  }

  ngOnChanges(): void {
    this.update();
  }

  ngAfterContentInit(): void {
    const input = this.formField.input();
    if (input?.type) {
      this.toggled.set(input.type() !== "password");
    }
    this.button.icon.set(this.icon);
  }

  private update() {
    this.button.icon.set(this.icon);
    const input = this.formField.input();
    if (input?.type != null) {
      input.type.set(this.toggled() ? "text" : "password");
      input?.spellcheck?.set(this.toggled() ? false : undefined);
    }
  }
}

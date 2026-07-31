import { LiveAnnouncer } from "@angular/cdk/a11y";
import {
  CdkDragDrop,
  DragDropModule,
  moveItemInArray,
} from "@angular/cdk/drag-drop";
import { Component, OnInit, QueryList, ViewChildren } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";
import { Subject, switchMap, take } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { UriMatchStrategySetting } from "@bitwarden/common/models/domain/domain-service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LoginUriView } from "@bitwarden/common/vault/models/view/login-uri.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";
import { CardComponent } from "@bitwarden/components/card/card.component";
import { FormFieldModule } from "@bitwarden/components/form-field/form-field.module";
import { IconButtonModule } from "@bitwarden/components/icon-button/icon-button.module";
import { LinkModule } from "@bitwarden/components/link/link.module";
import { SectionHeaderComponent } from "@bitwarden/components/section/section-header.component";
import { TypographyModule } from "@bitwarden/components/typography/typography.module";

import { OfficialLoginFormContainer } from "./official-login-form-container";
import { OfficialUriOptionComponent } from "./official-uri-option.component";

interface UriField {
  uri: string;
  matchDetection: UriMatchStrategySetting;
}

@Component({
  selector: "vault-autofill-options",
  templateUrl: "./official-autofill-options.component.html",
  imports: [
    DragDropModule,
    SectionHeaderComponent,
    TypographyModule,
    JslibModule,
    CardComponent,
    ReactiveFormsModule,
    FormFieldModule,
    IconButtonModule,
    OfficialUriOptionComponent,
    LinkModule,
  ],
})
export class OfficialAutofillOptionsComponent implements OnInit {
  @ViewChildren(OfficialUriOptionComponent)
  protected uriOptions: QueryList<OfficialUriOptionComponent>;

  autofillOptionsForm = this.formBuilder.group({
    uris: this.formBuilder.array<UriField>([]),
  });

  protected get uriControls() {
    return this.autofillOptionsForm.controls.uris.controls;
  }

  protected get isPartialEdit() {
    return this.cipherFormContainer.config.mode === "partial-edit";
  }

  protected readonly defaultMatchDetection: UriMatchStrategySetting = null;

  private focusOnNewInput$ = new Subject<void>();

  constructor(
    private cipherFormContainer: OfficialLoginFormContainer,
    private formBuilder: FormBuilder,
    private i18nService: I18nService,
    private liveAnnouncer: LiveAnnouncer,
  ) {
    this.cipherFormContainer.registerChildForm(
      "autoFillOptions",
      this.autofillOptionsForm,
    );

    this.autofillOptionsForm.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => {
        this.cipherFormContainer.patchCipher((cipher) => {
          cipher.login.uris = value.uris?.map((uri: UriField) =>
            Object.assign(new LoginUriView(), {
              uri: uri.uri,
              match: uri.matchDetection,
            } as LoginUriView),
          );
          return cipher;
        });
      });

    this.focusOnNewInput$
      .pipe(
        takeUntilDestroyed(),
        switchMap(() => this.uriOptions.changes.pipe(take(1))),
        switchMap(() =>
          this.liveAnnouncer.announce(
            this.i18nService.t("websiteAdded"),
            "polite",
          ),
        ),
      )
      .subscribe(() => {
        this.uriOptions?.last?.focusInput();
      });

    this.cipherFormContainer.formStatusChange$
      .pipe(takeUntilDestroyed())
      .subscribe((status) => {
        if (status === "disabled") {
          this.autofillOptionsForm.disable({ emitEvent: false });
        } else if (!this.isPartialEdit) {
          this.autofillOptionsForm.enable({ emitEvent: false });
        }
      });
  }

  ngOnInit() {
    const prefillCipher = this.cipherFormContainer.getInitialCipherView();
    if (prefillCipher) {
      this.initFromExistingCipher(prefillCipher.login);
    } else {
      this.initNewCipher();
    }

    if (this.isPartialEdit) {
      this.autofillOptionsForm.disable();
    }
  }

  private initFromExistingCipher(existingLogin: LoginView) {
    existingLogin.uris?.forEach((uri) => {
      this.addUri(
        {
          uri: uri.uri,
          matchDetection: uri.match,
        },
        false,
        false,
      );
    });

    if (
      this.cipherFormContainer.config.initialValues?.loginUri &&
      !this.cipherFormContainer.initializedWithCachedCipher()
    ) {
      if (
        existingLogin.uris?.findIndex(
          (uri) =>
            uri.uri === this.cipherFormContainer.config.initialValues.loginUri,
        ) === -1
      ) {
        this.addUri({
          uri: this.cipherFormContainer.config.initialValues.loginUri,
          matchDetection: null,
        });
      }
    }
  }

  private initNewCipher() {
    this.addUri({
      uri: this.cipherFormContainer.config.initialValues?.loginUri ?? null,
      matchDetection: null,
    });
  }

  addUri(
    uriFieldValue: UriField = { uri: null, matchDetection: null },
    focusNewInput = false,
    emitEvent = true,
  ) {
    this.autofillOptionsForm.controls.uris.push(
      this.formBuilder.control(uriFieldValue),
      {
        emitEvent,
      },
    );

    if (focusNewInput) {
      this.focusOnNewInput$.next();
    }
  }

  removeUri(i: number) {
    this.autofillOptionsForm.controls.uris.removeAt(i);
  }

  private updateUriFields() {
    this.cipherFormContainer.patchCipher((cipher) => {
      cipher.login.uris = this.uriControls.map(
        (control) =>
          Object.assign(new LoginUriView(), {
            uri: control.value.uri,
            match: control.value.matchDetection ?? null,
          }) as LoginUriView,
      );
      return cipher;
    });
  }

  onUriItemDrop(event: CdkDragDrop<HTMLDivElement>) {
    moveItemInArray(this.uriControls, event.previousIndex, event.currentIndex);
    this.updateUriFields();
  }

  async onUriItemKeydown(event: KeyboardEvent, index: number) {
    if (event.key === "ArrowUp" && index !== 0) {
      await this.reorderUriItems(event, index, "Up");
    }

    if (event.key === "ArrowDown" && index !== this.uriControls.length - 1) {
      await this.reorderUriItems(event, index, "Down");
    }
  }

  async reorderUriItems(
    event: KeyboardEvent,
    previousIndex: number,
    direction: "Up" | "Down",
  ) {
    const currentIndex = previousIndex + (direction === "Up" ? -1 : 1);
    event.preventDefault();
    await this.liveAnnouncer.announce(
      this.i18nService.t(
        `reorderField${direction}`,
        this.i18nService.t("websiteUri"),
        currentIndex + 1,
        this.uriControls.length,
      ),
      "assertive",
    );
    moveItemInArray(this.uriControls, previousIndex, currentIndex);
    this.updateUriFields();
    requestAnimationFrame(() => {
      (event.target as HTMLButtonElement).focus();
    });
  }
}

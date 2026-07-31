import { CommonModule } from "@angular/common";
import { Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from "@angular/core";
import { BehaviorSubject, map, ReplaySubject, Subject, switchMap, takeUntil } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import type { Account } from "@bitwarden/common/auth/abstractions/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import {
  ColorPasswordComponent,
  IconButtonModule,
  ItemModule,
  NoItemsModule,
} from "@bitwarden/components";
import {
  AlgorithmsByType,
  type CredentialAlgorithm,
  CredentialGeneratorService,
} from "@bitwarden/generator-core";
import { GeneratedCredential, GeneratorHistoryService } from "@bitwarden/generator-history";

import { OfficialGeneratorHistoryViewAdapter } from "../../generator/official-generator-history-view.adapter";
import {
  beginLocalCopyFeedback,
  completeLocalCopyFeedback,
} from "../../official-ui/local-copy-feedback-event";
import { translate } from "../../generator/official-generator-translate.adapter";

@Component({
  selector: "bit-credential-generator-history",
  templateUrl: "./official-generator-history-rows.component.html",
  imports: [
    CommonModule,
    ColorPasswordComponent,
    IconButtonModule,
    NoItemsModule,
    JslibModule,
    ItemModule,
  ],
})
export class OfficialGeneratorHistoryRowsComponent implements OnChanges, OnInit, OnDestroy {
  private readonly destroyed = new Subject<void>();
  protected readonly credentials$ = new BehaviorSubject<GeneratedCredential[]>([]);

  constructor(
    private generatorService: CredentialGeneratorService,
    private history: GeneratorHistoryService,
    private i18nService: I18nService,
    private historyView: OfficialGeneratorHistoryViewAdapter,
  ) {}

  @Input({ required: true }) account!: Account;
  protected account$ = new ReplaySubject<Account>(1);

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    const account = changes?.["account"];
    if (account?.previousValue?.id !== account?.currentValue?.id) {
      this.account$.next(account.currentValue ?? this.account);
    }
  }

  ngOnInit(): void {
    this.account$
      .pipe(
        switchMap((account) => this.history.credentials$(account.id)),
        map((credentials) => credentials.filter((credential) => credential.credential !== "")),
        takeUntil(this.destroyed),
      )
      .subscribe(this.credentials$);
  }

  protected getCopyText(credential: GeneratedCredential) {
    const info = this.generatorService.algorithm(this.algorithmId(credential));
    return translate(info.i18nKeys.copyCredential, this.i18nService);
  }

  protected getGeneratedValueText(credential: GeneratedCredential) {
    const info = this.generatorService.algorithm(this.algorithmId(credential));
    return translate(info.i18nKeys.credentialType, this.i18nService);
  }

  protected async copy(
    credential: GeneratedCredential,
    target: EventTarget | null,
  ): Promise<void> {
    const receipt = target instanceof HTMLButtonElement
      ? beginLocalCopyFeedback(target)
      : null;
    const copied = await this.historyView.copy(credential);
    if (target instanceof HTMLButtonElement && target.isConnected) {
      completeLocalCopyFeedback(receipt, !copied);
    }
  }

  private algorithmId(credential: GeneratedCredential): CredentialAlgorithm {
    if (credential.algorithm) {
      return credential.algorithm as CredentialAlgorithm;
    }
    const [id] = AlgorithmsByType[credential.category];
    return id;
  }

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
  }
}

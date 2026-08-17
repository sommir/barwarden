import { CommonModule } from "@angular/common";
import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
} from "@angular/core";
import { firstValueFrom, map, ReplaySubject, Subject, takeUntil } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import type { Account } from "@bitwarden/common/auth/abstractions/account.service";
import { ButtonModule } from "@bitwarden/components";

import { PopOutComponent } from "@bitwarden/browser-popup/components/pop-out.component";
import { PopupFooterComponent } from "@bitwarden/browser-popup/layout/popup-footer.component";
import { PopupHeaderComponent } from "@bitwarden/browser-popup/layout/popup-header.component";
import { PopupPageComponent } from "@bitwarden/browser-popup/layout/popup-page.component";
import { OfficialGeneratorAccountAdapter } from "../../generator/official-generator-account.adapter";
import { OfficialGeneratorHistoryViewAdapter } from "../../generator/official-generator-history-view.adapter";
import { AppBottomSheetComponent } from "../../official-ui/app-bottom-sheet.component";
import { MacosAlertStripComponent } from "../../official-ui/macos-alert-strip.component";
import { OfficialEmptyGeneratorHistoryComponent } from "./official-empty-generator-history.component";
import { OfficialGeneratorHistoryRowsComponent } from "./official-generator-history-rows.component";

@Component({
  selector: "bw-official-generator-history",
  templateUrl: "./official-generator-history.component.html",
  imports: [
    AppBottomSheetComponent,
    ButtonModule,
    CommonModule,
    JslibModule,
    MacosAlertStripComponent,
    PopOutComponent,
    PopupHeaderComponent,
    PopupPageComponent,
    OfficialGeneratorHistoryRowsComponent,
    OfficialEmptyGeneratorHistoryComponent,
    PopupFooterComponent,
  ],
})
export class OfficialGeneratorHistoryComponent implements OnInit, OnDestroy {
  private readonly destroyed = new Subject<void>();
  protected readonly hasHistory$ = new ReplaySubject<boolean>(1);
  protected readonly account$ = new ReplaySubject<Account>(1);
  protected readonly loading$ = this.history.loading.asObservable();
  protected readonly clearing$ = this.history.clearing.asObservable();
  readonly statusMessage$ = this.history.statusMessage.asObservable();
  protected confirming = false;

  @ViewChild("clearDialog") private clearDialog?: AppBottomSheetComponent;
  @ViewChild("clearTrigger", { read: ElementRef })
  private clearTrigger?: ElementRef<HTMLButtonElement>;
  @ViewChild("clearCancel", { read: ElementRef })
  private clearCancel?: ElementRef<HTMLButtonElement>;

  constructor(
    private accountService: OfficialGeneratorAccountAdapter,
    private history: OfficialGeneratorHistoryViewAdapter,
  ) {}

  async ngOnInit(): Promise<void> {
    const account = await firstValueFrom(this.accountService.activeAccount$);
    this.account$.next(account);
    this.history.credentials$(account.id)
      .pipe(
        map((credentials) => credentials.length > 0),
        takeUntil(this.destroyed),
      )
      .subscribe(this.hasHistory$);
  }

  clear = async (): Promise<void> => {
    const sheet = this.clearDialog;
    if (!sheet || sheet.nativeElement.open || this.history.loading.value || this.history.clearing.value) {
      return;
    }
    if (this.history.credentials.value.length === 0) {
      return;
    }

    this.history.statusMessage.next(null);
    sheet.open(this.clearTrigger?.nativeElement, this.clearCancel?.nativeElement);
  };

  cancelClear(): void {
    if (!this.history.clearing.value) {
      this.closeDialog(true);
    }
  }

  async confirmClear(): Promise<void> {
    if (this.confirming || this.history.clearing.value || this.history.credentials.value.length === 0) {
      return;
    }
    this.confirming = true;
    try {
      const account = await firstValueFrom(this.account$);
      await this.history.clear(account.id);
      this.closeDialog(true);
    } finally {
      this.confirming = false;
    }
  }

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
    this.history.destroy();
  }

  private closeDialog(restoreFocus: boolean): void {
    this.clearDialog?.close(restoreFocus);
  }
}

import {
  DialogRef as CdkDialogRef,
  DIALOG_DATA,
  type DialogCloseOptions,
} from "@angular/cdk/dialog";
import { type ComponentType } from "@angular/cdk/overlay";
import { NgComponentOutlet } from "@angular/common";
import {
  Component,
  effect,
  inject,
  Injectable,
  Injector,
  signal,
  TemplateRef,
  ViewChild,
} from "@angular/core";
import { firstValueFrom, map, Observable, Subject } from "rxjs";

import {
  type DialogConfig,
  type DialogCloseRef,
  DialogRef,
} from "@bitwarden/components/dialog/dialog-ref";
import { SimpleConfigurableDialogComponent } from "@bitwarden/components/dialog/simple-dialog/simple-configurable-dialog/simple-configurable-dialog.component";
import type { SimpleDialogOptions } from "@bitwarden/components/dialog/simple-dialog/types";

import { AppBottomSheetComponent } from "./app-bottom-sheet.component";

interface AppBottomSheetDialogRequest {
  readonly id: symbol;
  readonly component: ComponentType<any>;
  readonly injector: Injector;
  readonly ref: AppBottomSheetDialogRef<any, any>;
  readonly trigger: HTMLElement | null;
  readonly closing: boolean;
  readonly restoreFocus: boolean;
  readonly initialFocus: "default" | "cancel";
  readonly result?: any;
}

class AppBottomSheetDialogRef<R = unknown, C = unknown> implements DialogRef<R, C> {
  readonly isDrawer = false;
  readonly closed: Observable<R | undefined>;
  disableClose: boolean | undefined;
  closePredicate?: (result?: R) => Promise<boolean>;
  componentInstance: C | null = null;

  private readonly closedSubject = new Subject<R | undefined>();
  private settled = false;
  private closing = false;

  constructor(
    private readonly requestClose: (
      ref: AppBottomSheetDialogRef<R, C>,
      result: R | undefined,
      restoreFocus: boolean,
    ) => void,
    config?: DialogConfig<unknown, R>,
  ) {
    this.closed = this.closedSubject.asObservable();
    this.disableClose = config?.disableClose;
    this.closePredicate = config?.closePredicate;
  }

  async close(
    result?: R,
    _options?: DialogCloseOptions,
  ): Promise<DialogCloseRef> {
    if (this.settled || this.closing) {
      return { closed: false };
    }
    if (this.closePredicate && !(await this.closePredicate(result))) {
      return { closed: false };
    }
    this.closing = true;
    this.requestClose(this, result, true);
    return { closed: true };
  }

  requestForcedClose(restoreFocus: boolean): void {
    if (this.settled || this.closing) {
      return;
    }
    this.closing = true;
    this.requestClose(this, undefined, restoreFocus);
  }

  settle(result?: R): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.closedSubject.next(result);
    this.closedSubject.complete();
  }
}

@Injectable({ providedIn: "root" })
export class AppBottomSheetDialogService {
  private readonly parentInjector = inject(Injector);
  private readonly currentRequest = signal<AppBottomSheetDialogRequest | null>(null);

  readonly requests = () => {
    const request = this.currentRequest();
    return request ? [request] : [];
  };

  open<R = unknown, D = unknown, C = unknown>(
    componentOrTemplateRef: ComponentType<C> | TemplateRef<C>,
    config?: DialogConfig<D, R>,
    initialFocus: "default" | "cancel" = "default",
  ): DialogRef<R, C> {
    if (componentOrTemplateRef instanceof TemplateRef) {
      throw new Error("Application bottom sheets require a component dialog body.");
    }

    const previous = this.currentRequest();
    if (previous) {
      previous.ref.settle();
    }

    const ref = new AppBottomSheetDialogRef<R, C>(
      (closingRef, result, restoreFocus) =>
        this.requestClose(closingRef, result, restoreFocus),
      config,
    );
    const injector = Injector.create({
      providers: [
        { provide: DIALOG_DATA, useValue: config?.data },
        { provide: DialogRef, useValue: ref },
        { provide: CdkDialogRef, useValue: ref },
      ],
      parent: this.parentInjector,
    });
    this.currentRequest.set({
      id: Symbol("app-bottom-sheet-dialog"),
      component: componentOrTemplateRef,
      injector,
      ref,
      trigger: activeHTMLElement(),
      closing: false,
      restoreFocus: config?.restoreFocus !== false,
      initialFocus,
    });
    return ref;
  }

  openSimpleDialog(options: SimpleDialogOptions): Promise<boolean> {
    const ref = this.open<boolean, SimpleDialogOptions>(
      SimpleConfigurableDialogComponent,
      {
        data: options,
        disableClose: options.disableClose,
      },
      simpleDialogInitialFocus(options),
    );
    return firstValueFrom(ref.closed.pipe(map((result) => Boolean(result))));
  }

  openSimpleDialogRef(options: SimpleDialogOptions): DialogRef<boolean> {
    return this.open<boolean, SimpleDialogOptions>(
      SimpleConfigurableDialogComponent,
      {
        data: options,
        disableClose: options.disableClose,
      },
      simpleDialogInitialFocus(options),
    );
  }

  closeAll(): void {
    this.currentRequest()?.ref.requestForcedClose(false);
  }

  dismiss(ref: AppBottomSheetDialogRef): void {
    if (ref.disableClose) {
      return;
    }
    void ref.close();
  }

  sheetClosed(ref: AppBottomSheetDialogRef): void {
    const request = this.currentRequest();
    if (!request || request.ref !== ref) {
      return;
    }
    ref.settle(request.result);
    this.currentRequest.set(null);
  }

  private requestClose<R, C>(
    ref: AppBottomSheetDialogRef<R, C>,
    result: R | undefined,
    restoreFocus: boolean,
  ): void {
    const request = this.currentRequest();
    if (!request || request.ref !== ref) {
      ref.settle(result);
      return;
    }
    this.currentRequest.set({
      ...request,
      closing: true,
      restoreFocus,
      result,
    });
  }
}

@Component({
  selector: "bw-app-bottom-sheet-dialog-host",
  standalone: true,
  imports: [AppBottomSheetComponent, NgComponentOutlet],
  template: `
    @for (request of service.requests(); track request.id) {
      <bw-app-bottom-sheet
        #sheet
        [disableClose]="request.ref.disableClose ?? false"
        (dismissed)="service.dismiss(request.ref)"
        (closed)="service.sheetClosed(request.ref)"
      >
        <ng-container
          *ngComponentOutlet="request.component; injector: request.injector"
        />
      </bw-app-bottom-sheet>
    }
  `,
})
export class AppBottomSheetDialogHostComponent {
  private sheet?: AppBottomSheetComponent;

  @ViewChild("sheet")
  set activeSheet(sheet: AppBottomSheetComponent | undefined) {
    this.sheet = sheet;
    const request = this.service.requests()[0];
    if (!sheet || !request) {
      return;
    }
    sheet.prepareOpen(request.trigger);
    if (request.closing) {
      return;
    }
    queueMicrotask(() => {
      if (
        this.service.requests()[0] === request
        && !request.closing
        && !sheet.nativeElement.open
      ) {
        sheet.open(request.trigger);
        window.setTimeout(() => {
          if (
            request.initialFocus === "cancel"
            && this.service.requests()[0] === request
            && sheet.nativeElement.open
          ) {
            safeInitialFocus(sheet.nativeElement)?.focus();
          }
        });
      }
    });
  }

  constructor(readonly service: AppBottomSheetDialogService) {
    effect(() => {
      const request = this.service.requests()[0];
      if (!request?.closing) {
        return;
      }
      window.setTimeout(() => {
        if (this.service.requests()[0] === request) {
          this.sheet?.close(request.restoreFocus);
        }
      });
    });
  }
}

function activeHTMLElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function simpleDialogInitialFocus(options: SimpleDialogOptions): "default" | "cancel" {
  return options.type === "danger" ? "cancel" : "default";
}

function safeInitialFocus(dialog: HTMLDialogElement): HTMLElement | null {
  return dialog.querySelector<HTMLElement>('button[type="button"]:not([disabled])');
}

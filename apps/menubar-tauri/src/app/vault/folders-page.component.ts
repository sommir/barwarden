import { Component, Inject, inject, Optional, ViewChild } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { Router } from "@angular/router";

import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";

import { TauriHostService } from "../../host/tauri-host.service";
import { POP_OUT_HOST, type PopOutHost } from "../popup-header-actions.component";
import { PopupStateStore } from "../popup-state";
import { OfficialFoldersComponent } from "../upstream-overlays/recovery/folders/official-folders.component";
import type { VaultFolder } from "./vault-item.model";
import { VaultFolderDialogComponent } from "./vault-folder-dialog.component";
import { PopupRouterCacheService } from "../platform/popup-router-cache.service";

@Component({
  selector: "bw-folders-page",
  host: { class: "macos-page macos-page--secondary macos-page--vault-recovery" },
  standalone: true,
  imports: [OfficialFoldersComponent, VaultFolderDialogComponent],
  template: `
    <bw-official-folders
      class="macos-page macos-page--vault-recovery"
      [folders]="folders"
      (addFolder)="openFolderDialog()"
      (back)="back()"
      (editFolder)="openFolderDialog($event)"
      (popOut)="popOut()"
    />
    <bw-vault-folder-dialog />
  `,
})
export class FoldersPageComponent {
  @ViewChild(VaultFolderDialogComponent) private folderDialog?: VaultFolderDialogComponent;

  private readonly store = inject(PopupStateStore);
  private readonly state = toSignal(this.store.state$, { initialValue: this.store.snapshot() });
  private readonly popOutHost: PopOutHost;
  private foldersCache?: {
    readonly source: ReturnType<PopupStateStore["snapshot"]>["folders"];
    readonly result: readonly FolderView[];
  };

  constructor(
    private readonly router: Router,
    private readonly routeCache: PopupRouterCacheService,
    @Optional() @Inject(POP_OUT_HOST) popOutHost: PopOutHost | null = null,
  ) {
    this.popOutHost = popOutHost ?? new TauriHostService();
  }

  get folders(): readonly FolderView[] {
    const source = this.state().folders;
    if (this.foldersCache?.source === source) {
      return this.foldersCache.result;
    }

    const result = source.map((folder) => FolderView.fromJSON(
      { id: folder.id, name: folder.name } as Parameters<typeof FolderView.fromJSON>[0],
    ));
    this.foldersCache = { source, result };
    return result;
  }

  openFolderDialog(folder?: FolderView): void {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.folderDialog?.openFor(folder ? fromFolderView(folder) : undefined, trigger);
  }

  async back(): Promise<void> {
    await this.routeCache.back();
  }

  async popOut(): Promise<void> {
    await this.popOutHost.popOut(this.router.url);
  }
}

function fromFolderView(folder: FolderView): VaultFolder {
  return { id: folder.id, name: folder.name };
}

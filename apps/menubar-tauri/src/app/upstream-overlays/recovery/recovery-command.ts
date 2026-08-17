import type { RetainedPopupCipherView } from "../../vault/popup-cipher-view.adapter";

export type RecoveryLocation = "archive" | "trash";
export type RecoveryCommand =
  | "view"
  | "edit"
  | "clone"
  | "unarchive"
  | "soft-delete"
  | "restore"
  | "permanent-delete";

export interface RecoveryPageCommand {
  readonly command: RecoveryCommand;
  readonly location: RecoveryLocation;
  readonly item: RetainedPopupCipherView;
  readonly trigger?: HTMLElement;
}

export interface RecoveryPageActionResult {
  readonly terminal: boolean;
  readonly status: string;
}

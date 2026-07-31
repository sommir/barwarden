export type SendItemType = "text" | "file";

export interface SendItem {
  readonly id: string;
  readonly accessId: string;
  readonly urlB64Key?: string;
  readonly type: SendItemType;
  readonly name: string;
  readonly text?: string;
  readonly hidden?: boolean;
  readonly hideEmail?: boolean;
  readonly notes: string;
  readonly revisionDate: string;
  readonly deletionDate: string;
  readonly disabled: boolean;
  readonly maxAccessCount?: number;
  readonly accessCount: number;
  readonly password?: string;
  readonly hasPassword?: boolean;
}

export function sendItemTypeLabel(type: SendItemType): string {
  return type === "text"
    ? translateOfficialMessage("i18nTextSend")
    : translateOfficialMessage("i18nItem");
}
import { translateOfficialMessage } from "../official-ui/official-i18n.service";

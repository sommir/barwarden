import type { PopupState } from "../popup-state";
import type { VaultItem } from "../vault-demo";
import type { VaultItemType } from "./vault-item.model";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";

export type VaultHierarchyNodeId =
  | "favorites"
  | "all-items"
  | "types"
  | "folders"
  | "unfiled"
  | "hidden";

export interface VaultHierarchyChild {
  readonly id: string;
  readonly title: string;
  readonly icon: string;
  readonly count: number;
  readonly items?: readonly VaultItem[];
  readonly route?: "/archive" | "/trash";
}

export interface VaultHierarchyNode {
  readonly id: VaultHierarchyNodeId;
  readonly title: string;
  readonly count: number;
  readonly items?: readonly VaultItem[];
  readonly children?: readonly VaultHierarchyChild[];
}

const retainedTypes: readonly {
  readonly type: Exclude<VaultItemType, "ssh-key">;
  readonly titleKey: string;
  readonly icon: string;
}[] = [
  { type: "login", titleKey: "typeLogin", icon: "bwi-globe" },
  { type: "card", titleKey: "typeCard", icon: "bwi-credit-card" },
  { type: "identity", titleKey: "typeIdentity", icon: "bwi-id-card" },
  { type: "secure-note", titleKey: "i18nSecureNote", icon: "bwi-sticky-note" },
];

export function buildVaultHierarchy(
  state: Pick<PopupState, "items" | "folders" | "archivedItems" | "deletedItems">,
): readonly VaultHierarchyNode[] {
  const activeItems = state.items.filter((item) => item.type !== "ssh-key");
  const favorites = activeItems.filter((item) => item.favorite);
  const unfiled = activeItems.filter((item) => item.folderId.length === 0);

  return [
    {
      id: "favorites",
      title: translateOfficialMessage("favorites"),
      count: favorites.length,
      items: favorites,
    },
    {
      id: "all-items",
      title: translateOfficialMessage("i18nAllItems"),
      count: activeItems.length,
      items: activeItems,
    },
    {
      id: "types",
      title: translateOfficialMessage("type"),
      count: retainedTypes.length,
      children: retainedTypes.map(({ type, titleKey, icon }) => {
        const items = activeItems.filter((item) => item.type === type);
        return {
          id: `type:${type}`,
          title: translateOfficialMessage(titleKey),
          icon,
          count: items.length,
          items,
        };
      }),
    },
    {
      id: "folders",
      title: translateOfficialMessage("folders"),
      count: state.folders.length,
      children: state.folders.map((folder) => {
        const items = activeItems.filter((item) => item.folderId === folder.id);
        return {
          id: `folder:${folder.id}`,
          title: folder.name,
          icon: "bwi-folder",
          count: items.length,
          items,
        };
      }),
    },
    {
      id: "unfiled",
      title: translateOfficialMessage("i18nNoFolder"),
      count: unfiled.length,
      items: unfiled,
    },
    {
      id: "hidden",
      title: translateOfficialMessage("i18nHiddenItems"),
      count: state.archivedItems.length + state.deletedItems.length,
      children: [
        {
          id: "archive",
          title: translateOfficialMessage("archive"),
          icon: "bwi-archive",
          count: state.archivedItems.length,
          route: "/archive",
        },
        {
          id: "trash",
          title: translateOfficialMessage("trash"),
          icon: "bwi-trash",
          count: state.deletedItems.length,
          route: "/trash",
        },
      ],
    },
  ];
}

import type { VaultItem, VaultItemType } from "./vault-item.model";

export interface VaultFilter {
  readonly query: string;
  readonly folderId: string;
  readonly type: VaultItemType | "";
}

export function filterVaultItems(
  items: readonly VaultItem[],
  filter: VaultFilter,
): readonly VaultItem[] {
  const normalizedQuery = filter.query.trim().toLocaleLowerCase();

  return items.filter((item) => {
    if (filter.folderId && item.folderId !== filter.folderId) {
      return false;
    }

    if (filter.type && item.type !== filter.type) {
      return false;
    }

    return normalizedQuery.length === 0 || searchableText(item).includes(normalizedQuery);
  });
}

function searchableText(item: VaultItem): string {
  return [
    item.name,
    item.subtitle,
    item.folderName,
    item.organizationName,
    item.uri,
    item.notes,
    ...item.uris.map((uri) => uri.uri),
    ...item.fields.flatMap((field) => (field.concealed ? [field.label] : [field.label, field.value])),
  ]
    .join(" ")
    .toLocaleLowerCase();
}

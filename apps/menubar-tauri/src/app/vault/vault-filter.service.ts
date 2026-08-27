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
  const compactQuery = compactSearchText(normalizedQuery);

  return items.filter((item) => {
    if (filter.folderId && item.folderId !== filter.folderId) {
      return false;
    }

    if (filter.type && item.type !== filter.type) {
      return false;
    }

    if (normalizedQuery.length === 0) {
      return true;
    }

    const text = searchableText(item);
    return text.includes(normalizedQuery) ||
      (compactQuery.length > 0 && compactSearchText(text).includes(compactQuery));
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

function compactSearchText(value: string): string {
  return value.replace(/[\s._-]+/gu, "");
}

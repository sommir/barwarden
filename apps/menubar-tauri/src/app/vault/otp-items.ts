import type { VaultField, VaultItem } from "../vault-demo";

export interface OtpEntry {
  readonly item: VaultItem;
  readonly field: VaultField;
}

export function buildOtpEntries(
  items: readonly VaultItem[],
  query: string,
): readonly OtpEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return items.flatMap((item) => {
    if (item.type !== "login") {
      return [];
    }

    const field = item.fields.find((candidate) =>
      candidate.id === "otp" &&
      candidate.type === "totp" &&
      candidate.value.trim().length > 0
    );
    if (!field) {
      return [];
    }

    const publicMetadata = [
      item.name,
      item.subtitle,
      item.uri,
      ...item.uris.map((uri) => uri.uri),
    ].join(" ").toLocaleLowerCase();

    return normalizedQuery && !publicMetadata.includes(normalizedQuery)
      ? []
      : [{ item, field }];
  });
}

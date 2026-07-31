export type LoginCustomFieldType = "text" | "hidden" | "boolean";

export interface LoginDraftInput {
  readonly name: string;
  readonly username: string;
  readonly password: string;
  readonly totp: string;
  readonly uris: readonly { readonly uri: string; readonly matchType: string }[];
  readonly fields: readonly {
    readonly name: string;
    readonly value: string | boolean;
    readonly type: LoginCustomFieldType;
  }[];
  readonly notes: string;
  readonly favorite: boolean;
  readonly folderId: string;
  readonly reprompt: boolean;
}

const FIELD_TYPES: Record<LoginCustomFieldType, 0 | 1 | 2> = {
  text: 0,
  hidden: 1,
  boolean: 2,
};

export function hasRequiredLoginName(name: string): boolean {
  return name.trim().length > 0;
}

export function normalizeLoginDraft(input: LoginDraftInput) {
  const uris = input.uris
    .map((entry) => ({ uri: entry.uri.trim(), matchType: entry.matchType || "default" }))
    .filter((entry) => entry.uri.length > 0);
  const fields = input.fields
    .map((field) => ({
      name: field.name.trim(),
      value: field.type === "boolean" ? String(field.value === true || field.value === "true") : String(field.value),
      type: FIELD_TYPES[field.type],
    }))
    .filter((field) => field.name.length > 0 || field.value.length > 0);

  return {
    name: input.name.trim(),
    username: input.username.trim(),
    password: input.password,
    totp: input.totp.trim(),
    uri: uris[0]?.uri ?? "",
    uris,
    fields,
    notes: input.notes.trim(),
    favorite: input.favorite,
    folderId: input.folderId.trim(),
    reprompt: input.reprompt,
  };
}

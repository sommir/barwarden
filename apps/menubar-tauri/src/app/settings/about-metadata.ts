import { BARWARDEN_BRAND } from "../brand";

export const aboutMetadata = Object.freeze({
  productName: BARWARDEN_BRAND.productName,
  license: "GPL-3.0-only",
  officialProduct: false,
  upstreamRevision: "f47b6946e01aed474875789081966d311d5b8289",
  sourceUrl: "https://github.com/bitwarden/clients/tree/f47b6946e01aed474875789081966d311d5b8289",
} as const);

export const aboutVersion = __BARWARDEN_VERSION__;

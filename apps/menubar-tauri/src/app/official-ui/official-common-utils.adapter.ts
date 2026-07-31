export class Utils {
  static isMobileBrowser = false;

  static regexpEmojiPresentation = /\p{Emoji_Presentation}/gu;

  static isNullOrWhitespace(value: string | null | undefined): boolean {
    return value == null || typeof value !== "string" || value.trim() === "";
  }

  static isPromise(value: unknown): value is Promise<unknown> {
    return (
      value != undefined &&
      typeof (value as { then?: unknown }).then === "function" &&
      typeof (value as { catch?: unknown }).catch === "function"
    );
  }

  static pickTextColorBasedOnBgColor(
    backgroundColor: string,
    threshold = 186,
    svgTextFill = false,
  ): string {
    const hex = backgroundColor.charAt(0) === "#" ? backgroundColor.substring(1, 7) : backgroundColor;
    const red = Number.parseInt(hex.substring(0, 2), 16);
    const green = Number.parseInt(hex.substring(2, 4), 16);
    const blue = Number.parseInt(hex.substring(4, 6), 16);
    const suffix = svgTextFill ? "" : " !important";

    return red * 0.299 + green * 0.587 + blue * 0.114 > threshold
      ? `black${suffix}`
      : `white${suffix}`;
  }
}

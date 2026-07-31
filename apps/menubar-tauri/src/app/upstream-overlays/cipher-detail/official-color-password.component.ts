import {
  Component,
  computed,
  HostBinding,
  HostListener,
  input,
} from "@angular/core";

import { Utils } from "@bitwarden/common/platform/misc/utils";

type CharacterType = "letter" | "emoji" | "special" | "number";

/** Guarded transform of the pinned color-password display without clipboard ownership. */
@Component({
  selector: "bit-color-password",
  standalone: true,
  template: `@for (character of passwordCharArray(); track $index; let i = $index) {
    <span [class]="getCharacterClass(character)" class="tw-font-mono" data-password-character>
      <span>{{ character }}</span>
      @if (showCount()) {
        <span class="tw-whitespace-nowrap tw-text-xs tw-leading-5 tw-text-main">{{ i + 1 }}</span>
      }
    </span>
  }`,
})
export class OfficialColorPasswordComponent {
  readonly password = input<string>("");
  readonly showCount = input<boolean>(false);
  readonly passwordCharArray = computed(() => Array.from(this.password() ?? ""));

  readonly characterStyles: Record<CharacterType, string[]> = {
    emoji: [],
    letter: ["tw-text-main"],
    special: ["tw-text-danger"],
    number: ["tw-text-primary-600"],
  };

  @HostBinding("class")
  get classList(): string[] {
    return ["tw-min-w-0", "tw-whitespace-pre-wrap", "tw-break-words"];
  }

  getCharacterClass(character: string): string[] {
    const classes = this.characterStyles[this.getCharacterType(character)];
    return this.showCount()
      ? classes.concat([
        "tw-inline-flex",
        "tw-flex-col",
        "tw-items-center",
        "tw-w-7",
        "tw-py-1",
        "odd:tw-bg-secondary-100",
        "even:tw-bg-background",
      ])
      : classes;
  }

  @HostListener("copy", ["$event"])
  blockBrowserCopy(event: ClipboardEvent): void {
    event.preventDefault();
  }

  private getCharacterType(character: string): CharacterType {
    if (character.match(Utils.regexpEmojiPresentation)) {
      return "emoji";
    }
    if (character.match(/\d/)) {
      return "number";
    }
    if (["&", "<", ">", " "].includes(character) || character.match(/[^\w ]/)) {
      return "special";
    }
    return "letter";
  }
}

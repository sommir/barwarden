import {
  AfterViewInit,
  Directive,
  ElementRef,
  HostListener,
  Input,
  NgModule,
  OnInit,
  Renderer2,
} from "@angular/core";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { AutofocusDirective } from "@bitwarden/components/input/autofocus.directive";
import { I18nPipe } from "@bitwarden/ui-common";

import { OfficialI18nService } from "../../official-ui/official-i18n.service";

/** Direct retained behavior from the pinned InputVerbatimDirective. */
@Directive({ selector: "[appInputVerbatim]", standalone: true })
export class InputVerbatimDirective implements OnInit, AfterViewInit {
  @Input() set appInputVerbatim(condition: boolean | string) {
    this.disableComplete = condition === "" || condition === true;
  }

  private disableComplete = false;

  constructor(
    private readonly element: ElementRef<HTMLElement>,
    private readonly renderer: Renderer2,
  ) {}

  ngOnInit(): void {
    this.applyVerbatimAttributes();
  }

  ngAfterViewInit(): void {
    this.applyVerbatimAttributes();
  }

  private applyVerbatimAttributes(): void {
    const input = this.element.nativeElement;
    if (this.disableComplete && !input.hasAttribute("autocomplete")) {
      this.renderer.setAttribute(input, "autocomplete", "off");
    }
    if (!input.hasAttribute("autocapitalize")) {
      this.renderer.setAttribute(input, "autocapitalize", "none");
    }
    if (!input.hasAttribute("autocorrect")) {
      this.renderer.setAttribute(input, "autocorrect", "none");
    }
    if (!input.hasAttribute("spellcheck")) {
      this.renderer.setAttribute(input, "spellcheck", "false");
    }
    if (!input.hasAttribute("inputmode")) {
      this.renderer.setAttribute(input, "inputmode", "verbatim");
    }
  }
}

/** Direct retained behavior from the pinned StopClickDirective. */
@Directive({ selector: "[appStopClick]", standalone: true })
export class StopClickDirective {
  @HostListener("click", ["$event"])
  onClick(event: MouseEvent): void {
    event.preventDefault();
  }
}

@NgModule({
  imports: [I18nPipe, AutofocusDirective, InputVerbatimDirective, StopClickDirective],
  exports: [I18nPipe, AutofocusDirective, InputVerbatimDirective, StopClickDirective],
  providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
})
export class JslibModule {}

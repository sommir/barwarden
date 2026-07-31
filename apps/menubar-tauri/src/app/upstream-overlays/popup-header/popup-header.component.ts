// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { BooleanInput, coerceBooleanProperty } from "@angular/cdk/coercion";
import { CommonModule } from "@angular/common";
import { Component, Input, inject } from "@angular/core";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import {
  AsyncActionsModule,
  FunctionReturningAwaitable,
  IconButtonModule,
  TypographyModule,
} from "@bitwarden/components";

import { PopupRouterCacheService } from "./popup-router-cache.adapter";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "popup-header",
  templateUrl: "popup-header.component.html",
  imports: [TypographyModule, CommonModule, IconButtonModule, JslibModule, AsyncActionsModule],
})
export class PopupHeaderComponent {
  private popupRouterCacheService = inject(PopupRouterCacheService);

  /**
   * Compatibility input for retained callers. It no longer changes the in-flow page heading.
   * Remove it once upstream overlay transforms no longer emit background bindings.
   */
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input()
  background: "default" | "alt" = "default";

  /** Display the back button, which uses Location.back() to go back one page in history */
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input()
  get showBackButton() {
    return this._showBackButton;
  }
  set showBackButton(value: BooleanInput) {
    this._showBackButton = coerceBooleanProperty(value);
  }

  private _showBackButton = false;

  /** Title string that will be inserted as an h1 */
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input({ required: true }) pageTitle: string;

  /**
   * Async action that occurs when clicking the back button
   *
   * If unset, will call `location.back()`
   **/
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input()
  backAction: FunctionReturningAwaitable = async () => {
    return this.popupRouterCacheService.back();
  };
}

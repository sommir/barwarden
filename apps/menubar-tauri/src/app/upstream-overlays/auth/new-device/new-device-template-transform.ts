export function reconstructNewDeviceTemplate(authority: string): string {
  let result = authority;
  result = replaceExact(
    result,
    '<form [formGroup]="formGroup" [bitSubmit]="submit">',
    '<form [formGroup]="formGroup" [bitSubmit]="submit" class="macos-auth-card">',
    "auth card",
  );
  result = replaceExact(
    result,
    '<bit-form-field class="!tw-mb-1">',
    '<bit-form-field class="!tw-mb-1 macos-field macos-field-owner">',
    "semantic verification field",
  );
  result = replaceExact(
    result,
    "      bitInput\n",
    '      bitInput\n      class="macos-control-visible"\n',
    "visible verification control",
  );
  result = replaceExact(
    result,
    "      appInputVerbatim\n",
    '      autocomplete="one-time-code"\n',
    "verification-code autocomplete",
  );
  result = replaceExact(
    result,
    "  </bit-form-field>\n\n",
    '  </bit-form-field>\n\n  <div class="macos-auth-validation">\n    <bit-callout *ngIf="loginError" type="danger" data-testid="new-device-error">\n      <p bitTypography="body1" role="alert">{{ loginError }}</p>\n    </bit-callout>\n  </div>\n\n',
    "fixed announced error",
  );
  result = replaceExact(
    result,
    `  <button
    bitLink
    type="button"
    linkType="primary"
    (click)="resendOTP()"
    [disabled]="disableRequestOTP"
    class="tw-text-sm"
  >`,
    `  <div class="macos-auth-alternatives">
    <button
      bitLink
      type="button"
      linkType="primary"
      data-testid="new-device-resend"
      (click)="resendOTP()"
      [disabled]="disableRequestOTP"
      class="tw-text-sm macos-auth-alternative macos-hit-target macos-pressable"
    >`,
    "resend disabled input",
  );
  result = replaceExact(
    result,
    `    {{ "resendCode" | i18n }}
  </button>`,
    `      {{ "resendCode" | i18n }}
    </button>
  </div>`,
    "resend alternative group",
  );
  result = replaceExact(
    result,
    `    <button
      bitButton
      bitFormButton
      buttonType="primary"
      type="submit"
      [block]="true"
      [disabled]="formGroup.invalid"
    >`,
    `    <button
      bitButton
      bitFormButton
      buttonType="primary"
      class="macos-primary-action macos-button-owner"
      type="submit"
      [block]="true"
      data-testid="new-device-continue"
      [disabled]="formGroup.invalid || store.snapshot().isLoggingIn || disableRequestOTP"
    >`,
    "causal submit disabled input",
  );
  return replaceExact(
    result,
    `

    @if (showBackButton) {
      <div class="tw-text-center">{{ "or" | i18n }}</div>

      <button type="button" bitButton block buttonType="secondary" (click)="goBack()">
        {{ "back" | i18n }}
      </button>
    }`,
    "",
    "shared header back ownership",
  );
}

function replaceExact(source: string, search: string, replacement: string, label: string): string {
  if (source.split(search).length - 1 !== 1) {
    throw new Error(`New-device authority drift: ${label}`);
  }
  return source.replace(search, replacement);
}

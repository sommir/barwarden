import "zone.js";
import "@angular/compiler";

import { describe, expect, it } from "vitest";

import { OfficialAddEditCustomFieldDialogComponent } from "./official-add-edit-custom-field-dialog.component";
import { OfficialAdditionalOptionsComponent } from "./official-additional-options.component";
import { OfficialPersonalAddEditCustomFieldDialogComponent } from "./official-personal-add-edit-custom-field-dialog.component";
import { OfficialPersonalAdditionalOptionsComponent } from "./official-personal-additional-options.component";

type AngularComponentType = {
  readonly ɵcmp: { readonly id: string };
};

describe("retained cipher form component identities", () => {
  it("keeps login and personal overlay component IDs distinct", () => {
    expect(componentId(OfficialAddEditCustomFieldDialogComponent)).not.toBe(
      componentId(OfficialPersonalAddEditCustomFieldDialogComponent),
    );
    expect(componentId(OfficialAdditionalOptionsComponent)).not.toBe(
      componentId(OfficialPersonalAdditionalOptionsComponent),
    );
  });
});

function componentId(component: unknown): string {
  return (component as AngularComponentType).ɵcmp.id;
}

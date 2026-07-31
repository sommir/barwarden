import type { Provider } from "@angular/core";
import { of } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AvatarService } from "@bitwarden/common/auth/abstractions/avatar.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";

export function officialCurrentAccountTestProviders(
  email = "user@example.com",
): Provider[] {
  return [
    {
      provide: AccountService,
      useValue: {
        activeAccount$: of({
          id: "test-account",
          email,
          name: email,
          emailVerified: true,
          creationDate: undefined,
        }),
      },
    },
    { provide: AvatarService, useValue: { avatarColor$: of("#175DDC") } },
    {
      provide: AuthService,
      useValue: { activeAccountStatus$: of(AuthenticationStatus.Unlocked) },
    },
  ];
}

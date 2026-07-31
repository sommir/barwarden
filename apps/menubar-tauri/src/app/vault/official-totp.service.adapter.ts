import { Inject, Injectable, InjectionToken } from "@angular/core";
import { TotpService } from "@bitwarden/common/vault/abstractions/totp.service";
import { catchError, EMPTY, from, map, switchMap, timer } from "rxjs";

import { generateTotpCode } from "./totp.service";

export const OFFICIAL_TOTP_CLOCK = new InjectionToken<() => number>("OFFICIAL_TOTP_CLOCK", {
  providedIn: "root",
  factory: () => () => Date.now() / 1_000,
});

@Injectable()
export class OfficialTotpServiceAdapter extends TotpService {
  constructor(@Inject(OFFICIAL_TOTP_CLOCK) private readonly clock: () => number) {
    super();
  }

  override getCode$(key: string) {
    return timer(0, 1_000).pipe(
      switchMap(() => from(generateTotpCode(key, Math.floor(this.clock())))),
      map(({ code, period }) => ({ code, period })),
      catchError(() => EMPTY),
    );
  }
}

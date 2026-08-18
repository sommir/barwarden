import { Injectable, signal } from "@angular/core";

@Injectable({ providedIn: "root" })
export class OtpFacade {
  readonly query = signal("");

  setSearch(value: string | null | undefined): void {
    this.query.set(value ?? "");
  }

  resetSearch(): void {
    this.query.set("");
  }
}

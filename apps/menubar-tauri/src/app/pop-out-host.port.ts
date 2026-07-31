import { InjectionToken } from "@angular/core";

export interface PopOutHost {
  popOut(route: string): Promise<void>;
}

export const POP_OUT_HOST = new InjectionToken<PopOutHost | null>("POP_OUT_HOST", {
  providedIn: "root",
  factory: () => null,
});

import { Injectable } from "@angular/core";
import { Observable, of } from "rxjs";

import type { CredentialType } from "@bitwarden/generator-core";

@Injectable()
export class OfficialGeneratorHistoryAdapter {
  readonly track = async (
    _userId: string,
    _credential: string,
    _category: CredentialType,
    _date?: Date,
    _algorithm?: string,
  ): Promise<null> => null;

  readonly take = async (): Promise<null> => null;
  readonly clear = async (): Promise<[]> => [];
  readonly credentials$ = (): Observable<[]> => of([]);
}

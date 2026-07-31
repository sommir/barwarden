import { Injectable } from "@angular/core";

import { LogService } from "@bitwarden/common/platform/abstractions/log.service";

/** Generator logging sink that never serializes generated credentials. */
@Injectable()
export class OfficialGeneratorLogAdapter extends LogService {
  error(_message: unknown): void {}
}

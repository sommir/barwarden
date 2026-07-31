export class AccountSessionMutationCancelledError extends Error {
  override readonly name = "AccountSessionMutationCancelledError";

  constructor() {
    super("Account session mutation cancelled");
  }
}

export class AccountSessionReplacementConsistencyError extends Error {
  override readonly name = "AccountSessionReplacementConsistencyError";

  constructor() {
    super("Unable to safely replace account session");
  }
}

export class AccountSessionSaveConsistencyError extends Error {
  override readonly name = "AccountSessionSaveConsistencyError";

  constructor() {
    super("Unable to safely save account session");
  }
}

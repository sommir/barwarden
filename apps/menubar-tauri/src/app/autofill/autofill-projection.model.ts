export interface AutoFillProjectionUri {
  readonly uri: string;
  readonly matchType: string;
}

export interface AutoFillProjectionLogin {
  readonly cipherId: string;
  readonly name: string;
  readonly username: string;
  readonly password: string;
  readonly uris: readonly AutoFillProjectionUri[];
  readonly totp: string;
  readonly favorite: boolean;
  readonly reprompt: boolean;
}

export interface AutoFillProjectionInput {
  readonly accountId: string;
  readonly createdAt: string;
  readonly logins: readonly AutoFillProjectionLogin[];
}

export interface AutoFillProjectionBinding {
  readonly token: string;
  readonly accountId: string;
}

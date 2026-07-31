export enum LogLevel {
  Debug,
  Info,
  Warning,
  Error,
}

export abstract class LogService {
  abstract error(message: unknown): void;
}

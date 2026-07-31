import type { Observable } from "rxjs";

export const GENERATOR_DISK = Object.freeze({
  name: "generator",
  defaultStorageLocation: "disk",
});

export interface StateUpdateOptions<T, TCombine> {
  readonly combineLatestWith?: Observable<TCombine>;
}

export interface KeyDefinition<T> {
  readonly fullName: string;
  readonly stateDefinition: { readonly defaultStorageLocation: unknown };
}

export interface GlobalState<T> {
  readonly state$: Observable<T | null>;
  update<TCombine>(
    configureState: (state: T | null, dependency: TCombine) => T | null,
    options?: Partial<StateUpdateOptions<T, TCombine>>,
  ): Promise<T | null>;
}

export interface GlobalStateProvider {
  get<T>(keyDefinition: KeyDefinition<T>): GlobalState<T>;
}

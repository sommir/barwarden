export type WindowLayoutMode = "popup" | "popout";

export function resolveWindowLayoutMode(search: string): WindowLayoutMode {
  const values = new URLSearchParams(search).getAll("uilocation");
  return values.length === 1 && values[0] === "popout" ? "popout" : "popup";
}

export function markWindowLayout(
  root: HTMLElement,
  search: string,
): WindowLayoutMode {
  const mode = resolveWindowLayoutMode(search);
  root.dataset["bwWindow"] = mode;
  return mode;
}

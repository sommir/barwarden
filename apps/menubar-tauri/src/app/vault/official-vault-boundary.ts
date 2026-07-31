export class AddEditFolderDialogComponent {
  static open(dialogService: unknown): void {
    if (!isRetainedFolderDialogService(dialogService)) {
      throw new Error("The retained folder dialog host is unavailable.");
    }
    dialogService.openFolderDialog();
  }
}

function isRetainedFolderDialogService(
  value: unknown,
): value is { openFolderDialog(): void } {
  return (
    typeof value === "object" &&
    value !== null &&
    "openFolderDialog" in value &&
    typeof value.openFolderDialog === "function"
  );
}

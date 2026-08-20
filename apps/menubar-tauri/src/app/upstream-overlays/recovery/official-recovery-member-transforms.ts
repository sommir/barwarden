export const officialRecoveryMemberTransforms = {
  colorPassword: {
    authority: "libs/components/src/color-password/color-password.component.ts",
    retainedMembers: ["password", "showCount", "passwordCharArray", "characterStyles", "classList", "getCharacterClass", "getCharacterType"],
    changedMembers: ["clipboard ownership removed", "copy event blocked"],
  },
  passwordHistory: {
    authority: "libs/vault/src/components/password-history-view/password-history-view.component.ts",
    retainedMembers: ["cipher", "history", "ngOnInit"],
    changedMembers: [
      "copyPassword output",
      "formatDate fallback",
      "iOS27 semantic row/action roles",
      "collision-free password row/content ownership",
    ],
  },
  folders: {
    authority: "apps/browser/src/vault/popup/settings/folders.component.ts",
    retainedMembers: ["folders$", "NoFoldersIcon", "openAddEditFolderDialog"],
    changedMembers: [
      "folders input",
      "addFolder/editFolder outputs",
      "native pop-out output",
      "iOS27 semantic row/action roles",
      "non-truncating ItemContent ownership",
    ],
  },
  addEditFolderDialog: {
    authority: "libs/vault/src/components/add-edit-folder-dialog/add-edit-folder-dialog.component.ts",
    retainedMembers: ["folder", "variant", "folderForm", "submit", "deleteFolder", "title"],
    changedMembers: ["native dialog lifecycle", "fixed error input", "PM32380_BtnTextAddCreate=false:newFolder"],
  },
  archive: {
    authority: "apps/browser/src/vault/popup/settings/archive.component.ts",
    retainedMembers: ["archivedCiphers$", "view", "edit", "delete", "unarchive", "clone"],
    changedMembers: [
      "immutable personal retained inputs",
      "typed recovery command output",
      "iOS27 semantic row/action roles",
      "premium, organization, collection, attachment, passkey, SSH, and decryption-failure branches removed",
    ],
  },
  archiveUtilities: {
    authority: "libs/vault/src/services/archive-cipher-utilities.service.ts",
    retainedMembers: ["archiveCipher", "unarchiveCipher"],
    changedMembers: ["server-first typed VaultActionsService outcomes", "route-owned reprompt and confirmation"],
  },
  trash: {
    authority: "apps/browser/src/vault/popup/settings/trash.component.ts",
    retainedMembers: ["deletedCiphers$", "emptyTrashIcon"],
    changedMembers: [
      "immutable personal retained inputs",
      "typed recovery command output",
      "trashWarning retained from pinned zh_CN localization authority",
    ],
  },
  trashList: {
    authority: "apps/browser/src/vault/popup/settings/trash-list-items-container/trash-list-items-container.component.ts",
    retainedMembers: ["ciphers", "headerText", "restore", "delete", "onViewCipher"],
    changedMembers: [
      "local personal restore permission",
      "typed recovery command output",
      "iOS27 semantic row/action roles",
      "organization, collection, attachment, decryption-failure, passkey, and SSH branches removed",
    ],
  },
} as const;

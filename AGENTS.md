# Barwarden Workspace Instructions

## Local macOS Installation

- Use `npm run install:macos-local` to build and replace `/Applications/Barwarden.app`.
- Do not install a plain `tauri build` artifact. The stable installer assembles the main app, AutoFill credential provider, helper agent, launch agent, and matching catalogs.
- Run `npm run test:install:macos-local` and `npm run install:macos-local -- --preflight` before a full install.
- Keep all machine-specific packaging configuration outside the repository. Never add local paths or private values to source, documentation, tests, or generated artifacts.
- Treat `BARWARDEN_LOCAL_INSTALL_PASS` as the install result, then independently run `codesign --verify --deep --strict --verbose=4 /Applications/Barwarden.app` after the installer process exits.
- Confirm `com.sommir.barwarden.autofill-agent` is running and its `agent-v1.sock` Unix socket exists before reporting success.

## UI Focus Verification

- Inputs and select controls keep their neutral border while focused and use one external blue focus ring.
- Menu items use one internal blue focus ring so overlay clipping cannot cut it off.
- Do not restore the upstream black inset focus shadow or a second blue border.
- Run the focused visual regression suite before packaging:
  `npm test -- --run apps/menubar-tauri/src/app/official-ui/ios27-production-accessibility.visual.spec.ts apps/menubar-tauri/src/app/settings/p1-pages.spec.ts apps/menubar-tauri/src/app/official-ui/ios27-shared-primitives.visual.spec.ts`

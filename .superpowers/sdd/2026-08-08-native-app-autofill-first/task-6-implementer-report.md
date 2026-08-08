# Task 6 implementer report — macOS system AutoFill

## Outcome

Task 6 implements the macOS 13+ AuthenticationServices credential-provider surface and the Agent-only secret-release path.

- The identity publisher performs full replace-after-sync publication, deduplicates service identities, replaces rather than merges on account switch, removes all identities on logout, and preserves only safe identity metadata while locked. It publishes active Login items only as `ASPasswordCredentialIdentity(serviceIdentifier:user:recordIdentifier:)`.
- Record identifiers are opaque SHA-256 values with a versioned domain separator and length-prefixed account, generation, opaque cipher, service-kind, and canonical-service inputs. Every published service for one Login therefore receives a different opaque record identifier. Raw account IDs, generation UUIDs, cipher IDs, and service text are not recoverable from it.
- The Provider lists exact, relevant, and other Login groups in fixed order with readable reasons and an all-Login search field. Selecting a row does not submit; Fill is a separate explicit action. Other-group candidates require a second mismatch confirmation.
- Direct identity requests re-query the current Agent session and field-eligible candidates, recompute the account/generation/service-scoped record identifier, and carry the canonical presented service into the Agent's atomic release transaction. The Agent requires an exact canonical match to a currently publishable URI on that Login; domain relevance, fuzzy URI matching, removed services, and another service on the same cipher do not authorize direct release.
- Password and current TOTP-code release now occur inside `ProjectionStore.withAuthorizedCandidate`, under the same lock and transaction that consumes the single-use token and revalidates lease, account, generation, revision, context, policy, candidate, mismatch acknowledgement, and reprompt state. Candidate-query responses remain metadata-only.
- Lock, wrong service, stale state, cancellation, unavailable Agent, malformed response, and missing reprompt authorization fail closed. The Provider shows a fixed recovery message or cancels the system request; it does not use Accessibility, browser, clipboard, or another fallback.

## Identity-store boundary

`CredentialIdentityPublisher` serializes lifecycle requests on one private queue with a monotonic epoch. A new sync/account-switch/logout supersedes older queued work, waits behind an already-started replacement, and is always the final committed replacement. Pending work is detached/replaced and active work is advanced to a stable internal state before any completion is dispatched. Success, error, and superseded completions run asynchronously and exactly once on a separate serial callback queue, so a completion may reenter sync/logout without recursion, deadlock, duplicate notification, or overwriting the reentrant latest request. Delayed state/replace callbacks cannot cause an older request to become the final store contents. Each request first obtains `ASCredentialIdentityStoreState`. Disabled stores return `storeDisabled` without attempting a write. Enabled stores always use full replacement, including when incremental updates are supported; replace errors are propagated to the caller rather than swallowed.

The publication input type contains only item kind, opaque cipher ID, username, required service identifiers, and archived/deleted state. Cards, identities, secure notes, archived/deleted Logins, empty cipher IDs, and entries without a valid service are excluded. Published identities contain only canonical service metadata, username, and the opaque record identifier. Passwords, TOTP seeds/codes, notes, custom fields, and unrelated URI data have no publication field or code path.

The publisher is the explicit sync/account-lifecycle API for the containing native integration: `replaceAfterSync`, `removeForLogout`, and `preserveOnLock`. Production installation and lifecycle activation remain behind Task 9's signed containing-app/extension packaging gate; no production Tauri configuration or entitlement was changed here.

## Provider and Agent authorization boundary

The Provider begins by obtaining an authenticated current Agent session. Candidate query and secret-release response shapes are operation-specific; an unexpected session/candidate/secret payload is rejected as malformed. Candidate queries carry the requested field. The Agent removes field-ineligible Logins before metadata-only ranking (`totp` requires a seed and `password` requires a password), without returning a seed, code, password, or availability flag to the Provider. A requested secret field is also checked against the release response field.

The Agent reads the requested password, username, or TOTP seed only in the closure executed after `ProjectionStore` has atomically taken the authorization and completed all current-state checks. TOTP generation stays in the Agent and returns only the current numeric code. No candidate-query response or identity-store object contains a secret.

Agent and Provider own the response secret as mutable `Data`. JSON-encoding payloads, framed request/response data, socket read buffers, decoded projection keys, and the released-secret buffer are reset on success and error paths. The Provider's one-shot terminal gate atomically selects success, failure, or cancellation; cancellation after Agent release but before main-thread completion clears the secret and cannot call an AuthenticationServices completion callback. The Provider clears its owned buffer immediately after the AuthenticationServices completion call, on cancellation after release, on malformed response, and on deinitialization. Swift/Foundation strings created for `ASPasswordCredential`/`ASOneTimeCodeCredential` and Foundation/kernel internal copies are outside application-controlled zeroization; their lifetime is minimized but cannot be proven overwritten by application code.

Reprompt verification remains injected into the Agent's atomic authorization transaction. The system Provider has no implemented grant-acquisition UI, so reprompt-protected Logins deliberately fail closed in Task 6. The fixed recovery copy is: “This item requires verification that system AutoFill cannot complete. Open Barwarden to access it.” It contains no retry, “AutoFill again,” approval, or in-app AutoFill promise. A successful reprompt-protected system Provider path is deferred; Task 7 owns focused-field actions and is not implemented here.

## macOS version behavior

- The extension deployment target remains macOS 13.0 and its complete source set compiles for `arm64-apple-macos13.0`.
- macOS 13/14 use the stable `unsupported-system-totp` result and direct the user to Barwarden focused-field actions.
- macOS 15 APIs (`ASOneTimeCodeCredentialRequest`, identity, completion, and list preparation) are guarded with `@available(macOS 15.0, *)` and `#available(macOS 15.0, *)`. The extension plist advertises both `ProvidesPasswords` and `ProvidesOneTimeCodes`; these metadata keys do not introduce a macOS 15-linked symbol into the macOS 13 binary.
- macOS 14's combined request callback accepts supported password requests only; passkeys are neither advertised nor returned.

## TDD evidence

RED was observed before each implementation slice:

- identity lifecycle tests failed to compile before the publisher/store-state types existed, then covered full replacement, dedupe, account/generation scoping, logout, lock retention, active-Login filtering, disabled state, lack of incremental support, and replace-error propagation;
- Provider authorization tests failed before the coordinator/completion types existed, then covered lock, reprompt, stale generation, wrong service, explicit all-Login mismatch confirmation, cancellation, unavailable Agent, successful password completion/clearing, macOS 13/14 TOTP denial, macOS 15 TOTP field requests, grouping/reasons, and explicit-submit behavior;
- the existing Task 5 secret-release test first failed because release still returned `unavailable`, then passed only after the Agent performed atomic authorized field access and returned the requested field;
- TOTP tests failed before the Agent generator existed, then passed the RFC 6238 SHA-1 vector and current-code-only wire assertions;
- native project tests failed before the one-time-code capability was declared;
- a new protocol-shape test first proved generic operations accepted an unexpected session payload, then passed after strict response-shape validation. The full suite exposed the legitimate status-session path, which was moved to its dedicated request path and reverified with both focused tests.

The review-fix round added regression tests for the password capability contract; per-service record identifiers; deterministic delayed identity-store callbacks; exact current published-service authorization; one-shot terminal callbacks and cancel-after-release clearing; framing temporary-buffer observers; requested-field candidate filtering; accurate reprompt copy; reason-specific fixed UI copy; and mismatch-cancel selection retry. Direct RED was recorded for the capability, lifecycle, terminal, framing, copy, reason, and retry slices. Because the field/service protocol changes formed one compile cascade, their focused tests were additionally proven with a targeted mutation RED that removed both guards: all three requested-field, wrong-service, and stale-service tests failed, then passed after restoring the final implementation. The reason/mismatch tests first failed at compile time against the prior `Void` submit contract, then passed after a rejected submission became an explicit non-terminal result. The framing error-path test also demonstrated that two independently owned header buffers are each cleared, and its observer assertion was corrected to reflect both ownership layers.

The final review fix also followed RED/GREEN for both changes. The reprompt test first failed on the old retry wording. The deterministic publisher test first showed the old synchronous pending callback executing twice and losing the reentrant latest logout; after the fix it records exactly one callback for each active, pending, newer, and logout request, with only logout succeeding and the final replacement empty.

## Verification

- Final Credential Provider and identity publisher focused Xcode suites: 27 passed, 0 failed.
- Final full Xcode suite: 124 passed, 0 failed. Result bundle: `/private/tmp/barwarden-task6-final-fix-dd/Logs/Test/Test-BarwardenNativeAutoFill-2026.08.09_05-14-49-+0800.xcresult`.
- Native Xcode project/build-wrapper/Info contracts: 13 passed.
- Full Vitest regression: 3,487 passed, 22 skipped across 235 files.
- Rust regression: 202 passed, 4 ignored.
- Production web build: passed with existing CSS/chunk/externalization warnings only.
- `git diff --check`, forbidden Task 7/browser/Accessibility scan, identity secret-field scan, and production Tauri configuration/entitlement diff: passed.

An exploratory repository-wide `node --test scripts/*.spec.mjs` invocation was not used as a Task 6 gate: release-evidence tests outside this task require clean, pinned M13/M16 artifact state and reported those precondition failures in the intentionally dirty implementation worktree. The applicable native project/build-wrapper/Info contract file was rerun independently and passed 13/13.

## Live smoke and residual limitations

A real signed build was attempted and failed honestly before extension installation: no provisioning profile exists for `com.sommir.barwarden.credential-provider`, and no `Mac Development` certificate/private key for Team `K7LY92JY96` is available. Therefore the extension could not be installed/enabled and a live system AutoFill smoke could not be executed. No successful live result is claimed. The unsigned Xcode/unit and native build harnesses are runnable and passed; signed installation/provisioning is the explicit Task 9 gate.

System identity publication is exercised through the lifecycle component and its real `ASCredentialIdentityStore` adapter, but production sync invocation cannot be live-proven until the containing signed product installs the extension. Reprompt-protected system Provider success is also deferred and remains fail closed as described above.

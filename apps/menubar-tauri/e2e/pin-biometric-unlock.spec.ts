import { expect, test, type Page } from "@playwright/test";

const evidencePath = "/?authEvidence=alternative-unlock";
const startupEvidencePath = "/?authEvidence=alternative-unlock-startup";
const validPin = "246810";

test("master reprompt enables PIN, then PIN unlock syncs before opening the vault", async ({
  page,
}) => {
  await openSettings(page);
  await enablePin(page);
  await lock(page);

  await page.getByTestId("lock-pin-input").fill(validPin);
  await page.getByTestId("lock-pin-button").click();

  await expect(page).toHaveURL(/#\/tabs\/vault$/);
  await expect.poll(() => evidenceSnapshot(page)).toMatchObject({
    sessionReads: 0,
    syncs: 1,
  });
});

test("five wrong PIN attempts remove PIN and keep master-password fallback", async ({
  page,
}) => {
  await openSettings(page);
  await enablePin(page);
  await lock(page);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.getByTestId("lock-pin-input").fill("000000");
    await expect(page.getByTestId("lock-pin-button")).toBeEnabled();
    await page.getByTestId("lock-pin-button").click();
  }

  await expect(page.getByTestId("lock-master-password-input")).toBeVisible();
  await expect(page.getByTestId("lock-pin-form")).toHaveCount(0);
});

test("master reprompt enables Touch ID and automatic unlock syncs to the vault", async ({
  page,
}) => {
  await openSettings(page);
  await enableTouchId(page);
  await lock(page, /#\/tabs\/vault$/);

  await expect(page).toHaveURL(/#\/tabs\/vault$/);
  await expect.poll(() => evidenceSnapshot(page)).toMatchObject({
    biometricUnlocks: 1,
    sessionReads: 1,
    syncs: 1,
  });
});

test("Touch ID cancellation stays locked and a manual retry can succeed", async ({
  page,
}) => {
  await openSettings(page);
  await enableTouchId(page);
  await setBiometricOutcome(page, "cancelled");
  await lock(page);

  await expect(page.getByTestId("lock-biometric-button")).toBeVisible();
  await expect(page.getByTestId("lock-alternative-error")).toHaveCount(0);
  await setBiometricOutcome(page, "success");
  await page.getByTestId("lock-biometric-button").click();

  await expect(page).toHaveURL(/#\/tabs\/vault$/);
  await expect.poll(() => evidenceSnapshot(page)).toMatchObject({
    biometricUnlocks: 2,
    sessionReads: 1,
  });
});

test("Touch ID invalidation clears the persisted hint and falls back to master password", async ({
  page,
}) => {
  await openSettings(page);
  await enableTouchId(page);
  await setBiometricOutcome(page, "invalidated");
  await lock(page);

  await expect(page.getByTestId("lock-master-password-input")).toBeVisible();
  await expect.poll(() => evidenceSnapshot(page)).toMatchObject({
    biometricEnabled: false,
    sessionReads: 0,
  });
});

test("account A unlock methods are unavailable after switching to account B", async ({
  page,
}) => {
  await openSettings(page);
  await enablePin(page);
  await enableTouchId(page);
  await page.evaluate(() => globalThis.__bwAlternativeUnlockEvidence!.switchToAccountB());

  await expect(page).toHaveURL(/#\/lock$/);
  await expect(page.getByTestId("lock-master-password-input")).toBeVisible();
  await expect(page.getByTestId("lock-pin-form")).toHaveCount(0);
  await expect(page.getByTestId("lock-biometric-button")).toHaveCount(0);
});

test("simulated process restart removes PIN but retains the Touch ID hint", async ({
  page,
}) => {
  await openSettings(page);
  await enablePin(page);
  await enableTouchId(page);
  await setBiometricOutcome(page, "cancelled");

  await page.goto(startupEvidencePath);

  await expect(page).toHaveURL(/#\/lock$/);
  await expect(page.getByTestId("lock-biometric-button")).toBeVisible();
  await expect(page.getByTestId("lock-switch-pin")).toHaveCount(0);
  await expect.poll(() => evidenceSnapshot(page)).toMatchObject({
    pinEnabled: false,
    biometricEnabled: true,
  });
});

test("persisted unlocked startup begins locked and reads no session before explicit success", async ({
  page,
}) => {
  await openSettings(page);
  await enableTouchId(page);
  await setBiometricOutcome(page, "cancelled");

  await page.goto(startupEvidencePath);

  await expect(page).toHaveURL(/#\/lock$/);
  await expect.poll(() => evidenceSnapshot(page)).toMatchObject({
    sessionReads: 0,
    syncs: 0,
  });
  await setBiometricOutcome(page, "success");
  await page.getByTestId("lock-biometric-button").click();
  await expect(page).toHaveURL(/#\/tabs\/vault$/);
  await expect.poll(() => evidenceSnapshot(page)).toMatchObject({
    sessionReads: 1,
    syncs: 1,
  });
});

async function openSettings(page: Page): Promise<void> {
  await page.goto(evidencePath);
  await expect(page).toHaveURL(/#\/account-security$/);
  await expect(page.getByText("解锁选项", { exact: true })).toBeVisible();
}

async function enablePin(page: Page): Promise<void> {
  await page.locator("input#pinUnlock").click();
  await completeMasterReprompt(page);
  await page.getByTestId("pin-setup-input").fill(validPin);
  await page.getByTestId("pin-setup-confirmation").fill(validPin);
  await page.getByRole("dialog", { name: "设置 PIN" })
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await expect(page.locator("input#pinUnlock")).toBeChecked();
  await expect.poll(() => evidenceSnapshot(page)).toMatchObject({
    pinEnabled: true,
  });
}

async function enableTouchId(page: Page): Promise<void> {
  await page.locator("input#biometricUnlock").click();
  await completeMasterReprompt(page);
  await expect(page.locator("input#biometricUnlock")).toBeChecked();
}

async function completeMasterReprompt(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "确认主密码" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("主密码", { exact: true }).fill("evidence-master");
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
}

async function lock(
  page: Page,
  destination: RegExp = /#\/lock$/,
): Promise<void> {
  await page.evaluate(() => globalThis.__bwAlternativeUnlockEvidence!.lock());
  await expect(page).toHaveURL(destination);
}

async function setBiometricOutcome(
  page: Page,
  outcome: "success" | "cancelled" | "invalidated",
): Promise<void> {
  await page.evaluate(
    (nextOutcome) =>
      globalThis.__bwAlternativeUnlockEvidence!.setBiometricOutcome(nextOutcome),
    outcome,
  );
}

async function evidenceSnapshot(page: Page) {
  return page.evaluate(() =>
    globalThis.__bwAlternativeUnlockEvidence!.snapshot(),
  );
}

declare global {
  var __bwAlternativeUnlockEvidence:
    | {
        lock(): Promise<void>;
        switchToAccountB(): Promise<void>;
        setBiometricOutcome(
          outcome: "success" | "cancelled" | "invalidated",
        ): void;
        snapshot(): Promise<{
          pinEnabled: boolean;
          biometricEnabled: boolean;
          biometricUnlocks: number;
          sessionReads: number;
          syncs: number;
        }>;
      }
    | undefined;
}

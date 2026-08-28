#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const work = join(root, "output", "playwright", "readme-demos");
const assets = join(root, "docs", "assets");
const port = 1421;
const origin = `http://127.0.0.1:${port}`;

const locales = {
  zh: {
    locale: "zh-CN",
    menuFile: "barwarden-menubar-v016.gif",
    windowFile: "barwarden-window-v016.gif",
    pageTitle: "示例登录",
    subtitle: "安全访问你的示例账户",
    username: "用户名",
    password: "密码",
    verificationCode: "验证码",
    submit: "登录",
    ready: "凭据已填入",
    otpTab: "OTP",
    settingsTab: "设置",
    autofillSettings: "填充",
  },
  en: {
    locale: "en-US",
    menuFile: "barwarden-menubar-v016-en.gif",
    windowFile: "barwarden-window-v016-en.gif",
    pageTitle: "Demo sign in",
    subtitle: "Secure access to your example account",
    username: "Username",
    password: "Password",
    verificationCode: "Verification code",
    submit: "Sign in",
    ready: "Credentials filled",
    otpTab: "OTP",
    settingsTab: "Settings",
    autofillSettings: "Autofill",
  },
};

await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });
await mkdir(assets, { recursive: true });

if (process.env.README_DEMO_SKIP_BUILD !== "true") {
  run("npm", ["run", "build:web"], {
    ...process.env,
    VITE_BW_VAULT_EVIDENCE: "true",
  });
}

const server = spawn(
  join(root, "node_modules", ".bin", "vite"),
  [
    "preview",
    "--config",
    "apps/menubar-tauri/vite.config.ts",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  {
    cwd: root,
    env: { ...process.env, VITE_BW_VAULT_EVIDENCE: "true" },
    stdio: ["ignore", "pipe", "inherit"],
  },
);

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [language, copy] of Object.entries(locales)) {
      await generateMenuDemo(browser, language, copy);
      await generateWindowDemo(browser, language, copy);
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

async function generateMenuDemo(browser, language, copy) {
  const popup = await newAppPage(browser, copy.locale, { width: 480, height: 600 });
  await popup.goto(`${origin}/?vaultEvidence=populated&readmeDemo=autofill`, {
    waitUntil: "networkidle",
  });
  await popup.locator('[data-testid="vault-autofill-suggestions"]').waitFor();
  await popup.evaluate(() => document.fonts.ready);

  const popupImages = [];
  popupImages.push(await popup.screenshot());
  for (const field of ["username", "password", "totp"]) {
    const action = popup.locator(
      `[data-testid="vault-autofill-candidate"]:first-child `
      + `[data-testid="vault-autofill-field-action"][data-field="${field}"]`,
    );
    await action.focus();
    popupImages.push(await popup.screenshot());
  }

  const stage = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const states = [
    { popup: null, focus: "username", values: ["", "", ""], ready: false },
    { popup: 0, focus: "username", values: ["", "", ""], ready: false },
    { popup: 1, focus: "username", values: ["", "", ""], ready: false },
    { popup: 0, focus: "password", values: ["demo-user@example.test", "", ""], ready: false },
    { popup: 2, focus: "password", values: ["demo-user@example.test", "", ""], ready: false },
    { popup: 0, focus: "verification", values: ["demo-user@example.test", "••••••••••••", ""], ready: false },
    { popup: 3, focus: "verification", values: ["demo-user@example.test", "••••••••••••", ""], ready: false },
    { popup: null, focus: "none", values: ["demo-user@example.test", "••••••••••••", "482016"], ready: true },
  ];
  const frames = [];
  for (const [index, state] of states.entries()) {
    const popupSource = state.popup === null
      ? ""
      : `data:image/png;base64,${popupImages[state.popup].toString("base64")}`;
    await stage.setContent(menuStageHtml(copy, state, popupSource));
    await stage.evaluate(() => document.fonts.ready);
    const path = join(work, `${language}-menu-${String(index).padStart(2, "0")}.png`);
    await stage.screenshot({ path });
    frames.push(path);
  }
  await stage.context().close();
  await popup.context().close();
  encodeGif(frames, join(assets, copy.menuFile), [120, 90, 80, 80, 80, 80, 80, 150]);
}

async function generateWindowDemo(browser, language, copy) {
  const page = await newAppPage(browser, copy.locale, { width: 900, height: 640 });
  const base = `${origin}/?vaultEvidence=populated&readmeDemo=autofill&uilocation=popout`;
  await page.goto(base, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const frames = [];
  frames.push(await capture(page, `${language}-window-00.png`));

  const search = page.locator('[aria-label="搜索密码库"], [aria-label="Search vault"]');
  await search.fill("mail");
  await page.waitForTimeout(250);
  frames.push(await capture(page, `${language}-window-01.png`));
  await page.context().close();

  const featurePage = await newAppPage(browser, copy.locale, { width: 900, height: 640 });
  await featurePage.goto(base, { waitUntil: "networkidle" });
  await featurePage.getByRole("button", { name: copy.otpTab, exact: true }).click();
  await featurePage.locator('[data-testid="otp-code"]').waitFor();
  frames.push(await capture(featurePage, `${language}-window-02.png`));

  await featurePage.getByRole("button", { name: copy.settingsTab, exact: true }).click();
  await featurePage.waitForSelector("bw-settings-page");
  frames.push(await capture(featurePage, `${language}-window-03.png`));

  await featurePage.getByText(copy.autofillSettings, { exact: true }).first().click();
  await featurePage.waitForSelector("bw-autofill-settings-page");
  frames.push(await capture(featurePage, `${language}-window-04.png`));
  await featurePage.context().close();
  encodeGif(frames, join(assets, copy.windowFile), [110, 110, 120, 90, 150]);

  async function capture(target, name) {
    await target.waitForTimeout(180);
    return target.screenshot({ path: join(work, name) }).then(() => join(work, name));
  }
}

async function newAppPage(browser, locale, viewport) {
  const context = await browser.newContext({ locale, viewport });
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  return page;
}

function menuStageHtml(copy, state, popupSource) {
  const [username, password, verificationCode] = state.values;
  const field = (id, label, value, type = "text") => `
    <label class="field ${state.focus === id ? "focused" : ""}">
      <span>${escapeHtml(label)}</span>
      <input type="${type}" value="${escapeHtml(value)}" readonly>
    </label>`;
  return `<!doctype html>
  <html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;width:960px;height:640px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#182230;background:#e8edf5}
    .browser{position:absolute;inset:22px;border-radius:14px;background:#fff;box-shadow:0 18px 48px #53657d42;overflow:hidden}
    .chrome{height:70px;background:#f4f6f9;border-bottom:1px solid #d7dee8;padding:12px 18px;display:flex;align-items:center;gap:16px}
    .dots{display:flex;gap:8px}.dot{width:12px;height:12px;border-radius:50%}.red{background:#ff5f57}.yellow{background:#febc2e}.green{background:#28c840}
    .address{height:38px;flex:1;border:1px solid #d6dce6;border-radius:9px;background:#fff;display:flex;align-items:center;padding:0 14px;font-size:14px;color:#53657d}
    .site{height:548px;background:linear-gradient(145deg,#f7f9fc,#edf3fb);padding:42px 70px}
    .login{width:410px;padding:28px 34px 26px;border-radius:12px;background:#fff;border:1px solid #dfe5ee;box-shadow:0 16px 40px #49627e24}
    h1{font-size:27px;letter-spacing:0;margin:0 0 6px}.sub{margin:0 0 20px;color:#66758a;font-size:15px}
    .field{display:block;margin:0 0 12px}.field span{display:block;font-size:13px;font-weight:600;color:#4a596d;margin:0 0 6px}.field input{width:100%;height:44px;border:1px solid #c9d2df;border-radius:8px;background:#fff;padding:0 13px;font-size:15px;outline:0;color:#1f2937}.field.focused input{border-color:#1668f2;box-shadow:0 0 0 3px #1668f238}
    .submit{height:46px;width:100%;border:0;border-radius:8px;background:#1769f4;color:#fff;font-size:15px;font-weight:650}.status{height:30px;margin-top:14px;color:#137a46;font-size:14px;font-weight:650;display:flex;align-items:center;gap:7px}.check{width:20px;height:20px;border-radius:50%;background:#19a566;color:white;display:grid;place-items:center}
    .popover{position:absolute;right:34px;top:18px;width:432px;height:540px;object-fit:cover;object-position:top;border-radius:16px;box-shadow:0 22px 55px #1b2c4852;border:1px solid #cad4e2;background:#f5f8ff}
  </style></head><body>
    <main class="browser"><div class="chrome"><div class="dots"><i class="dot red"></i><i class="dot yellow"></i><i class="dot green"></i></div><div class="address">https://login.example.test</div></div>
      <section class="site"><div class="login"><h1>${escapeHtml(copy.pageTitle)}</h1><p class="sub">${escapeHtml(copy.subtitle)}</p>
        ${field("username", copy.username, username)}
        ${field("password", copy.password, password, "text")}
        ${field("verification", copy.verificationCode, verificationCode)}
        <button class="submit">${escapeHtml(copy.submit)}</button>
        ${state.ready ? `<div class="status"><span class="check">✓</span>${escapeHtml(copy.ready)}</div>` : ""}
      </div></section>
      ${popupSource ? `<img class="popover" src="${popupSource}">` : ""}
    </main>
  </body></html>`;
}

function encodeGif(frames, destination, delays) {
  const args = [];
  frames.forEach((frame, index) => {
    args.push("-delay", String(delays[index] ?? 90), frame);
  });
  args.push("-loop", "0", "-layers", "OptimizeTransparency", destination);
  run("magick", args);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("README demo preview server did not start");
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

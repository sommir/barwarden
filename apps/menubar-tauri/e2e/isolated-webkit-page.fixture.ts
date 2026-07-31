import {
  expect,
  test as base,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

export { expect };

export const test = base.extend<{ page: Page }>({
  page: async ({ browser, browserName }, use) => {
    const isolatedBrowser = browserName === "webkit"
      ? await webkit.launch({ headless: true })
      : null;
    const context = await (isolatedBrowser ?? browser).newContext({
      baseURL: "http://127.0.0.1:1420",
      deviceScaleFactor: 1,
      viewport: { width: 480, height: 600 },
    });
    try {
      await use(await context.newPage());
    } finally {
      await closePageContext(context, isolatedBrowser);
    }
  },
});

export async function closePageContext(
  context: Pick<BrowserContext, "close">,
  isolatedBrowser: Pick<Browser, "close"> | null,
): Promise<void> {
  try {
    await context.close();
  } finally {
    await isolatedBrowser?.close();
  }
}

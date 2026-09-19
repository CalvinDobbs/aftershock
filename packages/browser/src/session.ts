import { Browserbase } from "@browserbasehq/sdk";
import { browserbase, Stagehand, type BrowserContext, type Page } from "@browserbasehq/stagehand";

import type { BrowserConfig } from "./config.js";
import { INSTRUMENT_SCRIPT } from "./instrument.js";

export interface BrowserSession {
  sessionId: string;
  liveViewUrl?: string;
  page: Page;
  stagehand: Stagehand;
  browserbase: Browserbase;
  close(): Promise<void>;
}

export type BrowserSessionFactory = (config: BrowserConfig) => Promise<BrowserSession>;

async function activePage(context: BrowserContext): Promise<Page> {
  const pages = await context.pages();
  const page = pages[0];
  if (!page) throw new Error("Browserbase session opened without an active page");
  return page;
}

export const launchBrowserSession: BrowserSessionFactory = async (config) => {
  const browser = await browserbase.launch({
    apiKey: config.browserbaseApiKey,
    browserSettings: {
      viewport: { width: 1440, height: 900 },
      blockAds: true,
    },
  });

  const sessionId = browser.sessionId;
  if (!sessionId) {
    await browser.close();
    throw new Error("Browserbase did not return a session ID");
  }

  const client = new Browserbase({ apiKey: config.browserbaseApiKey });

  try {
    const stagehand = await Stagehand.create({
      browser,
      cache: true,
      selfHeal: true,
      model: {
        modelName: config.modelName,
        ...(config.modelApiKey ? { apiKey: config.modelApiKey } : {}),
      },
    });
    // Installed before any navigation so it is present on the first document
    // and every one after it. An init script added later would miss the load
    // that matters most.
    await browser.context.addInitScript(INSTRUMENT_SCRIPT);

    const page = await activePage(browser.context);
    const liveView = await client.sessions.debug(sessionId).catch(() => undefined);
    let closed = false;

    return {
      sessionId,
      ...(liveView ? { liveViewUrl: liveView.debuggerFullscreenUrl } : {}),
      page,
      stagehand,
      browserbase: client,
      async close() {
        if (closed) return;
        closed = true;
        try {
          await stagehand.close();
        } finally {
          await browser.close();
        }
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
};

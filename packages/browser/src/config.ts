import type { ModelName } from "@browserbasehq/stagehand";

export interface BrowserConfig {
  browserbaseApiKey: string;
  modelName: ModelName;
  modelApiKey?: string;
}

export function loadBrowserConfig(env: NodeJS.ProcessEnv = process.env): BrowserConfig {
  const browserbaseApiKey = env.BROWSERBASE_API_KEY;
  if (!browserbaseApiKey) throw new Error("BROWSERBASE_API_KEY is required");

  return {
    browserbaseApiKey,
    modelName: (env.STAGEHAND_MODEL ?? "openai/gpt-5.4-mini") as ModelName,
    ...(env.OPENAI_API_KEY ? { modelApiKey: env.OPENAI_API_KEY } : {}),
  };
}

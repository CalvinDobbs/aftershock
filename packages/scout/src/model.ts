import OpenAI from "openai";

/**
 * The one model call Scout makes, behind an interface so the charter logic is
 * testable without a network or a key.
 */
export interface CharterModel {
  complete(input: {
    system: string;
    user: string;
    schemaName: string;
    schema: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface OpenAiModelOptions {
  apiKey?: string;
  model?: string;
  client?: OpenAI;
}

/**
 * Scout's quality gates everything downstream, so this is the one place in
 * the pipeline worth spending a reasoning model on. Structured output is used
 * rather than prose parsing: a charter that fails to parse is a run that does
 * not happen.
 */
export function openAiModel(options: OpenAiModelOptions = {}): CharterModel {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey && !options.client) throw new Error("OPENAI_API_KEY is required for Scout");

  const client = options.client ?? new OpenAI({ apiKey });
  const model = options.model ?? process.env.SCOUT_MODEL ?? "gpt-4.1";

  return {
    async complete({ system, user, schemaName, schema }) {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: schemaName, strict: true, schema },
        },
      });

      const content = response.choices[0]?.message.content;
      if (!content) throw new Error("Scout model returned no content");
      return JSON.parse(content);
    },
  };
}

import type { Browserbase } from "@browserbasehq/sdk";
import type { ConsoleEntry, NetworkSummary } from "@aftershock/schema";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function consoleText(params: Record<string, unknown>): string {
  const args = Array.isArray(params.args) ? params.args : [];
  return args.map((arg) => {
    const entry = record(arg);
    if (typeof entry.value === "string") return entry.value;
    if (entry.value !== undefined) return JSON.stringify(entry.value);
    return typeof entry.description === "string" ? entry.description : "";
  }).filter(Boolean).join(" ");
}

export async function collectSessionEvidence(
  client: Browserbase,
  sessionId: string,
): Promise<{ network: NetworkSummary; console: ConsoleEntry[] }> {
  const logs = await client.sessions.logs.list(sessionId);
  const failedRequests: NetworkSummary["failedRequests"] = [];
  const console: ConsoleEntry[] = [];
  let requestCount = 0;

  for (const log of logs) {
    const params = record(log.request?.params);
    if (log.method === "Network.requestWillBeSent") requestCount += 1;

    if (log.method === "Network.loadingFailed") {
      const request = record(params.request);
      failedRequests.push({
        method: typeof request.method === "string" ? request.method : "UNKNOWN",
        url: typeof request.url === "string" ? request.url : "unknown",
        ...(typeof params.errorText === "string" ? { errorText: params.errorText } : {}),
      });
    }

    if (log.method === "Network.responseReceived") {
      const response = record(params.response);
      const status = typeof response.status === "number" ? response.status : undefined;
      if (status !== undefined && status >= 400) {
        failedRequests.push({
          method: "UNKNOWN",
          url: typeof response.url === "string" ? response.url : "unknown",
          status,
        });
      }
    }

    if (log.method === "Runtime.consoleAPICalled") {
      console.push({
        level: typeof params.type === "string" ? params.type : "log",
        text: consoleText(params),
        timestamp: typeof params.timestamp === "number" ? params.timestamp : (log.timestamp ?? Date.now()),
      });
    }
  }

  return { network: { requestCount, failedRequests }, console };
}

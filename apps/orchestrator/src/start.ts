import { resolveDataDirectory } from "./data-directory.js";
import { createObservabilityRuntime } from "./runtime.js";

const apiKey = process.env.BROWSERBASE_API_KEY;
if (!apiKey) throw new Error("BROWSERBASE_API_KEY is required");

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

const dataDirectory = resolveDataDirectory();
const runtime = createObservabilityRuntime({ dataDirectory, browserbaseApiKey: apiKey });

runtime.server.listen(port, "127.0.0.1", () => {
  const address = runtime.server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind a port");
  console.log(JSON.stringify({ url: `http://127.0.0.1:${address.port}`, dataDirectory }));
});

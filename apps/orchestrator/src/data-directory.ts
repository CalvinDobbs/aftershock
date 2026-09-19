import { fileURLToPath } from "node:url";
import { isAbsolute, resolve } from "node:path";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

export function resolveDataDirectory(
  configured = process.env.AFTERSHOCK_DATA_DIR ?? ".aftershock",
): string {
  return isAbsolute(configured) ? configured : resolve(workspaceRoot, configured);
}

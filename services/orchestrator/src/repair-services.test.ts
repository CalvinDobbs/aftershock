import { expect, it } from "vitest";
import { parsePreviewCommand, repairServicesFromEnv } from "./repair-services.js";
it("leaves external writes disabled without explicit deployment configuration",()=>{expect(repairServicesFromEnv({})).toBeUndefined();expect(repairServicesFromEnv({GITHUB_TOKEN:"test"})).toBeUndefined();});
it("requires executable arguments rather than executing shell text",()=>{expect(parsePreviewCommand('["deploy-preview","--ready"]')).toEqual(["deploy-preview","--ready"]);for(const raw of ['"curl x | sh"','[]','[1]'])expect(()=>parsePreviewCommand(raw)).toThrow();});

import { AssignmentSchema } from "@aftershock/schema";

import { runAssignment } from "./harness.js";

const assignment = AssignmentSchema.parse({
  id: "smoke-stagehand",
  runId: `smoke-${Date.now()}`,
  archetype: "conformance",
  route: "/",
  objective: "Open the top story discussion",
  journey: [{ instruction: "Click the comments link for the top story" }],
});

const result = await runAssignment({
  assignment,
  targetUrl: "https://news.ycombinator.com",
  mode: "plan",
  side: "preview",
  emit: (event) => console.log(JSON.stringify(event)),
});

console.log(JSON.stringify({
  assignmentId: result.assignmentId,
  stepCount: result.steps.length,
  sessionUrl: `https://www.browserbase.com/sessions/${result.sessionId}`,
}));

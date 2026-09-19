/**
 * `api` — webhook receiver, run API, GitHub integration.
 *
 * Contract the dashboard already consumes (apps/web/lib/api.ts):
 *
 *   GET  /runs                 -> RunSummary[]
 *   GET  /runs/:id             -> RunDetail
 *   GET  /runs/:id/events      -> text/event-stream of RunEvent
 *   POST /runs   {repo, sha}   -> { runId }      manual trigger
 *   POST /runs/:id/ask {text}  -> { accepted }   "message the room"
 *
 * Point the dashboard at this service by setting AFTERSHOCK_API_URL; until
 * then it serves the cached golden run from fixtures and nothing breaks.
 *
 * Webhook endpoints to add: POST /webhooks/github handling `push`,
 * `pull_request` and `deployment_status`, all converging on createRun().
 */
export {};

console.log('aftershock api: not implemented yet — see the contract above');

/**
 * The product pipeline vocabulary: the run, its charter, the Cast, findings,
 * repair, and the SSE contract the dashboard consumes.
 *
 * The browser runtime's own telemetry contracts live in `./browser.ts` and are
 * published separately as `@aftershock/schema/browser`. The two vocabularies
 * both have an `Assignment`, a `RunSummary`, a `RunStatus` and a `ConsoleEntry`
 * and they mean different things — a pipeline assignment is a Cast member with
 * a status and a step strip, a browser assignment is a journey handed to
 * Stagehand — so they are kept on separate entry points rather than merged.
 */
export * from './primitives.js';
export * from './charter.js';
export * from './run.js';
export * from './assignment.js';
export * from './finding.js';
export * from './repair.js';
export * from './events.js';

/**
 * `orchestrator` — the Director.
 *
 * Owns the stage machine, the concurrency semaphore sized to MAX_CONCURRENT,
 * and agent dispatch. Emits one RunEvent per stage completion (see
 * @aftershock/schema `RunEvent`); the dashboard renders whatever it is told.
 *
 * Dispatch priority: differential pairs first — they need two slots and a
 * half-dispatched pair is useless — then conformance.
 *
 * Every session is wrapped in try/finally and a reaper sweeps every 60s for
 * anything older than AGENT_TIMEOUT_MS. Leaked sessions are the fastest way to
 * burn the 100-hour grant.
 */
export {};

console.log('aftershock orchestrator: not implemented yet');

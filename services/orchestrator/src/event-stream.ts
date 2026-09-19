import { RunSummarySchema, type AgentEvent, type AgentTraceEvent, type RunSummary } from "@aftershock/schema/browser";

export interface EventRepository {
  append(trace: AgentTraceEvent): Promise<void>;
  list(runId: string): Promise<AgentTraceEvent[]>;
  listRunIds(): Promise<string[]>;
}

export type EventListener = (trace: AgentTraceEvent) => void | Promise<void>;

export class InMemoryEventRepository implements EventRepository {
  readonly traces: AgentTraceEvent[] = [];

  async append(trace: AgentTraceEvent): Promise<void> {
    this.traces.push(trace);
  }

  async list(runId: string): Promise<AgentTraceEvent[]> {
    return this.traces.filter((trace) => trace.event.runId === runId);
  }

  async listRunIds(): Promise<string[]> {
    return [...new Set(this.traces.map((trace) => trace.event.runId))];
  }
}

export class RunEventStream {
  private readonly listeners = new Map<string, Set<EventListener>>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly nextSequence = new Map<string, number>();

  constructor(private readonly repository: EventRepository) {}

  async publish(event: AgentEvent): Promise<AgentTraceEvent> {
    const prior = this.queues.get(event.runId) ?? Promise.resolve();
    let resolveTrace!: (trace: AgentTraceEvent) => void;
    let rejectTrace!: (error: unknown) => void;
    const result = new Promise<AgentTraceEvent>((resolve, reject) => {
      resolveTrace = resolve;
      rejectTrace = reject;
    });

    const queued = prior.catch(() => undefined).then(async () => {
      try {
        const sequence = await this.sequenceFor(event.runId);
        const trace = { sequence, event } satisfies AgentTraceEvent;
        await this.repository.append(trace);
        this.nextSequence.set(event.runId, sequence + 1);
        const listeners = [...(this.listeners.get(event.runId) ?? [])];
        await Promise.allSettled(
          listeners.map((listener) => Promise.resolve().then(() => listener(trace))),
        );
        resolveTrace(trace);
      } catch (error) {
        rejectTrace(error);
      }
    });

    this.queues.set(event.runId, queued);
    return result;
  }

  subscribe(runId: string, listener: EventListener): () => void {
    const listeners = this.listeners.get(runId) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(runId, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(runId);
    };
  }

  async history(runId: string): Promise<AgentTraceEvent[]> {
    const traces = await this.repository.list(runId);
    return traces.sort((left, right) => left.sequence - right.sequence);
  }

  async replay(runId: string, listener: EventListener): Promise<void> {
    for (const trace of await this.history(runId)) {
      await listener(trace);
    }
  }

  async runs(): Promise<RunSummary[]> {
    const summaries: RunSummary[] = [];
    for (const runId of await this.repository.listRunIds()) {
      const traces = await this.history(runId);
      if (traces.length === 0) continue;
      const events = traces.map((trace) => trace.event);
      const opened = events.filter((event) => event.type === "session.opened").length;
      const closed = events.filter((event) => event.type === "session.closed").length;
      const status: RunSummary["status"] = events.some(
        (event) => event.type === "session.failed",
      )
        ? "failed"
        : opened > 0 && closed >= opened
          ? "completed"
          : "running";
      summaries.push(
        RunSummarySchema.parse({
          runId,
          status,
          startedAt: events[0]!.timestamp,
          updatedAt: events[events.length - 1]!.timestamp,
          assignmentCount: new Set(events.map((event) => event.assignmentId)).size,
          eventCount: traces.length,
        }),
      );
    }
    return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private async sequenceFor(runId: string): Promise<number> {
    const next = this.nextSequence.get(runId);
    if (next !== undefined) return next;
    const existing = await this.repository.list(runId);
    return existing.reduce((highest, trace) => Math.max(highest, trace.sequence + 1), 0);
  }
}

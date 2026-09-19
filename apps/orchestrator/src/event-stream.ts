import type { AgentEvent, AgentTraceEvent } from "@aftershock/schema";

export interface EventRepository {
  append(trace: AgentTraceEvent): Promise<void>;
  list(runId: string): Promise<AgentTraceEvent[]>;
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

  private async sequenceFor(runId: string): Promise<number> {
    const next = this.nextSequence.get(runId);
    if (next !== undefined) return next;
    const existing = await this.repository.list(runId);
    return existing.reduce((highest, trace) => Math.max(highest, trace.sequence + 1), 0);
  }
}

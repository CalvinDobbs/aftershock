import { API_URL, LIVE, getRunDetail } from '@/lib/api';
import { buildReplay } from '@/lib/replay';

export const dynamic = 'force-dynamic';
// A paced replay runs about a minute and a live run considerably longer, so
// the stream must outlive the platform's default function timeout.
export const maxDuration = 300;

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  // Nginx/Vercel: never buffer an event stream.
  'x-accel-buffering': 'no',
};

/**
 * Stage events for one run.
 *
 * With a backend, this proxies the `api` service's own SSE channel unchanged —
 * the dashboard always talks to its own origin so no key is ever exposed.
 * Without one, it replays the stored run at `?speed=` (default 1, 0 = instant).
 */
export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const speed = Number(new URL(req.url).searchParams.get('speed') ?? '1');

  if (LIVE) {
    const upstream = await fetch(`${API_URL}/runs/${runId}/events`, {
      headers: { accept: 'text/event-stream' },
      signal: req.signal,
      cache: 'no-store',
    }).catch(() => null);

    if (upstream?.ok && upstream.body) {
      return new Response(upstream.body, { headers: SSE_HEADERS });
    }
    // Fall through to replay rather than leaving the run view blank.
  }

  const detail = await getRunDetail(runId);
  if (!detail) return new Response('run not found', { status: 404 });

  const paced = buildReplay(detail);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      let elapsed = 0;
      for (const { after, event } of paced) {
        if (req.signal.aborted) break;
        const wait = speed > 0 ? (after - elapsed) / speed : 0;
        elapsed = after;
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        send(event);
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

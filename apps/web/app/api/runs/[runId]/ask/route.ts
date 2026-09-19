import { NextResponse } from 'next/server';
import { API_URL, LIVE } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * "Message the room" — a human asking a bot to re-run something.
 *
 * Forwards to the Director, which is the only component allowed to dispatch
 * work or write to GitHub. Without a backend this is accepted and dropped, so
 * the composer is inert rather than broken.
 */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  if (!body?.text?.trim()) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }

  if (!LIVE) {
    return NextResponse.json({ accepted: false, reason: 'no api service configured' }, { status: 202 });
  }

  const res = await fetch(`${API_URL}/runs/${runId}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: body.text }),
  }).catch(() => null);

  if (!res?.ok) return NextResponse.json({ error: 'director unreachable' }, { status: 502 });
  return NextResponse.json(await res.json());
}

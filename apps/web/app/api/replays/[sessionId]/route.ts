import { NextResponse } from 'next/server';
import { getBrowserbase } from '@/lib/browserbase';

export const dynamic = 'force-dynamic';

/**
 * Page metadata for a session replay. One page per tab; our agents are
 * single-tab, so the evidence viewer takes pages[0].
 */
export async function GET(_req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await ctx.params;
  const bb = getBrowserbase();
  if (!bb) {
    return NextResponse.json({ error: 'BROWSERBASE_API_KEY is not set' }, { status: 501 });
  }
  try {
    const meta = await bb.sessions.replays.retrieve(sessionId);
    return NextResponse.json(meta);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

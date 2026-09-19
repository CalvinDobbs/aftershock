import { NextResponse } from 'next/server';
import { getBrowserbase } from '@/lib/browserbase';

export const dynamic = 'force-dynamic';

/**
 * Live View URL for a session that is still open.
 *
 * Browserbase exposes an embeddable debugger view per session. It is only
 * valid while the session is alive, so the room asks for it when an agent
 * starts and falls back to the recording the moment the session closes.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await ctx.params;
  const bb = getBrowserbase();
  if (!bb) return NextResponse.json({ error: 'BROWSERBASE_API_KEY is not set' }, { status: 501 });

  try {
    const debug = await bb.sessions.debug(sessionId);
    return NextResponse.json({ url: debug.debuggerFullscreenUrl });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

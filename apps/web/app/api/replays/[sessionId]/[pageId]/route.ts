import { getBrowserbase } from '@/lib/browserbase';

export const dynamic = 'force-dynamic';

/**
 * HLS playlist proxy.
 *
 * The Browserbase playlist call needs `x-bb-api-key`, so it has to happen
 * server-side; the browser points hls.js at this route on our own origin
 * instead. The playlist body carries pre-signed CDN segment URLs, so segments
 * stream directly from the CDN and we never proxy video bytes.
 *
 * Segment URLs expire after 6 hours — long-lived pages must re-fetch the
 * playlist rather than reuse a cached one, hence no-store.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ sessionId: string; pageId: string }> },
) {
  const { sessionId, pageId } = await ctx.params;
  const bb = getBrowserbase();
  if (!bb) return new Response('BROWSERBASE_API_KEY is not set', { status: 501 });

  try {
    const playlist = await bb.sessions.replays.retrievePage(sessionId, pageId);
    const m3u8 = await playlist.text();
    return new Response(m3u8, {
      headers: {
        'content-type': 'application/vnd.apple.mpegurl',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 502 });
  }
}

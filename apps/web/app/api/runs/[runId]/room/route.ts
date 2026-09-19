import { NextResponse } from 'next/server';
import { getRunDetail } from '@/lib/api';
import { deriveRoom } from '@/lib/room';

export const dynamic = 'force-dynamic';

/**
 * What the room will say, given a run's pipeline output.
 *
 * The transcript is a pure projection of `RunDetail` (see lib/room.ts), so
 * this endpoint lets you check how a run reads without opening the UI — useful
 * while building the Director, to see whether an agent's trace lands as a
 * sentence a human would write.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const d = await getRunDetail(runId);
  if (!d) return NextResponse.json({ error: 'run not found' }, { status: 404 });

  return NextResponse.json(
    deriveRoom({
      run: d.run,
      charter: d.charter,
      assignments: d.assignments,
      findings: d.findings,
      diagnosis: d.diagnosis,
      patch: d.patch,
      verification: d.verification,
      pullRequest: d.pullRequest,
    }).map((e) =>
      e.kind === 'message'
        ? { kind: e.kind, bot: e.bot, at: e.at, body: e.body, attach: e.attachments.map((a) => a.kind) }
        : e.kind === 'handoff'
          ? { kind: e.kind, from: e.from, to: e.to, lead: e.lead, tail: e.tail }
          : e,
    ),
  );
}

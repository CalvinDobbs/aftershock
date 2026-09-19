import { NextResponse } from 'next/server';
import { getRunDetail } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const detail = await getRunDetail(runId);
  if (!detail) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  return NextResponse.json(detail);
}

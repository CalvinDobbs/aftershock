import { NextResponse } from 'next/server';
import { createRun, listRuns } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await listRuns());
}

/** Manual trigger — the dashboard's "Run on commit" control. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { repo?: string; sha?: string } | null;
  if (!body?.repo || !body?.sha) {
    return NextResponse.json({ error: 'repo and sha are required' }, { status: 400 });
  }
  try {
    return NextResponse.json(await createRun({ repo: body.repo, sha: body.sha }));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

import { notFound } from 'next/navigation';
import { getRunDetail, listRuns } from '@/lib/api';
import { Room } from '@/components/room/Room';

export const dynamic = 'force-dynamic';

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const [detail, runs] = await Promise.all([getRunDetail(runId), listRuns()]);
  if (!detail) notFound();

  // The server render seeds the commit header so the page is never blank; the
  // stages themselves arrive over SSE and animate in.
  return (
    <Room
      runId={runId}
      seed={detail}
      runs={runs}
      maxConcurrent={Number(process.env.MAX_CONCURRENT ?? 6)}
    />
  );
}

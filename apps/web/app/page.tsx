import { redirect } from 'next/navigation';
import { listRuns } from '@/lib/api';

/** The room opens on the newest run, the way a chat client opens on the newest thread. */
export default async function Home() {
  const runs = await listRuns();
  const latest = runs[0];
  if (!latest) {
    return (
      <main className="flex h-screen items-center justify-center bg-page">
        <div className="text-center">
          <div className="text-[15px]/[1.6] text-ink-3">No runs yet.</div>
          <div className="mt-2 text-[13px]/[1.6] text-ink-7">
            Push to a connected repo, or POST a repo and sha to{' '}
            <span className="mono text-ink-5">/api/runs</span>.
          </div>
        </div>
      </main>
    );
  }
  redirect(`/runs/${latest.id}`);
}

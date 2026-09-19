'use client';

import { useState } from 'react';
import type { FeedItem } from '@/lib/room';
import { BotAvatar } from '@/components/bots/BotAvatar';
import { Feed } from './Feed';
import { ReplayModal } from '@/components/evidence/ReplayModal';

/**
 * Every browser in the run, in one row in the thread.
 *
 * The Cast used to live behind a separate Browsers view, which meant the most
 * persuasive thing the product does — several real browsers working at once —
 * was a click away from the conversation about it. Here it sits inline, in
 * order, and updates in place from Live View to recording as sessions close.
 */
export function BrowsersRow({ feeds, note }: { feeds: FeedItem[]; note: string }) {
  const [open, setOpen] = useState<FeedItem | null>(null);
  const cols = Math.min(3, Math.max(1, feeds.length));

  return (
    <div className="land">
      <div className="mb-2.5 flex items-center gap-2 pl-[41px]">
        <span className="flex -space-x-1.5">
          {[...new Set(feeds.map((f) => f.bot))].map((b) => (
            <BotAvatar key={b} bot={b} size={17} animate={false} />
          ))}
        </span>
        <span className="text-[12.5px]/[1] text-ink-7">{note}</span>
      </div>

      <div
        className="grid gap-2.5 pl-[41px]"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {feeds.map((f) => (
          <Feed
            key={f.assignmentId}
            sessionId={f.sessionId}
            state={f.state}
            label={f.label}
            caption={f.caption}
            step={f.step}
            url={f.url}
            onOpen={f.sessionId ? () => setOpen(f) : undefined}
          />
        ))}
      </div>

      {open?.sessionId && (
        <ReplayModal
          sessionId={open.sessionId}
          title={`${open.assignmentId} — ${open.caption}`}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

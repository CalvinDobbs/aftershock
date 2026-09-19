'use client';

import { BotAvatar } from '@/components/bots/BotAvatar';
import { BOTS, type BotId } from '@/components/bots/registry';
import type { Attachment } from '@/lib/room';
import { Attachments } from './attachments';
import { Say } from './Say';

export function Message({
  bot,
  at,
  role,
  body,
  attachments,
  max,
  typing,
  host,
}: {
  bot: BotId;
  at: string;
  role: string;
  body: string;
  attachments: Attachment[];
  max: number;
  typing?: boolean;
  host: string;
}) {
  return (
    <div className="land flex gap-[11px]">
      <BotAvatar bot={bot} size={30} style={{ marginTop: 2 }} />
      <div className="min-w-0 flex-1" style={{ maxWidth: max }}>
        <div className="mb-[5px] flex items-baseline gap-2">
          <span className="text-[14px]/[1] font-medium text-ink-1">{BOTS[bot].name}</span>
          <span className="text-[11.5px]/[1] text-ink-8">
            {role}
            {at && ` · ${at}`}
          </span>
        </div>

        {body && (
          <div className="pretty rounded-[14px] bg-bubble px-4 py-[13px] text-[15px]/[1.55] text-ink-2">
            <Say text={body} typing={typing} />
          </div>
        )}

        <Attachments items={attachments} host={host} />
      </div>
    </div>
  );
}

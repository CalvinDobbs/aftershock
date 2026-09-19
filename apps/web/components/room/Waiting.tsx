import { BotAvatar } from '@/components/bots/BotAvatar';
import type { BotId } from '@/components/bots/registry';

export function Waiting({ bot, text }: { bot: BotId; text: string }) {
  return (
    <div className="land flex items-center gap-[9px] pl-[41px]">
      <BotAvatar bot={bot} size={22} className="opacity-50" />
      <span className="text-[13px]/[1] text-ink-8">{text}</span>
    </div>
  );
}

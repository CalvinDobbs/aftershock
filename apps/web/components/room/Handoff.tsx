import { BotAvatar } from '@/components/bots/BotAvatar';
import { BOTS, type BotId } from '@/components/bots/registry';

/**
 * A handoff between stages, drawn as a rule across the thread.
 *
 * The PRD's design rule is that no agent both finds and judges. Saying each
 * handoff out loud is how that separation becomes visible rather than claimed.
 */
export function Handoff({
  from,
  to,
  lead,
  tail,
}: {
  from: BotId[];
  to: BotId[];
  lead: string;
  tail?: string;
}) {
  return (
    <div className="land flex items-center gap-2.5">
      <span className="h-px flex-1 bg-[#212121]" />
      <span className="flex items-center gap-[7px] rounded-full bg-[#1b1b1b] py-[5px] pr-[13px] pl-[9px]">
        {from.map((b) => (
          <BotAvatar key={b} bot={b} size={17} animate={false} />
        ))}
        <span className="text-[12.5px]/[1] text-ink-5">{lead}</span>
        {to.map((b) => (
          <BotAvatar key={b} bot={b} size={17} animate={false} />
        ))}
        {to.length === 1 && <span className="text-[12.5px]/[1] text-ink-5">{BOTS[to[0]!].name}</span>}
        {tail && <span className="text-[12.5px]/[1] text-ink-5">{tail}</span>}
      </span>
      <span className="h-px flex-1 bg-[#212121]" />
    </div>
  );
}

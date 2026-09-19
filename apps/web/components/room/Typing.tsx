import { BotAvatar } from '@/components/bots/BotAvatar';
import { BOTS, type BotId } from '@/components/bots/registry';

/**
 * Who the room is waiting on.
 *
 * Every stage takes tens of seconds, and a spinner says only that something is
 * happening. A name and a verb say who is working and on what, which is the
 * difference between a progress bar and a room full of people.
 */
export function Typing({ bot, verb }: { bot: BotId; verb: string }) {
  return (
    <div className="land flex items-center gap-[11px]">
      <BotAvatar bot={bot} size={30} className="opacity-60" />
      <span className="text-[13.5px]/[1] text-ink-8">
        {BOTS[bot].name} {verb}
        <Dots />
      </span>
    </div>
  );
}

function Dots() {
  return (
    <span aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block"
          style={{ animation: `bl 1.4s ease-in-out ${i * 0.18}s infinite` }}
        >
          .
        </span>
      ))}
    </span>
  );
}

import { BOTS, NAME_TO_BOT } from '@/components/bots/registry';
import { Caret } from '@/components/ui/atoms';

/**
 * Message text with @mentions tinted in the mentioned bot's own colour, and
 * `backticks` set in mono. With five bots talking, the colour is what keeps
 * the transcript scannable.
 */
export function Say({ text, typing = false }: { text: string; typing?: boolean }) {
  const parts = text.split(/(@[A-Za-z]+|`[^`]+`)/g).filter(Boolean);

  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('@')) {
          const bot = NAME_TO_BOT[p.slice(1).toLowerCase()];
          if (bot) {
            return (
              <span key={i} style={{ color: BOTS[bot].say }}>
                {p}
              </span>
            );
          }
        }
        if (p.startsWith('`') && p.endsWith('`') && p.length > 2) {
          return (
            <span key={i} className="mono text-[13px]">
              {p.slice(1, -1)}
            </span>
          );
        }
        return <span key={i}>{p}</span>;
      })}
      {typing && <Caret />}
    </>
  );
}

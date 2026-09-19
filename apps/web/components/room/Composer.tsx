'use client';

import { useState } from 'react';

/**
 * Ask the room for something — a re-run, a second opinion on a discarded
 * finding. Posts to the same manual-trigger endpoint the "Run on commit"
 * control uses; the webhook is a caller of `createRun()`, not a separate path.
 */
export function Composer({ runId }: { runId: string }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      await fetch(`/api/runs/${runId}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: value }),
      });
      setValue('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pt-0.5 pb-[22px]">
      <div className="flex items-center gap-3 rounded-full bg-composer px-[18px] py-[13px]">
        <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 3v10M3 8h10" stroke="#8a8a8a" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Message the room — ask a bot to re-run something"
          className="flex-1 bg-transparent text-[14.5px]/[1] text-ink-3 outline-none placeholder:text-ink-8"
        />
        <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="5.6" y="2" width="4.8" height="8" rx="2.4" stroke="#8a8a8a" strokeWidth="1.4" />
          <path
            d="M3.5 8a4.5 4.5 0 009 0M8 12.5V14"
            stroke="#8a8a8a"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}

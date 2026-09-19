'use client';

import { useState } from 'react';
import clsx from 'clsx';

type FilePatch = { path: string; plus: number; minus: number; lines: string[] };

/**
 * Splits a unified diff into per-file hunks.
 *
 * A patch is usually one file today because Understudy is told to change the
 * minimum number of files, but nothing guarantees that — a shared helper fix
 * touches several. Parsing per file means the card degrades to a file list
 * rather than a wall of code when it does.
 */
export function parsePatch(diff: string): FilePatch[] {
  const files: FilePatch[] = [];
  let current: FilePatch | null = null;

  for (const line of diff.split('\n')) {
    const header = line.match(/^diff --git a\/(\S+) b\/(\S+)/);
    if (header) {
      current = { path: header[2]!, plus: 0, minus: 0, lines: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (/^(index |--- |\+\+\+ )/.test(line)) continue;

    if (line.startsWith('+')) current.plus += 1;
    else if (line.startsWith('-')) current.minus += 1;
    current.lines.push(line);
  }

  // A diff with no `diff --git` header is still a diff; keep it in one bucket.
  if (files.length === 0 && diff.trim()) {
    const lines = diff.split('\n').filter((l) => !/^(index |--- |\+\+\+ )/.test(l));
    files.push({
      path: 'patch',
      plus: lines.filter((l) => l.startsWith('+')).length,
      minus: lines.filter((l) => l.startsWith('-')).length,
      lines,
    });
  }

  return files;
}

export function PatchCard({ diff, branch }: { diff: string; branch?: string }) {
  const files = parsePatch(diff);
  // Keyed by position, not path: a diff can legitimately contain the same
  // path twice, and keying by path collapses those into one toggle.
  const [open, setOpen] = useState<Set<number>>(new Set());
  const allOpen = open.size === files.length && files.length > 0;

  const toggle = (i: number) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const plus = files.reduce((n, f) => n + f.plus, 0);
  const minus = files.reduce((n, f) => n + f.minus, 0);

  return (
    <div className="mt-[9px] overflow-hidden rounded-[13px] border border-[#242424] bg-card">
      {files.map((f, fi) => {
        const isOpen = open.has(fi);
        return (
          <div key={`${f.path}:${fi}`} className="border-b border-[#202020] last:border-b-0">
            <button
              type="button"
              onClick={() => toggle(fi)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-[#1c1c1c]"
            >
              <svg
                width="9"
                height="9"
                viewBox="0 0 10 10"
                fill="none"
                aria-hidden
                className={clsx('shrink-0 transition-transform duration-200', isOpen && 'rotate-90')}
              >
                <path d="M3 1.5L7 5l-4 3.5" stroke="#8a8a8a" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span className="mono min-w-0 flex-1 truncate text-[12px]/[1.4] text-ink-4">
                {f.path}
              </span>
              <span className="mono shrink-0 text-[11px]/[1] text-plus">+{f.plus}</span>
              <span className="mono shrink-0 text-[11px]/[1] text-minus">−{f.minus}</span>
            </button>

            {isOpen && (
              <div className="mono reveal overflow-x-auto bg-shot px-3.5 py-2.5 text-[11.5px]/[1.7]">
                {f.lines.map((l, i) => (
                  <div
                    key={i}
                    className={
                      l.startsWith('+')
                        ? 'text-plus'
                        : l.startsWith('-')
                          ? 'text-minus'
                          : l.startsWith('@@')
                            ? 'text-ink-8'
                            : 'text-ink-7'
                    }
                  >
                    {l || ' '}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <span className="mono min-w-0 flex-1 truncate text-[11px]/[1.4] text-ink-8">
          {branch ?? `${files.length} file${files.length === 1 ? '' : 's'}`}
        </span>
        <span className="mono shrink-0 text-[11px]/[1] text-ink-8">
          +{plus} −{minus}
        </span>
        <button
          type="button"
          onClick={() => setOpen(allOpen ? new Set() : new Set(files.map((_f, i) => i)))}
          className="shrink-0 rounded-full bg-chip px-3 py-[5px] text-[11.5px]/[1] text-ink-5 transition-colors hover:bg-[#2e2e2e] hover:text-ink-2"
        >
          {allOpen ? 'Hide diff' : 'View diff'}
        </button>
      </div>
    </div>
  );
}

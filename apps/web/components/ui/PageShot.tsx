'use client';

import { useState } from 'react';
import type { DigestControl, VisibleDigest } from '@aftershock/schema';
import clsx from 'clsx';

/**
 * The page inside a browser frame.
 *
 * Prefers a real Browserbase screenshot. Falls back to drawing the step's
 * visible-text digest — the same typed capture the differential comparator
 * diffs — so evidence is legible before object storage is wired up and stays
 * legible if an upload fails mid-run.
 *
 * It draws whatever the app is, not whatever a shop is: a heading, the values
 * on the page, anything the app is saying, and the controls the agent can
 * reach. A dashboard, a login form and a checkout all render through the same
 * four buckets. The light ground is the point — the app under test is a lit
 * rectangle in a dark room, so evidence draws the eye with no highlight.
 */

const SCALE = {
  sm: { pad: '9px 10px', title: 7, meta: 5.5, row: 6.5, notice: 6, control: 6.5, primary: 7, primaryV: 8.5, gap: 5 },
  md: { pad: '11px 12px', title: 8, meta: 6, row: 7, notice: 6.5, control: 6.5, primary: 8, primaryV: 10, gap: 6 },
  lg: { pad: '12px 13px', title: 9, meta: 7, row: 7.5, notice: 7, control: 6.5, primary: 8.5, primaryV: 11, gap: 7 },
} as const;

export function PageShot({
  digest,
  screenshotUrl,
  scale = 'lg',
  alt,
}: {
  digest?: VisibleDigest | null;
  screenshotUrl?: string | null;
  scale?: keyof typeof SCALE;
  alt?: string;
}) {
  if (screenshotUrl) return <Shot src={screenshotUrl} alt={alt ?? 'step screenshot'} />;

  if (!digest) {
    return (
      <div
        className="mono flex items-center justify-center bg-white text-[#999]"
        style={{ height: 78, fontSize: 8 }}
      >
        no capture
      </div>
    );
  }

  const s = SCALE[scale];
  const accent = digest.flagged ? '#d2411f' : '#111';

  // These carry `.default([])` in the schema, which makes them optional on
  // the wire — and the dashboard casts API responses rather than parsing
  // them, so a producer that omits one arrives here as undefined. Defaulting
  // locally keeps a malformed payload from blanking the whole run view.
  const fields = digest.fields ?? [];
  const notices = digest.notices ?? [];
  const controls = digest.controls ?? [];

  return (
    <div className="bg-white" style={{ padding: s.pad }}>
      {(digest.title || digest.meta) && (
        <div
          className="flex items-baseline justify-between gap-2 border-b border-[#eee]"
          style={{ paddingBottom: s.gap }}
        >
          <span
            className="truncate font-semibold text-[#111]"
            style={{ fontSize: s.title, lineHeight: 1.2, letterSpacing: '.04em' }}
          >
            {digest.title}
          </span>
          <span className="shrink-0 text-[#999]" style={{ fontSize: s.meta, lineHeight: 1 }}>
            {digest.meta}
          </span>
        </div>
      )}

      {fields.length > 0 && (
        <div style={{ marginTop: s.gap + 2 }}>
          {fields.slice(0, 6).map((f, i) => (
            <div key={i} className="flex justify-between gap-2" style={{ marginBottom: s.gap - 2 }}>
              <span className="truncate text-[#666]" style={{ fontSize: s.row, lineHeight: 1.3 }}>
                {f.label}
              </span>
              <span
                className="mono shrink-0 text-[#666]"
                style={{ fontSize: s.row, lineHeight: 1.3 }}
              >
                {f.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {notices.map((n, i) => (
        <div
          key={i}
          className="rounded-[3px]"
          style={{
            fontSize: s.notice,
            lineHeight: 1.4,
            padding: '4px 6px',
            marginTop: s.gap - 2,
            marginBottom: s.gap - 2,
            color: n.tone === 'ok' ? '#2f6b45' : n.tone === 'error' ? '#a3352a' : '#4a5568',
            background: n.tone === 'ok' ? '#eef5f0' : n.tone === 'error' ? '#fbeeec' : '#eef1f5',
          }}
        >
          {n.text}
        </div>
      ))}

      {controls.length > 0 && (
        <div className="flex flex-wrap items-center gap-[4px]" style={{ marginTop: s.gap }}>
          {controls.slice(0, 4).map((c, i) => <Control key={i} control={c} size={s.control} />)}
        </div>
      )}

      {digest.primary && (
        <div
          className="flex items-baseline justify-between gap-2 border-t"
          style={{ paddingTop: s.gap, marginTop: s.gap + 2, borderColor: accent }}
        >
          <span
            className="truncate font-semibold"
            style={{ fontSize: s.primary, lineHeight: 1, color: accent }}
          >
            {digest.primary.label}
          </span>
          <span
            className="mono shrink-0 font-medium"
            style={{ fontSize: s.primaryV, lineHeight: 1, color: accent }}
          >
            {digest.primary.value}
          </span>
        </div>
      )}
    </div>
  );
}

/** Controls read as what they are: a filled field, a pressable thing, a link. */
function Control({
  control,
  size,
}: {
  control: DigestControl;
  size: number;
}) {
  const text = control.value || control.label;

  if (control.kind === 'button') {
    return (
      <span
        className="flex items-center justify-center rounded-[3px] bg-[#111] px-[6px] font-medium text-white"
        style={{ height: 15, fontSize: size, lineHeight: 1 }}
      >
        {text}
      </span>
    );
  }

  if (control.kind === 'link') {
    return (
      <span className="underline" style={{ fontSize: size, lineHeight: 1.4, color: '#2b5fa8' }}>
        {text}
      </span>
    );
  }

  if (control.kind === 'toggle') {
    // `value` is free text from whatever the page rendered, so the pill can
    // only ever be a guess. The captured value is shown as well, and that is
    // the part that has to be right — evidence must never contradict the
    // finding it supports.
    const state = (control.value ?? '').trim();
    const on = /^(on|true|enabled|yes|checked|active|1)$/i.test(state);
    const off = /^(off|false|disabled|no|unchecked|inactive|0)$/i.test(state);
    return (
      <span className="flex items-center gap-[4px]" style={{ fontSize: size, lineHeight: 1 }}>
        <span
          className="block rounded-full"
          style={{
            width: 13,
            height: 8,
            background: on ? '#2f6b45' : off ? '#d5d5d5' : '#b8b8b8',
          }}
        />
        <span className="text-[#666]">{control.label}</span>
        {state && !on && !off && <span className="mono text-[#888]">{state}</span>}
      </span>
    );
  }

  return (
    <span
      className={clsx(
        'flex min-w-[52px] flex-1 items-center rounded-[3px] border px-[5px]',
        control.value ? 'mono border-[#111] text-[#111]' : 'border-[#e2e2e2] text-[#bbb]',
      )}
      style={{ height: 15, fontSize: size, lineHeight: 1 }}
    >
      {text}
    </span>
  );
}

/** A real screenshot, developed in over its own placeholder. */
function Shot({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <span className="relative block w-full">
      {!loaded && <span className="breathe absolute inset-0 block bg-[#e9e9e9]" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        className={clsx('block w-full', loaded ? 'reveal' : 'opacity-0')}
      />
    </span>
  );
}

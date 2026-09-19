import type { VisibleDigest } from '@aftershock/schema';
import clsx from 'clsx';

/**
 * The white page inside a browser frame.
 *
 * Prefers a real Browserbase screenshot. Falls back to drawing the step's
 * visible-text digest — the same typed capture the differential comparator
 * diffs — so evidence is legible before object storage is wired up and stays
 * legible if an upload fails mid-run.
 *
 * The white is the point: the app under test is a bright storefront, so every
 * piece of evidence is a lit rectangle in a dark room.
 */

const SCALE = {
  sm: { pad: '9px 10px', brand: 6.5, meta: 5.5, line: 6.5, notice: 6, field: 6.5, total: 7, totalV: 8.5, gap: 6 },
  md: { pad: '11px 12px', brand: 7, meta: 6, line: 7, notice: 6.5, field: 6.5, total: 8, totalV: 10, gap: 7 },
  lg: { pad: '12px 13px', brand: 8, meta: 7, line: 7.5, notice: 7, field: 6.5, total: 8.5, totalV: 11, gap: 8 },
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
  if (screenshotUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={screenshotUrl} alt={alt ?? 'step screenshot'} className="block w-full" />;
  }

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
  const flag = digest.flagged;
  const accent = flag ? '#d2411f' : '#111';

  return (
    <div className="bg-white" style={{ padding: s.pad }}>
      {(digest.brand || digest.meta) && (
        <div
          className="flex items-center justify-between border-b border-[#eee]"
          style={{ paddingBottom: s.gap }}
        >
          <span
            className="font-semibold text-[#111]"
            style={{ fontSize: s.brand, letterSpacing: '.16em', lineHeight: 1 }}
          >
            {digest.brand}
          </span>
          <span className="text-[#999]" style={{ fontSize: s.meta, lineHeight: 1 }}>
            {digest.meta}
          </span>
        </div>
      )}

      <div style={{ marginTop: s.gap + 3 }}>
        {digest.lines.map((l, i) => (
          <div
            key={i}
            className="flex justify-between"
            style={{ marginBottom: i === digest.lines.length - 1 ? s.gap + 1 : s.gap - 2 }}
          >
            <span className="text-[#666]" style={{ fontSize: s.line, lineHeight: 1 }}>
              {l.label}
            </span>
            <span className="mono text-[#666]" style={{ fontSize: s.line, lineHeight: 1 }}>
              {l.value}
            </span>
          </div>
        ))}
      </div>

      {digest.notice && (
        <div
          className="rounded-[3px]"
          style={{
            fontSize: s.notice,
            lineHeight: 1.4,
            padding: '4px 6px',
            marginBottom: s.gap,
            color: digest.notice.tone === 'ok' ? '#2f6b45' : '#a3352a',
            background: digest.notice.tone === 'ok' ? '#eef5f0' : '#fbeeec',
          }}
        >
          {digest.notice.text}
        </div>
      )}

      {digest.field && (
        <div className="flex gap-[5px]" style={{ marginBottom: s.gap + 2 }}>
          <span
            className={clsx(
              'flex flex-1 items-center rounded-[3px] border pl-[5px]',
              digest.field.value ? 'mono border-[#111] text-[#111]' : 'border-[#e2e2e2] text-[#bbb]',
            )}
            style={{ height: 15, fontSize: s.field, lineHeight: 1 }}
          >
            {digest.field.value || digest.field.label}
          </span>
          {digest.action && (
            <span
              className="flex items-center justify-center rounded-[3px] bg-[#111] font-medium text-white"
              style={{ width: 34, height: 17, fontSize: s.field, lineHeight: 1 }}
            >
              {digest.action}
            </span>
          )}
        </div>
      )}

      {digest.total && (
        <div
          className="flex items-baseline justify-between border-t"
          style={{ paddingTop: s.gap, borderColor: accent }}
        >
          <span className="font-semibold" style={{ fontSize: s.total, lineHeight: 1, color: accent }}>
            {digest.total.label}
          </span>
          <span
            className="mono font-medium"
            style={{ fontSize: s.totalV, lineHeight: 1, color: accent }}
          >
            {digest.total.value}
          </span>
        </div>
      )}
    </div>
  );
}

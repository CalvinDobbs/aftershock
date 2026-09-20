/**
 * Maestro's voice: the Director is deterministic code, so it speaks as a line
 * in the thread rather than as a participant with a face.
 *
 * Left-aligned, like every other line here. Centring it made a one-line note
 * read as a chapter heading, and a two-line one read as a pull quote — both
 * louder than a status line has any business being.
 */
export function SystemLine({ text }: { text: string }) {
  return (
    <div className="land flex items-center gap-2.5 pl-[41px] text-[12.5px]/[1.5] text-ink-8">
      <span className="h-px w-3 flex-none bg-edge-2" />
      <span className="pretty">{text}</span>
    </div>
  );
}

import type { RunStatus } from "@aftershock/schema";

interface StatusBadgeProps {
  status: RunStatus;
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-${status}`}>
      <span className="status-dot" aria-hidden="true" />
      <span>{label ?? status}</span>
    </span>
  );
}

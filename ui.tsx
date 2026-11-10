import type { ReactNode } from "react";
import { statusLabel } from "@/lib/evaluation/flow";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

const tone: Record<string, string> = {
  matched: "bg-brand-soft text-brand",
  manually_verified: "bg-brand-soft text-brand",
  ambiguous: "bg-amber-soft text-amber",
  pending_review: "bg-amber-soft text-amber",
  unmatched: "bg-danger-soft text-danger",
};

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="rounded-full bg-paper px-2.5 py-1 text-xs font-semibold text-muted">مستوى القسم</span>;
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone[status] ?? "bg-paper text-muted"}`}>
      {statusLabel[status] ?? status}
    </span>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="card text-center">
      <p className="text-lg font-semibold">{title}</p>
      {body && <p className="mt-1 text-muted">{body}</p>}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
      {message}
    </div>
  );
}

export function Spinner({ label = "جارٍ التحميل…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-muted" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" />
      {label}
    </div>
  );
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-2xl bg-line/60" />
      ))}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

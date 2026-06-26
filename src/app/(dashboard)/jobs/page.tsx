"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ChevronDown, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Job = {
  id: string;
  kind: string;
  account_id: string | null;
  device_id: string | null;
  payload: Record<string, unknown>;
  state: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  attempts: number;
  next_run_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const REFRESH_INTERVAL_MS = 5000;

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const abs = Math.abs(diff);
  const s = Math.floor(abs / 1000);
  const suffix = diff >= 0 ? "ago" : "from now";
  if (s < 60) return `${s}s ${suffix}`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${suffix}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${suffix}`;
  return `${Math.floor(h / 24)}d ${suffix}`;
}

function statusTone(s: Job["status"]) {
  switch (s) {
    case "running":
      return "accent" as const;
    case "completed":
      return "online" as const;
    case "failed":
      return "error" as const;
    case "cancelled":
      return "neutral" as const;
    default:
      return "neutral" as const; // pending
  }
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autorefresh, setAutorefresh] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs?limit=100", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setJobs(data.jobs ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  async function cancelJob(id: string) {
    if (!confirm("Cancel this job? Any in-flight tick on the phone will finish, but no new ticks will run.")) return;
    try {
      const res = await fetch(`/api/jobs/${id}/cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      // Optimistic update so the UI feels instant; next auto-refresh confirms.
      setJobs((prev) =>
        prev.map((j) =>
          j.id === id ? { ...j, status: "cancelled", next_run_at: null } : j
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autorefresh) return;
    const t = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(t);
  }, [autorefresh, refresh]);

  const grouped = {
    active: jobs.filter((j) => j.status === "running" || j.status === "pending"),
    done: jobs.filter((j) => j.status === "completed"),
    failed: jobs.filter((j) => j.status === "failed" || j.status === "cancelled"),
  };

  return (
    <div className="mx-auto max-w-[1100px] px-8 py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="section-eyebrow mb-1.5">06 — Workshop</p>
          <h1 className="display text-[28px] font-semibold">Jobs</h1>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[12px] text-fg-muted">
            <input
              type="checkbox"
              checked={autorefresh}
              onChange={(e) => setAutorefresh(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Auto-refresh
          </label>
          <Button
            variant="secondary"
            size="sm"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw size={13} className={cn(loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Active" value={grouped.active.length} tone="accent" />
        <Stat label="Completed" value={grouped.done.length} tone="online" />
        <Stat label="Failed" value={grouped.failed.length} tone="error" />
      </div>

      {error && (
        <div className="mb-3 rounded border border-status-error/30 bg-status-error/10 px-3 py-2 text-[12px] text-status-error">
          {error}
        </div>
      )}

      <Card>
        <div className="grid grid-cols-[20px_minmax(140px,1fr)_minmax(120px,1fr)_minmax(160px,1.4fr)_90px_120px_110px_36px] items-center gap-3 border-b border-border bg-bg-surface-2 px-4 py-2.5 text-[11px] uppercase tracking-wider text-fg-subtle">
          <div />
          <div>Kind</div>
          <div>Device</div>
          <div>State</div>
          <div>Attempts</div>
          <div>Next run</div>
          <div className="text-right">Status</div>
          <div />
        </div>

        {loading && jobs.length === 0 ? (
          <CardBody>
            <div className="py-8 text-center text-[13px] text-fg-muted">
              Loading jobs…
            </div>
          </CardBody>
        ) : jobs.length === 0 ? (
          <CardBody>
            <div className="py-12 text-center">
              <div className="mb-2 text-[14px] text-fg">No jobs yet</div>
              <div className="text-[12px] text-fg-muted">
                Queue a warmup from <a href="/warmup" className="underline">Warmup</a>.
              </div>
            </div>
          </CardBody>
        ) : (
          <ul>
            {jobs.map((j) => (
              <JobRow
                key={j.id}
                job={j}
                expanded={expanded === j.id}
                onToggle={() => setExpanded(expanded === j.id ? null : j.id)}
                onCancel={() => cancelJob(j.id)}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function JobRow({
  job,
  expanded,
  onToggle,
  onCancel,
}: {
  job: Job;
  expanded: boolean;
  onToggle: () => void;
  onCancel: () => void;
}) {
  const state = job.state as {
    phase?: string;
    scrolls?: number;
    likes?: number;
    comments?: number;
  };
  const isActive = job.status === "pending" || job.status === "running";

  return (
    <li className="border-b border-border-subtle last:border-0">
      <div className="grid w-full grid-cols-[20px_minmax(140px,1fr)_minmax(120px,1fr)_minmax(160px,1.4fr)_90px_120px_110px_36px] items-center gap-3 px-4 py-2.5 hover:bg-bg-surface-2/40">
        <button
          onClick={onToggle}
          className="text-fg-subtle"
          title={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <button onClick={onToggle} className="text-left text-[12px] text-fg">
          {job.kind}
        </button>
        <button
          onClick={onToggle}
          className="truncate text-left font-mono text-[11px] text-fg-muted"
        >
          {job.device_id ?? "—"}
        </button>
        <button onClick={onToggle} className="text-left text-[12px] text-fg-muted">
          {state.phase ? (
            <>
              <span className="text-fg">{state.phase}</span>
              {typeof state.scrolls === "number" && (
                <span className="ml-2 text-fg-subtle">
                  {state.scrolls} scrolls · {state.likes ?? 0}♥ · {state.comments ?? 0}💬
                </span>
              )}
            </>
          ) : (
            <span className="text-fg-subtle">—</span>
          )}
        </button>
        <button onClick={onToggle} className="text-left text-[12px] text-fg-muted">
          {job.attempts}
        </button>
        <button onClick={onToggle} className="text-left text-[12px] text-fg-muted">
          {job.status === "running"
            ? "running now"
            : relativeTime(job.next_run_at)}
        </button>
        <div className="flex justify-end">
          <Badge tone={statusTone(job.status)}>{job.status}</Badge>
        </div>
        <div className="flex justify-end">
          {isActive ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              className="rounded p-1 text-fg-subtle transition-colors hover:bg-status-error/10 hover:text-status-error"
              title="Cancel job"
            >
              <X size={13} />
            </button>
          ) : null}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border-subtle bg-bg-surface-2/40 px-4 py-3">
          <Detail job={job} />
        </div>
      )}
    </li>
  );
}

function Detail({ job }: { job: Job }) {
  return (
    <div className="grid grid-cols-2 gap-4 text-[12px]">
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-subtle">
          ID
        </div>
        <code className="font-mono text-fg-muted">{job.id}</code>
      </div>
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-subtle">
          Created
        </div>
        <span className="text-fg-muted">
          {new Date(job.created_at).toLocaleString()}
        </span>
      </div>
      <div className="col-span-2">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-subtle">
          Payload
        </div>
        <pre className="overflow-auto rounded border border-border-subtle bg-bg p-2 font-mono text-[11px] text-fg-muted">
          {JSON.stringify(job.payload, null, 2)}
        </pre>
      </div>
      <div className="col-span-2">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-subtle">
          State
        </div>
        <pre className="overflow-auto rounded border border-border-subtle bg-bg p-2 font-mono text-[11px] text-fg-muted">
          {JSON.stringify(job.state, null, 2)}
        </pre>
      </div>
      {job.error && (
        <div className="col-span-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-status-error">
            Error
          </div>
          <pre className="overflow-auto rounded border border-status-error/30 bg-status-error/10 p-2 font-mono text-[11px] text-status-error">
            {job.error}
          </pre>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "accent" | "online" | "error";
}) {
  const toneClass = {
    accent: "text-accent",
    online: "text-status-online",
    error: "text-status-error",
  }[tone];
  return (
    <Card className="px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-fg-subtle">
        {label}
      </div>
      <div
        className={cn(
          "mt-1.5 font-display text-[26px] font-semibold leading-none",
          toneClass
        )}
      >
        {value}
      </div>
    </Card>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody } from "@/components/ui/card";

type Device = {
  id: string;
  alias: string | null;
  online: boolean;
};

type FormState = {
  device_id: string;
  duration_minutes: number;
  pause_seconds_min: number;
  pause_seconds_max: number;
  like_chance: number;
  comment_chance: number;
};

const DEFAULTS: FormState = {
  device_id: "",
  duration_minutes: 10,
  pause_seconds_min: 5,
  pause_seconds_max: 15,
  like_chance: 0.3,
  comment_chance: 0.1,
};

export default function WarmupPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[]>([]);
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string } | null>(null);

  useEffect(() => {
    fetch("/api/devices", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const list: Device[] = d.devices ?? [];
        setDevices(list);
        if (list.length > 0 && !form.device_id) {
          setForm((f) => ({ ...f, device_id: list[0].id }));
        }
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);

    if (!form.device_id) {
      setError("Pick a device first.");
      return;
    }
    if (form.pause_seconds_min > form.pause_seconds_max) {
      setError("Pause min must be ≤ pause max.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "instagram_warmup",
          device_id: form.device_id,
          payload: {
            duration_minutes: form.duration_minutes,
            pause_seconds_min: form.pause_seconds_min,
            pause_seconds_max: form.pause_seconds_max,
            like_chance: form.like_chance,
            comment_chance: form.comment_chance,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCreated({ id: data.job.id });
      // soft-reset so user can queue another easily
      setForm((f) => ({ ...f, ...DEFAULTS, device_id: f.device_id }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-[720px] px-8 py-8">
      <div className="mb-6">
        <p className="section-eyebrow mb-1.5">04 — Conditioning</p>
        <h1 className="display text-[28px] font-semibold">Warmup</h1>
        <p className="mt-2 text-[13px] text-fg-muted">
          Queue a Reels warmup session. The cron orchestrator picks up the job
          and advances it in chunks until the duration elapses.
        </p>
      </div>

      <Card>
        <CardBody className="p-5">
          <form onSubmit={submit} className="space-y-4">
            <Field label="Device" required>
              <select
                value={form.device_id}
                onChange={(e) => update("device_id", e.target.value)}
                required
                className="h-9 w-full rounded border border-border bg-bg-surface px-3 text-[13px] focus:border-border-strong focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                {devices.length === 0 ? (
                  <option value="">No devices — add one from /devices first</option>
                ) : (
                  devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.alias ? `${d.alias} (${d.id})` : d.id}
                      {d.online ? "" : " — offline"}
                    </option>
                  ))
                )}
              </select>
            </Field>

            <Field label="Duration (minutes)" required>
              <Input
                type="number"
                min={1}
                max={120}
                value={form.duration_minutes}
                onChange={(e) =>
                  update("duration_minutes", parseInt(e.target.value, 10) || 0)
                }
                required
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Pause min (sec)" required>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={form.pause_seconds_min}
                  onChange={(e) =>
                    update("pause_seconds_min", parseFloat(e.target.value) || 0)
                  }
                  required
                />
              </Field>
              <Field label="Pause max (sec)" required>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={form.pause_seconds_max}
                  onChange={(e) =>
                    update("pause_seconds_max", parseFloat(e.target.value) || 0)
                  }
                  required
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Like chance (0–1)" required>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={form.like_chance}
                  onChange={(e) =>
                    update("like_chance", parseFloat(e.target.value) || 0)
                  }
                  required
                />
              </Field>
              <Field label="Comment chance (0–1)" required>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={form.comment_chance}
                  onChange={(e) =>
                    update("comment_chance", parseFloat(e.target.value) || 0)
                  }
                  required
                />
              </Field>
            </div>

            {error && (
              <div className="rounded border border-status-error/30 bg-status-error/10 px-3 py-2 text-[12px] text-status-error">
                {error}
              </div>
            )}

            {created && (
              <div className="flex items-center justify-between rounded border border-status-success/30 bg-status-success/10 px-3 py-2 text-[12px] text-status-success">
                <span>
                  Job queued —{" "}
                  <code className="font-mono">{created.id.slice(0, 8)}…</code>
                </span>
                <button
                  type="button"
                  onClick={() => router.push("/jobs")}
                  className="underline hover:no-underline"
                >
                  Open Jobs →
                </button>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-border-subtle pt-4">
              <p className="text-[11px] text-fg-subtle">
                Cron picks up the queue every minute.
              </p>
              <Button
                type="submit"
                disabled={submitting || devices.length === 0}
              >
                <Flame size={14} />
                {submitting ? "Queueing…" : "Queue warmup"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-fg-subtle">
        {label}
        {required && <span className="ml-1 text-accent">*</span>}
      </span>
      {children}
    </label>
  );
}

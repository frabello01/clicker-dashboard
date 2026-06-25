"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, RotateCcw, Pencil, Copy, Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardBody } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Device = {
  id: string;
  alias: string | null;
  online: boolean;
  last_seen: string | null;
  notes: string | null;
};

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [restartingId, setRestartingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/devices", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok && !data.devices) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setDevices(data.devices ?? []);
      setStale(Boolean(data.stale));
      if (data.error && data.devices) {
        setError(data.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function updateAlias(id: string, alias: string) {
    const res = await fetch(`/api/devices/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alias }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "update failed" }));
      setError(error);
      return;
    }
    setDevices((prev) =>
      prev.map((d) => (d.id === id ? { ...d, alias } : d))
    );
  }

  async function restartDevice(id: string) {
    setRestartingId(id);
    try {
      const res = await fetch(`/api/devices/${id}/restart`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestartingId(null);
    }
  }

  const online = devices.filter((d) => d.online).length;
  const offline = devices.length - online;

  return (
    <div className="mx-auto max-w-[1100px] px-8 py-8">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="section-eyebrow mb-1.5">01 — Fleet</p>
          <h1 className="display text-[28px] font-semibold">Devices</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAdding((v) => !v)}
          >
            {adding ? <X size={13} /> : <Plus size={13} />}
            {adding ? "Cancel" : "Add device"}
          </Button>
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

      {adding && (
        <AddDeviceForm
          onCancel={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            refresh();
          }}
          onError={(msg) => setError(msg)}
        />
      )}

      {/* Stats strip */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Total" value={devices.length} />
        <Stat label="Online" value={online} tone="online" />
        <Stat label="Offline" value={offline} tone="offline" />
      </div>

      {/* Banners */}
      {stale && (
        <div className="mb-3 rounded border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-[12px] text-status-warning">
          Showing cached devices — couldn&apos;t reach Nomix API.
        </div>
      )}
      {error && (
        <div className="mb-3 rounded border border-status-error/30 bg-status-error/10 px-3 py-2 text-[12px] text-status-error">
          {error}
        </div>
      )}

      {/* Table */}
      <Card>
        <div className="grid grid-cols-[28px_minmax(200px,1fr)_minmax(220px,1.4fr)_110px_110px] items-center gap-3 border-b border-border bg-bg-surface-2 px-4 py-2.5 text-[11px] uppercase tracking-wider text-fg-subtle">
          <div />
          <div>Device ID</div>
          <div>Alias</div>
          <div>Last seen</div>
          <div className="text-right">Actions</div>
        </div>

        {loading && devices.length === 0 ? (
          <CardBody>
            <div className="py-8 text-center text-[13px] text-fg-muted">
              Loading devices…
            </div>
          </CardBody>
        ) : devices.length === 0 ? (
          <CardBody>
            <div className="py-12 text-center">
              <div className="mb-2 text-[14px] text-fg">No devices yet</div>
              <div className="text-[12px] text-fg-muted">
                Plug a NomixClicker into an iPhone and refresh. In development,
                set <code className="font-mono text-[11px]">NOMIX_USE_MOCK=true</code> to see sample devices.
              </div>
            </div>
          </CardBody>
        ) : (
          <ul>
            {devices.map((d) => (
              <DeviceRow
                key={d.id}
                device={d}
                restarting={restartingId === d.id}
                onUpdateAlias={(alias) => updateAlias(d.id, alias)}
                onRestart={() => restartDevice(d.id)}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function AddDeviceForm({
  onCancel,
  onAdded,
  onError,
}: {
  onCancel: () => void;
  onAdded: () => void;
  onError: (msg: string) => void;
}) {
  const [id, setId] = useState("");
  const [alias, setAlias] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!id.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id.trim(), alias: alias.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onAdded();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-4">
      <form
        onSubmit={submit}
        className="flex items-end gap-3 px-4 py-3"
      >
        <div className="flex-1">
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-fg-subtle">
            Device ID (Nomix)
          </label>
          <Input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="e.g. iphone-x-slot-1"
            required
            autoFocus
            className="h-8 text-[12px]"
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-fg-subtle">
            Alias (optional)
          </label>
          <Input
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="e.g. Lab phone 1"
            className="h-8 text-[12px]"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving || !id.trim()}>
            {saving ? "Adding…" : "Add"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "online" | "offline" | "neutral";
}) {
  return (
    <Card className="px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-fg-subtle">
        {tone !== "neutral" && <StatusDot tone={tone} />}
        {label}
      </div>
      <div className="mt-1.5 font-display text-[26px] font-semibold leading-none">
        {value}
      </div>
    </Card>
  );
}

function DeviceRow({
  device,
  restarting,
  onUpdateAlias,
  onRestart,
}: {
  device: Device;
  restarting: boolean;
  onUpdateAlias: (alias: string) => void;
  onRestart: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(device.alias ?? "");
  const [copied, setCopied] = useState(false);

  async function copyId() {
    await navigator.clipboard.writeText(device.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  function commit() {
    setEditing(false);
    if (draft !== (device.alias ?? "")) {
      onUpdateAlias(draft);
    }
  }

  return (
    <li className="grid grid-cols-[28px_minmax(200px,1fr)_minmax(220px,1.4fr)_110px_110px] items-center gap-3 border-b border-border-subtle px-4 py-2.5 last:border-0 hover:bg-bg-surface-2/40">
      <div>
        <StatusDot tone={device.online ? "online" : "offline"} />
      </div>

      <div className="flex items-center gap-2">
        <code className="truncate font-mono text-[12px] text-fg">{device.id}</code>
        <button
          onClick={copyId}
          className="text-fg-subtle hover:text-fg"
          title="Copy ID"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>

      <div>
        {editing ? (
          <Input
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(device.alias ?? "");
                setEditing(false);
              }
            }}
            className="h-7 text-[12px]"
          />
        ) : (
          <button
            onClick={() => {
              setDraft(device.alias ?? "");
              setEditing(true);
            }}
            className="group flex w-full items-center gap-2 text-left"
          >
            <span
              className={cn(
                "truncate text-[13px]",
                device.alias ? "text-fg" : "italic text-fg-subtle"
              )}
            >
              {device.alias || "Add alias"}
            </span>
            <Pencil
              size={11}
              className="text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100"
            />
          </button>
        )}
      </div>

      <div className="text-[12px] text-fg-muted">
        {relativeTime(device.last_seen)}
      </div>

      <div className="flex justify-end gap-1.5">
        <Badge tone={device.online ? "online" : "offline"}>
          {device.online ? "online" : "offline"}
        </Badge>
        <button
          onClick={onRestart}
          disabled={restarting || !device.online}
          className={cn(
            "rounded p-1 text-fg-muted transition-colors hover:bg-bg-surface-3 hover:text-fg",
            "disabled:cursor-not-allowed disabled:opacity-30"
          )}
          title="Restart device"
        >
          <RotateCcw size={13} className={cn(restarting && "animate-spin")} />
        </button>
      </div>
    </li>
  );
}

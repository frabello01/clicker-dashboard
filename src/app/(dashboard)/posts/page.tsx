"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody } from "@/components/ui/card";

type Device = { id: string; alias: string | null; online: boolean };

const MAX_BYTES = 50 * 1024 * 1024;

export default function PostsPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/devices", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const list: Device[] = d.devices ?? [];
        setDevices(list);
        if (list.length > 0) setDeviceId(list[0].id);
      })
      .catch((e) => setError(e.message));
  }, []);

  function pickFile(f: File | null) {
    if (!f) {
      setFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(
        `Video troppo grande: ${(f.size / 1024 / 1024).toFixed(1)} MB (max 50 MB)`
      );
      setFile(null);
      return;
    }
    setError(null);
    setFile(f);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !deviceId) return;
    setError(null);
    setCreated(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set("video", file);
      fd.set("caption", caption);
      fd.set("device_id", deviceId);
      const res = await fetch("/api/posts/reel", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCreated({ id: data.job.id });
      setFile(null);
      setCaption("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-[720px] px-8 py-8">
      <div className="mb-6">
        <p className="section-eyebrow mb-1.5">05 — Output</p>
        <h1 className="display text-[28px] font-semibold">Post Reel</h1>
        <p className="mt-2 text-[13px] text-fg-muted">
          Carica un video (max 50 MB). Il file passa per Telegram (no
          compressione) e viene salvato in Photos sul telefono, poi pubblicato
          come Reel.
        </p>
      </div>

      <Card>
        <CardBody className="p-5">
          <form onSubmit={submit} className="space-y-4">
            <Field label="Device" required>
              <select
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                required
                className="h-9 w-full rounded border border-border bg-bg-surface px-3 text-[13px] focus:border-border-strong focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                {devices.length === 0 ? (
                  <option value="">No devices</option>
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

            <Field label="Video file (max 50 MB)" required>
              <label
                htmlFor="reel-file"
                className="flex h-24 cursor-pointer items-center justify-center rounded border border-dashed border-border bg-bg-surface-2/30 px-4 text-[13px] text-fg-muted hover:bg-bg-surface-2/60"
              >
                <div className="flex items-center gap-2">
                  <Upload size={14} />
                  {file
                    ? `${file.name} — ${(file.size / 1024 / 1024).toFixed(1)} MB`
                    : "Click to choose .mp4 / .mov"}
                </div>
              </label>
              <input
                id="reel-file"
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/*"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
            </Field>

            <Field label="Caption">
              <Input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Caption del Reel (puoi includere emoji, hashtag…)"
              />
            </Field>

            {error && (
              <div className="rounded border border-status-error/30 bg-status-error/10 px-3 py-2 text-[12px] text-status-error">
                {error}
              </div>
            )}

            {created && (
              <div className="flex items-center justify-between rounded border border-status-success/30 bg-status-success/10 px-3 py-2 text-[12px] text-status-success">
                <span>
                  Job in coda —{" "}
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
                Worker (DigitalOcean) lo prende entro 5 secondi.
              </p>
              <Button
                type="submit"
                disabled={submitting || !file || !deviceId}
              >
                <Send size={14} />
                {submitting ? "Uploading…" : "Queue Reel"}
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

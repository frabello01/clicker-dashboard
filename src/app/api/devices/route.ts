import { NextResponse } from "next/server";
import { getNomixClient, NomixError } from "@/lib/nomix";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/devices
 *
 * Nomix `/devices` returns just an array of device IDs (the dongles attached
 * to the account). To know per-device online status we fan-out a `/status`
 * call. We persist the merged view locally so the UI can attach editable
 * metadata (alias, notes) the Nomix panel doesn't track.
 */
export async function GET() {
  const supabase = await createClient();
  const nomix = getNomixClient();

  const [{ data: localRows, error: localErr }, remoteRes] = await Promise.all([
    supabase.from("devices").select("*"),
    nomix.listDevices().then(
      (ids) => ({ ids, error: null as Error | null }),
      (error: Error) => ({ ids: null as string[] | null, error })
    ),
  ]);

  if (localErr) {
    return NextResponse.json(
      { error: `Supabase: ${localErr.message}` },
      { status: 500 }
    );
  }

  if (remoteRes.error) {
    const status =
      remoteRes.error instanceof NomixError ? remoteRes.error.status : 500;
    return NextResponse.json(
      {
        error: `Nomix: ${remoteRes.error.message}`,
        // Fall back to local cache so the page still shows something.
        devices: (localRows ?? []).map((r) => ({
          id: r.id,
          alias: r.alias,
          online: false,
          last_seen: r.last_seen,
          notes: r.notes,
        })),
        stale: true,
      },
      { status }
    );
  }

  // Fan-out status per Nomix-known device. Each call is short; tolerate
  // individual failures by treating them as "disconnected".
  const remoteIds = remoteRes.ids ?? [];
  const statuses = await Promise.all(
    remoteIds.map((id) =>
      nomix
        .getStatus(id)
        .then((s) => ({ id, connected: Boolean(s.connected) }))
        .catch(() => ({ id, connected: false }))
    )
  );
  const remoteStatusById = new Map(statuses.map((s) => [s.id, s.connected]));

  const localById = new Map((localRows ?? []).map((r) => [r.id as string, r]));
  // Union of both sources — locally-added devices that Nomix doesn't (yet)
  // know about still appear in the UI, marked offline.
  const allIds = new Set<string>([...remoteIds, ...localById.keys()]);
  const nowIso = new Date().toISOString();
  const merged = [...allIds].map((id) => {
    const local = localById.get(id);
    const online = remoteStatusById.get(id) ?? false;
    return {
      id,
      alias: local?.alias ?? null,
      online,
      last_seen: online ? nowIso : local?.last_seen ?? null,
      notes: local?.notes ?? null,
    };
  });

  // Upsert remote-known devices into the local cache so the offline-fallback
  // path renders them later. Local-only rows are already there.
  const remoteOnly = merged.filter((d) => remoteStatusById.has(d.id));
  if (remoteOnly.length > 0) {
    await supabase.from("devices").upsert(
      remoteOnly.map((d) => ({
        id: d.id,
        alias: d.alias,
        online: d.online,
        last_seen: d.last_seen,
        notes: d.notes,
      })),
      { onConflict: "id" }
    );
  }

  return NextResponse.json({ devices: merged, stale: false });
}

/**
 * POST /api/devices
 *
 * Manually register a device by its Nomix ID. Useful when the dongle isn't
 * yet reporting to the Nomix API but we already know the device_id and want
 * to attach accounts / warmup jobs to it. Upserts so the call is idempotent.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { id, alias } = (body ?? {}) as {
    id?: unknown;
    alias?: unknown;
  };
  if (typeof id !== "string" || id.trim().length === 0) {
    return NextResponse.json(
      { error: "id is required (string)" },
      { status: 400 }
    );
  }

  const aliasValue =
    typeof alias === "string" && alias.trim().length > 0 ? alias.trim() : null;

  const { data, error } = await supabase
    .from("devices")
    .upsert(
      { id: id.trim(), alias: aliasValue },
      { onConflict: "id" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ device: data }, { status: 201 });
}

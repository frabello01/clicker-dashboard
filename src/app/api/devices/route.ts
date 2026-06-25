import { NextResponse } from "next/server";
import { getNomixClient, NomixError } from "@/lib/nomix";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/devices
 *
 * Source of truth = Nomix `/devices`. We also persist a local row per device
 * so the UI can attach editable metadata (alias, notes) the Nomix panel
 * doesn't track. Returns the merged view.
 */
export async function GET() {
  const supabase = await createClient();
  const nomix = getNomixClient();

  // Fetch in parallel.
  const [{ data: localRows, error: localErr }, remoteRes] = await Promise.all([
    supabase.from("devices").select("*"),
    nomix.listDevices().then(
      (devices) => ({ devices, error: null as Error | null }),
      (error: Error) => ({ devices: null, error })
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
        devices: localRows ?? [],
        stale: true,
      },
      { status }
    );
  }

  const localById = new Map((localRows ?? []).map((r) => [r.id as string, r]));
  const remoteById = new Map(remoteRes.devices!.map((d) => [d.id, d]));
  // Union of both sources — locally-added devices that Nomix doesn't (yet)
  // know about still appear in the UI, marked offline.
  const allIds = new Set<string>([
    ...remoteById.keys(),
    ...localById.keys(),
  ]);
  const merged = [...allIds].map((id) => {
    const remote = remoteById.get(id);
    const local = localById.get(id);
    return {
      id,
      alias: local?.alias ?? remote?.alias ?? null,
      online: remote?.online ?? false,
      last_seen: remote?.last_seen ?? local?.last_seen ?? null,
      notes: local?.notes ?? null,
    };
  });

  // Upsert remote devices into the local cache so the offline-fallback path
  // can render them later. Skip the local-only rows — they're already there.
  const remoteOnly = merged.filter((d) => remoteById.has(d.id));
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

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
  const merged = remoteRes.devices!.map((d) => {
    const local = localById.get(d.id);
    return {
      id: d.id,
      alias: local?.alias ?? d.alias ?? null,
      online: d.online,
      last_seen: d.last_seen ?? local?.last_seen ?? null,
      notes: local?.notes ?? null,
    };
  });

  // Upsert remote devices into the local cache (best-effort, fire-and-forget).
  if (merged.length > 0) {
    await supabase.from("devices").upsert(
      merged.map((d) => ({
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

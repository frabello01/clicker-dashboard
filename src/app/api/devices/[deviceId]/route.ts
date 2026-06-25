import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;
  const body = (await req.json()) as { alias?: string | null; notes?: string | null };

  const update: Record<string, unknown> = {};
  if ("alias" in body) update.alias = body.alias;
  if ("notes" in body) update.notes = body.notes;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("devices")
    .update(update)
    .eq("id", deviceId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ device: data });
}

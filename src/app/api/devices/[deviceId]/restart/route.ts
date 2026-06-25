import { NextResponse } from "next/server";
import { getNomixClient, NomixError } from "@/lib/nomix";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;

  try {
    const result = await getNomixClient().restart(deviceId);
    return NextResponse.json({ result });
  } catch (err) {
    const status = err instanceof NomixError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}

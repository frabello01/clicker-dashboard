/**
 * POST /api/posts/reel — accept a video upload from the dashboard, forward it
 * to Telegram (sendDocument, uncompressed), and create a job for the worker
 * to execute the publish workflow on the phone.
 *
 * Form-data fields:
 *   - video      File (mp4/mov), required, max 50 MB
 *   - caption    string, optional
 *   - device_id  string, required
 *   - account_id uuid, optional (purely informational for now)
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendDocument } from "@/lib/telegram";
import { POST_REEL_KIND, newPostReelState } from "@/lib/workflows/postReel";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TELEGRAM_MAX_BYTES = 50 * 1024 * 1024; // sendDocument upload cap

export async function POST(req: Request) {
  const supabase = await createClient();

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const video = form.get("video");
  const caption = (form.get("caption") as string | null) ?? "";
  const deviceId = form.get("device_id") as string | null;
  const accountId = (form.get("account_id") as string | null) ?? null;

  if (!(video instanceof Blob)) {
    return NextResponse.json(
      { error: "`video` is required (file field)" },
      { status: 400 }
    );
  }
  if (!deviceId || deviceId.trim().length === 0) {
    return NextResponse.json(
      { error: "`device_id` is required" },
      { status: 400 }
    );
  }
  if (video.size === 0) {
    return NextResponse.json({ error: "video is empty" }, { status: 400 });
  }
  if (video.size > TELEGRAM_MAX_BYTES) {
    return NextResponse.json(
      {
        error: `video too large: ${Math.round(video.size / 1024 / 1024)} MB (max 50 MB for Telegram bot upload)`,
      },
      { status: 413 }
    );
  }

  // Filename: prefer client-provided File.name, else synthesize one.
  const filename =
    video instanceof File && video.name
      ? video.name
      : `reel-${Date.now()}.mp4`;

  // Step 1 — upload to Telegram as document (no compression).
  let telegramResult;
  try {
    telegramResult = await sendDocument(video, filename, {
      caption: caption ? `📥 ${filename}` : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: `Telegram upload failed: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 502 }
    );
  }

  // Step 2 — create a job for the worker to pick up and execute the publish flow.
  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      kind: POST_REEL_KIND,
      device_id: deviceId.trim(),
      account_id: accountId,
      payload: {
        caption,
        telegram_message_id: telegramResult.message_id,
        telegram_file_id: telegramResult.document_file_id,
        file_name: filename,
        file_size: telegramResult.file_size,
      },
      state: newPostReelState(),
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: `failed to create job: ${error.message}` },
      { status: 500 }
    );
  }
  return NextResponse.json(
    { job, telegram: telegramResult },
    { status: 201 }
  );
}

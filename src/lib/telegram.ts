/**
 * Telegram Bot API helper — used as a one-way bridge to deliver media
 * (videos, images) to the iPhone without iOS-side ingestion friction.
 *
 * Why `sendDocument` and not `sendVideo`?  `sendVideo` transcodes the file
 * (max 720p, reduced bitrate). `sendDocument` preserves the original bytes
 * — important for Reels quality. On the receiving phone the file appears
 * as an attachment that the workflow can save to Photos.
 *
 * Bot API upload cap is 50 MB per file. Plenty for typical IG Reels (≤15s).
 */

import { env } from "@/lib/env";

const API_BASE = "https://api.telegram.org";

export type TelegramSendResult = {
  message_id: number;
  document_file_id: string;
  document_file_unique_id: string;
  mime_type: string | null;
  file_size: number | null;
};

class TelegramError extends Error {
  constructor(
    public readonly errorCode: number,
    public readonly description: string
  ) {
    super(`Telegram API ${errorCode}: ${description}`);
    this.name = "TelegramError";
  }
}

/**
 * Send a file as a Document to the configured upload chat. Returns the
 * Telegram message_id + file_id (persist these — they're how the workflow
 * later identifies the file on the phone and how /api can re-fetch metadata
 * via Bot API).
 */
export async function sendDocument(
  file: Blob,
  filename: string,
  { caption }: { caption?: string } = {}
): Promise<TelegramSendResult> {
  const form = new FormData();
  form.set("chat_id", env.telegramUploadChatId);
  form.set("document", file, filename);
  if (caption) form.set("caption", caption);

  const res = await fetch(
    `${API_BASE}/bot${env.telegramBotToken}/sendDocument`,
    { method: "POST", body: form }
  );
  const body = (await res.json()) as {
    ok: boolean;
    result?: {
      message_id: number;
      document?: {
        file_id: string;
        file_unique_id: string;
        mime_type?: string;
        file_size?: number;
      };
    };
    error_code?: number;
    description?: string;
  };

  if (!body.ok || !body.result) {
    throw new TelegramError(
      body.error_code ?? res.status,
      body.description ?? "unknown error"
    );
  }
  const doc = body.result.document;
  if (!doc) {
    throw new TelegramError(
      0,
      "sendDocument returned no `document` (was the file sent as something else?)"
    );
  }
  return {
    message_id: body.result.message_id,
    document_file_id: doc.file_id,
    document_file_unique_id: doc.file_unique_id,
    mime_type: doc.mime_type ?? null,
    file_size: doc.file_size ?? null,
  };
}

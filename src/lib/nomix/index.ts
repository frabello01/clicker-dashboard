/**
 * NomixClicker client factory. Use `getNomixClient()` everywhere; it returns
 * the real REST client or the mock based on NOMIX_USE_MOCK.
 */

import { env } from "@/lib/env";
import { NomixClient, type INomixClient } from "./client";
import { MockNomixClient } from "./mock";

let _client: INomixClient | null = null;

export function getNomixClient(): INomixClient {
  if (_client) return _client;

  if (env.nomixUseMock) {
    _client = new MockNomixClient();
  } else {
    if (!env.nomixApiKey) {
      throw new Error(
        "NOMIX_API_KEY is not set. Either set it or enable NOMIX_USE_MOCK=true for development."
      );
    }
    _client = new NomixClient(env.nomixApiKey, env.nomixApiUrl);
  }

  return _client;
}

export { NomixError } from "./client";
export type { INomixClient } from "./client";
export type * from "./types";

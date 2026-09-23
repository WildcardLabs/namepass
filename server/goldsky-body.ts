import { ApiError } from "./http";

/** Keep bounded evidence even when JSON decoding fails. The caller authenticates first. */
export async function readGoldskyBody(request: Request): Promise<{ bytes: Uint8Array; truncated: boolean }> {
 const limit = 8192;
 const reader = request.body?.getReader();
 if (!reader) return { bytes: new Uint8Array(), truncated: false };
 const bytes = new Uint8Array(limit);
 let length = 0;
 try {
  while (true) {
   const part = await reader.read();
   if (part.done) return { bytes: bytes.slice(0, length), truncated: false };
   const take = Math.min(part.value.length, limit - length);
   bytes.set(part.value.subarray(0, take), length);
   length += take;
   if (take < part.value.length) {
    await reader.cancel();
    return { bytes, truncated: true };
   }
  }
 } finally { reader.releaseLock(); }
}

export function decodeGoldskyBody(bytes: Uint8Array): Record<string, unknown> {
 let value: unknown;
 try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
 catch { throw new ApiError(400, "invalid_json", "The request body must be valid JSON."); }
 if (!value || typeof value !== "object" || Array.isArray(value)) {
  throw new ApiError(400, "invalid_request", "The request body must be an object.");
 }
 return value as Record<string, unknown>;
}

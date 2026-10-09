export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "invalid-content-type" | "too-large" | "invalid-json" | "read-failed" };

export type BoundedTextResult =
  | { ok: true; value: string }
  | { ok: false; reason: "too-large" | "invalid-utf8" | "read-failed" };

function hasJsonContentType(request: Request) {
  return /^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "");
}

/** Reads a bounded request stream before decoding or parsing it. */
export async function readBoundedJson(
  request: Request,
  maxBytes: number,
  options: { requireContentType?: boolean } = {},
): Promise<BoundedJsonResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("A positive request body limit is required.");
  }
  if (options.requireContentType !== false && !hasJsonContentType(request)) {
    return { ok: false, reason: "invalid-content-type" };
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    return { ok: false, reason: "too-large" };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const reader = request.body?.getReader();
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, reason: "too-large" };
        }
        chunks.push(value);
      }
    } catch {
      return { ok: false, reason: "read-failed" };
    } finally {
      reader.releaseLock();
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown };
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
}

/** Reads the exact request text under a byte cap; useful for signed webhooks. */
export async function readBoundedText(request: Request, maxBytes: number): Promise<BoundedTextResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("A positive request body limit is required.");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    return { ok: false, reason: "too-large" };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const reader = request.body?.getReader();
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, reason: "too-large" };
        }
        chunks.push(value);
      }
    } catch {
      return { ok: false, reason: "read-failed" };
    } finally {
      reader.releaseLock();
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: "invalid-utf8" };
  }
}

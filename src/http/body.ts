import { HttpRequestError } from "./errors.ts";

function contentLength(
  request: Request,
): number | null {
  const raw = request.headers.get("content-length");
  if (raw === null) return null;

  const parsed = Number(raw);
  if (
    !Number.isInteger(parsed) ||
    parsed < 0
  ) {
    throw new HttpRequestError(
      400,
      "INVALID_CONTENT_LENGTH",
      "Invalid Content-Length header",
    );
  }

  return parsed;
}

function assertJsonContentType(request: Request): void {
  const raw = request.headers.get("content-type");
  const mediaType = raw
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();

  if (mediaType !== "application/json") {
    throw new HttpRequestError(
      415,
      "JSON_CONTENT_TYPE_REQUIRED",
      "Content-Type must be application/json",
    );
  }
}

export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  assertJsonContentType(request);

  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new Error("maxBytes must be a positive integer");
  }

  const declaredLength = contentLength(request);
  if (
    declaredLength !== null &&
    declaredLength > maxBytes
  ) {
    throw new HttpRequestError(
      413,
      "REQUEST_BODY_TOO_LARGE",
      "Request body is too large",
    );
  }

  if (!request.body) {
    throw new HttpRequestError(
      400,
      "REQUEST_BODY_REQUIRED",
      "Request body is required",
    );
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new HttpRequestError(
          413,
          "REQUEST_BODY_TOO_LARGE",
          "Request body is too large",
        );
      }

      text += decoder.decode(value, {
        stream: true,
      });
    }

    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  if (!text.trim()) {
    throw new HttpRequestError(
      400,
      "REQUEST_BODY_REQUIRED",
      "Request body is required",
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpRequestError(
      400,
      "INVALID_JSON",
      "Request body must be valid JSON",
    );
  }
}

import { put } from "@vercel/blob";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyFirebaseRequest } from "../_firebaseAdmin.js";

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  "application/json",
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/plain",
]);

function sendError(response: VercelResponse, status: number, error: string): void {
  response.status(status).json({ error });
}

function sanitizeFilename(filename: string): string {
  const basename = filename.replace(/\\/g, "/").split("/").pop() ?? "upload";
  const sanitized = basename
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return sanitized || "upload";
}

async function readMultipartFile(request: VercelRequest): Promise<File | null> {
  const contentType = request.headers["content-type"];
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) return null;

  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FILE_BYTES + 256 * 1024) {
    throw new RangeError("Request is too large.");
  }

  let rawBody: Uint8Array<ArrayBuffer>;
  if (Buffer.isBuffer(request.body)) {
    rawBody = new Uint8Array(request.body.byteLength);
    rawBody.set(request.body);
  } else {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let totalBytes = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      totalBytes += buffer.byteLength;
      if (totalBytes > MAX_FILE_BYTES + 256 * 1024) {
        throw new RangeError("Request is too large.");
      }
      const bytes = new Uint8Array(buffer.byteLength);
      bytes.set(buffer);
      chunks.push(bytes);
    }
    rawBody = new Uint8Array(totalBytes);
    let offset = 0;
    for (const bytes of chunks) {
      rawBody.set(bytes, offset);
      offset += bytes.byteLength;
    }
  }
  if (rawBody.byteLength > MAX_FILE_BYTES + 256 * 1024) {
    throw new RangeError("Request is too large.");
  }

  const webRequest = new Request("https://local.invalid/api/blob/public-upload", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: rawBody,
  });
  const form = await webRequest.formData();
  const value = form.get("file");
  return value instanceof File ? value : null;
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendError(response, 405, "Method not allowed.");
    return;
  }

  try {
    const decodedToken = await verifyFirebaseRequest(request);
    if (!decodedToken) {
      sendError(response, 401, "Authentication required or token expired.");
      return;
    }

    const file = await readMultipartFile(request);
    if (!file) {
      sendError(response, 400, "Expected multipart form field named file.");
      return;
    }
    if (file.size === 0 || file.size > MAX_FILE_BYTES) {
      sendError(response, 413, "File must be between 1 byte and 4 MiB.");
      return;
    }
    if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
      sendError(response, 415, "File type is not supported.");
      return;
    }

    const filename = sanitizeFilename(file.name);
    const blob = await put(`public/users/${decodedToken.uid}/${filename}`, file, {
      access: "public",
      addRandomSuffix: true,
      contentType: file.type,
    });

    response.status(201).json(blob);
  } catch (error: unknown) {
    if (error instanceof RangeError) {
      sendError(response, 413, error.message);
      return;
    }

    console.error("[Public Blob upload] Request failed", error);
    sendError(response, 500, "Upload failed.");
  }
}
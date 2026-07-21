import { put } from "@vercel/blob";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyFirebaseRequest } from "../_firebaseAdmin.js";

const MAX_CONTENT_BYTES = 1024 * 1024;

interface UploadRequestBody {
  pathname: string;
  content: string;
  contentType?: string;
}

function parseBody(body: unknown): UploadRequestBody | null {
  let value = body;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }

  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.pathname !== "string" || typeof record.content !== "string") {
    return null;
  }
  if (record.contentType !== undefined && typeof record.contentType !== "string") {
    return null;
  }

  return {
    pathname: record.pathname,
    content: record.content,
    contentType: record.contentType,
  };
}

function sanitizePathname(pathname: string): string | null {
  const normalized = pathname.trim().replace(/\\/g, "/");
  if (!normalized || normalized.length > 240 || normalized.startsWith("/")) return null;

  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.length > 80 ||
        !/^[a-zA-Z0-9._-]+$/.test(segment),
    )
  ) {
    return null;
  }

  return segments.join("/");
}

function sendError(response: VercelResponse, status: number, error: string): void {
  response.status(status).json({ error });
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

  const body = parseBody(request.body as unknown);
  if (!body) {
    sendError(response, 400, "Expected pathname and string content.");
    return;
  }

  const pathname = sanitizePathname(body.pathname);
  if (!pathname) {
    sendError(response, 400, "Invalid pathname.");
    return;
  }

  const contentBytes = Buffer.byteLength(body.content, "utf8");
  if (contentBytes === 0 || contentBytes > MAX_CONTENT_BYTES) {
    sendError(response, 413, "Content must be between 1 byte and 1 MiB.");
    return;
  }

  const contentType = body.contentType ?? "text/plain; charset=utf-8";
  if (!/^(text\/[a-z0-9.+-]+|application\/json)(?:\s*;.*)?$/i.test(contentType)) {
    sendError(response, 415, "Only text and JSON content types are supported.");
    return;
  }

  try {
    const decodedToken = await verifyFirebaseRequest(request);
    if (!decodedToken) {
      sendError(response, 401, "Authentication required or token expired.");
      return;
    }

    const blob = await put(`users/${decodedToken.uid}/${pathname}`, body.content, {
      access: "private",
      contentType,
      addRandomSuffix: true,
    });

    response.status(201).json({
      pathname: blob.pathname,
      url: blob.url,
      contentType: blob.contentType,
    });
  } catch (error: unknown) {
    console.error("[Blob upload] Request failed", error);
    sendError(response, 500, "Upload failed.");
  }
}
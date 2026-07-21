import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import type { VercelRequest } from "@vercel/node";

const FIREBASE_PROJECT_ID = "personal-wealth-os-1deac";

function isServiceAccount(value: unknown): value is {
  project_id: string;
  client_email: string;
  private_key: string;
} {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.project_id === FIREBASE_PROJECT_ID &&
    typeof record.client_email === "string" &&
    typeof record.private_key === "string"
  );
}

function initializeFirebaseAdmin(): void {
  if (getApps().length > 0) return;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    const parsed: unknown = JSON.parse(serviceAccountJson);
    if (!isServiceAccount(parsed)) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is invalid.");
    }

    initializeApp({
      credential: cert({
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key.replace(/\\n/g, "\n"),
      }),
      projectId: parsed.project_id,
    });
    return;
  }

  initializeApp({
    credential: applicationDefault(),
    projectId: FIREBASE_PROJECT_ID,
  });
}

function readBearerToken(request: VercelRequest): string | null {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

export async function verifyFirebaseRequest(
  request: VercelRequest,
): Promise<DecodedIdToken | null> {
  const token = readBearerToken(request);
  if (!token) return null;

  initializeFirebaseAdmin();
  try {
    return await getAuth().verifyIdToken(token, true);
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code?.startsWith("auth/")) return null;
    throw error;
  }
}
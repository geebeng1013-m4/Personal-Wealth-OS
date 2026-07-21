import { currentUser } from "./firebase";

export interface PrivateBlobUploadResult {
  pathname: string;
  url: string;
  contentType: string;
}

export interface PublicBlobUploadResult extends PrivateBlobUploadResult {
  downloadUrl: string;
}

interface UploadErrorBody {
  error?: string;
}

export async function uploadPrivateTextBlob(
  pathname: string,
  content: string,
  contentType = "text/plain; charset=utf-8",
): Promise<PrivateBlobUploadResult> {
  const user = currentUser();
  if (!user) throw new Error("Sign in before uploading a file.");

  const idToken = await user.getIdToken();
  const response = await fetch("/api/blob/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pathname, content, contentType }),
  });

  if (!response.ok) {
    let errorBody: UploadErrorBody = {};
    try {
      errorBody = (await response.json()) as UploadErrorBody;
    } catch {
      // The status code remains useful when an upstream returns a non-JSON error.
    }
    throw new Error(errorBody.error ?? `Blob upload failed (${response.status}).`);
  }

  return (await response.json()) as PrivateBlobUploadResult;
}

export async function uploadPublicFileBlob(file: File): Promise<PublicBlobUploadResult> {
  const user = currentUser();
  if (!user) throw new Error("Sign in before uploading a file.");

  const idToken = await user.getIdToken();
  const form = new FormData();
  form.set("file", file);

  const response = await fetch("/api/blob/public-upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` },
    body: form,
  });

  if (!response.ok) {
    let errorBody: UploadErrorBody = {};
    try {
      errorBody = (await response.json()) as UploadErrorBody;
    } catch {
      // The status code remains useful when an upstream returns a non-JSON error.
    }
    throw new Error(errorBody.error ?? `Public Blob upload failed (${response.status}).`);
  }

  return (await response.json()) as PublicBlobUploadResult;
}
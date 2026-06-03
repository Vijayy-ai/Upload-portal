// In dev: Vite proxy forwards /api/* to the real backend (no CORS).
// In production build: VITE_API_BASE must be set to the full backend URL.
const IS_DEV = import.meta.env.DEV;
const API_BASE = IS_DEV
  ? "" // relative → Vite proxy handles it (see vite.config.js)
  : (import.meta.env.API_URL || import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

const defaultHeaders = () => {
  const h = {
    "Content-Type": "application/json",
    // ngrok free tier interstitial bypass (Vite proxy also sets this server-side)
    "ngrok-skip-browser-warning": "1",
  };
  return h;
};


function authHeaders(token) {
  // Backend (Django SimpleJWT) is configured with AUTH_HEADER_TYPES = ('JWT',)
  return token ? { Authorization: `JWT ${token}` } : {};
}

async function parseJsonSafe(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function otpSend(phone_number) {
  const res = await fetch(`${API_BASE}/api/v1/auth/otp/send/`, {
    method: "POST",
    headers: { ...defaultHeaders() },
    body: JSON.stringify({ phone_number }),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data?.message || "Could not send code");
  return data;
}

export async function otpVerify(phone_number, otp) {
  const res = await fetch(`${API_BASE}/api/v1/auth/otp/verify/`, {
    method: "POST",
    headers: { ...defaultHeaders() },
    body: JSON.stringify({ phone_number, otp }),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data?.message || "Could not verify code");
  return data;
}

export async function otpResend(phone_number) {
  const res = await fetch(`${API_BASE}/api/v1/auth/otp/resend/`, {
    method: "POST",
    headers: { ...defaultHeaders() },
    body: JSON.stringify({ phone_number }),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data?.message || "Could not resend code");
  return data;
}

export async function fetchMyProfile(token) {
  const url = `${API_BASE}/api/v1/auth/profiles/me/`;
  const opts = {
    method: "GET",
    headers: { ...defaultHeaders(), ...authHeaders(token) },
  };
  // Dev proxy → ngrok can drop TLS mid-handshake; a couple of retries avoids an empty UI for minutes.
  let res;
  let lastNetworkErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(url, opts);
      lastNetworkErr = undefined;
      break;
    } catch (e) {
      lastNetworkErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  if (!res) throw lastNetworkErr || new Error("Could not reach server");
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    const err = new Error(data?.detail || data?.message || "Could not load profile");
    err.status = res.status; // so callers can check 401 vs 5xx
    throw err;
  }
  return data;
}

export async function shortfilmUploadStart(token, payload) {
  const res = await fetch(`${API_BASE}/api/v1/shortfilm/upload/start/`, {
    method: "POST",
    headers: { ...defaultHeaders(), ...authHeaders(token) },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data?.error || "Could not start upload");
  return data;
}

export async function shortfilmMultipartComplete(token, payload) {
  const res = await fetch(`${API_BASE}/api/v1/shortfilm/upload/multipart/complete/`, {
    method: "POST",
    headers: { ...defaultHeaders(), ...authHeaders(token) },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data?.error || "Could not finish upload");
  return data;
}

/** After successful single PUT to S3 — marks VideoUpload as processing (same as multipart complete). */
export async function shortfilmUploadComplete(token, payload) {
  const res = await fetch(`${API_BASE}/api/v1/shortfilm/upload/complete/`, {
    method: "POST",
    headers: { ...defaultHeaders(), ...authHeaders(token) },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data?.error || "Could not finalize upload");
  return data;
}

export async function shortfilmThumbnailPresign(token, payload) {
  const res = await fetch(`${API_BASE}/api/v1/shortfilm/thumbnails/presign/`, {
    method: "POST",
    headers: { ...defaultHeaders(), ...authHeaders(token) },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data?.error || "Could not prepare image");
  return data;
}

export async function s3Put(url, body, contentType) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    
    xhr.upload.addEventListener("progress", (event) => {
      // Optional: progress could be tracked here if needed
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(true);
      } else {
        reject(new Error(`S3 upload failed (${xhr.status}): ${xhr.responseText || "No details"}`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error(`Network error during S3 upload. Status: ${xhr.status}`));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("S3 upload was aborted"));
    });

    xhr.open("PUT", url);

    // Only add headers if explicitly provided (to match exact signature)
    if (contentType) {
      xhr.setRequestHeader("Content-Type", contentType);
    }
    
    // Some AWS setups require this if signed, but usually it's fine
    // xhr.setRequestHeader("x-requested-with", "XMLHttpRequest");

    // Send the blob/file directly
    xhr.send(body);
  });
}

async function s3PutPartWithRetry(url, blob, retries = 5) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "ngrok-skip-browser-warning": "1" },
        body: blob,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`${res.status}${t ? ` — ${t.slice(0, 120)}` : ""}`);
      }
      const etag = res.headers.get("etag") || res.headers.get("ETag");
      if (!etag) throw new Error("Missing verification from storage");
      return etag;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, Math.min(400 * (attempt + 1), 2500)));
    }
  }
  throw lastErr;
}

/**
 * Multipart chunked upload — handles unstable networks by retrying parts.
 */
export async function uploadFileMultipart(file, mp, onProgress) {
  const chunk = mp.chunk_size;
  const totalParts = mp.total_parts || mp.presigned_urls?.length || 0;
  if (!chunk || !totalParts) throw new Error("Invalid upload preparation");

  const parts = [];
  for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
    const start = (partNumber - 1) * chunk;
    const end = Math.min(start + chunk, file.size);
    const slice = file.slice(start, end);
    const entry = mp.presigned_urls?.find?.((p) => p.partNumber === partNumber);
    const url = entry?.url || entry?.Url;
    if (!url) throw new Error(`Missing link for segment ${partNumber}`);
    const etag = await s3PutPartWithRetry(url, slice);
    parts.push({ PartNumber: partNumber, ETag: etag });

    const done = Math.min(end / Math.max(file.size, 1), 1);
    onProgress?.(done);
  }
  return parts;
}

import crypto from "crypto";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const GEMINI_ENDPOINT = process.env.GEMINI_ENDPOINT || "https://generativelanguage.googleapis.com";

// Files are deleted after 48 hours (172800 seconds)
const FILE_EXPIRY_SECONDS = 47.5 * 3600;

function sha256Hex(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

function isFileExpired(uploadedAt) {
  if (!uploadedAt) return true;
  const now = new Date();
  const uploaded = new Date(uploadedAt);
  const secondsOld = (now - uploaded) / 1000;
  return secondsOld > FILE_EXPIRY_SECONDS;
}

export function computeInputMeta({ kind, mime_type, buffer, url }) {
  return {
    kind,
    mime_type,
    size_bytes: buffer?.length ?? null,
    sha256: buffer ? sha256Hex(buffer) : null,
    url: url || null
  };
}

async function uploadToFilesAPI(buffer, mime_type, displayName = "uploaded_image") {

  const uploadUrl = `${GEMINI_ENDPOINT}/upload/v1beta/files?key=${GEMINI_API_KEY}`;

  const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
  const chunks = [];

  chunks.push(`--${boundary}\r\n`);
  chunks.push(`Content-Disposition: form-data; name="metadata"\r\n`);
  chunks.push(`Content-Type: application/json; charset=UTF-8\r\n\r\n`);
  chunks.push(JSON.stringify({ file: { displayName } }));
  chunks.push(`\r\n`);

  chunks.push(`--${boundary}\r\n`);
  chunks.push(`Content-Disposition: form-data; name="file"; filename="image"\r\n`);
  chunks.push(`Content-Type: ${mime_type}\r\n\r\n`);
  chunks.push(buffer);
  chunks.push(`\r\n--${boundary}--\r\n`);

  const body = Buffer.concat(chunks.map(chunk =>
    typeof chunk === 'string' ? Buffer.from(chunk) : chunk
  ));

  const uploadResp = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "X-Goog-Upload-Protocol": "multipart",
    },
    body,
  });

  if (!uploadResp.ok) {
    const text = await uploadResp.text();
    throw new Error(`Files API upload failed (${uploadResp.status}): ${text}`);
  }

  const uploadJson = await uploadResp.json();
  return uploadJson.file;
}

export async function uploadReferenceImage({ buffer, mime_type, displayName }) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set");
  }

  const uploadedFile = await uploadToFilesAPI(buffer, mime_type, displayName || "sample_image");
  const input = computeInputMeta({ kind: "sample", mime_type: uploadedFile.mimeType, buffer, url: uploadedFile.uri });

  return {
    file_uri: uploadedFile.uri,
    mime_type: uploadedFile.mimeType,
    input,
    uploaded_at: new Date().toISOString(),
  };
}

export function isReferenceFileExpired(uploadedAt) {
  return isFileExpired(uploadedAt);
}

export async function callGeminiVision({ buffer, mime_type, prompt, references = [] }) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set");
  }

  const uploadedFile = await uploadToFilesAPI(buffer, mime_type);

  const url = `${GEMINI_ENDPOINT}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const parts = [];
  if (prompt) {
    parts.push({ text: prompt });
  }

  // Add reference samples (already uploaded files) so model can match
  for (const ref of references) {
    if (!ref?.file_uri) continue;
    if (ref.label) {
      parts.push({ text: `Reference sample: ${ref.label}` });
    }
    parts.push({
      file_data: {
        mime_type: ref.mime_type,
        file_uri: ref.file_uri,
      },
    });
  }

  // Add the target image we just uploaded
  parts.push({
    text: "Target image to identify",
  });
  parts.push({
    file_data: {
      mime_type: uploadedFile.mimeType,
      file_uri: uploadedFile.uri,
    },
  });

  const requestBody = {
    contents: [
      {
        parts,
      },
    ],
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error(`Gemini API error (${resp.status}): ${text}`);
    err.status = resp.status;
    err.responseText = text;
    throw err;
  }

  const json = await resp.json();

  if (json.promptFeedback?.blockReason) {
    const err = new Error(`Prompt blocked: ${json.promptFeedback.blockReason}`);
    err.blockReason = json.promptFeedback.blockReason;
    err.safetyRatings = json.promptFeedback.safetyRatings;
    throw err;
  }

  const candidate = json?.candidates?.[0];
  if (!candidate) {
    throw new Error("No candidates returned from Gemini");
  }

  if (candidate.finishReason && candidate.finishReason !== "STOP") {
    console.warn(`Gemini finish reason: ${candidate.finishReason}`);
  }

  const textPart = candidate?.content?.parts?.find?.((p) => p.text)?.text;
  const label = textPart ? textPart.trim() : null;

  return {
    raw: json,
    label,
    finishReason: candidate.finishReason,
    safetyRatings: candidate.safetyRatings,
  };
}
import { pool } from "../lib/db.js";
import { computeInputMeta, callGeminiVision, isReferenceFileExpired, uploadReferenceImage } from "../lib/gemini.js";
import multer from "multer";

const MAX_BYTES = 20 * 1024 * 1024; // 20MB limit for uploads

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, WEBP, HEIC, HEIF allowed'));
    }
  },
}).single('image');

export const uploadMiddleware = upload;

export async function createDetection(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "image file required" });
    }

    const { prompt, product_id } = req.body;
    const buffer = req.file.buffer;
    const mime_type = req.file.mimetype;

    const references = [];
    if (product_id) {
      const { rows: prodRows } = await pool.query(
        `SELECT id, name, sample_file_uri, sample_mime, sample_file_uploaded_at, sample_file_path, sample_input FROM product WHERE id = $1 AND merchant_id = $2`,
        [product_id, req.user.merchant_id]
      );
      if (!prodRows[0]) {
        return res.status(404).json({ error: "product not found" });
      }
      const prod = prodRows[0];
      if (prod.sample_file_uri) {
        // Check if file is expired
        let fileUri = prod.sample_file_uri;
        let fileMime = prod.sample_mime || mime_type;

        if (isReferenceFileExpired(prod.sample_file_uploaded_at)) {
          console.log(`Product sample file expired (${prod.id}), re-uploading from disk`);
          if (prod.sample_file_path) {
            const buffer = await readSampleFromDisk(prod.sample_file_path);
            if (buffer) {
              try {
                const reuploadedSample = await uploadReferenceImage({
                  buffer,
                  mime_type: fileMime,
                  displayName: `${prod.name}-sample`
                });
                fileUri = reuploadedSample.file_uri;
                fileMime = reuploadedSample.mime_type;

                // Update database with new file URI and timestamp
                await pool.query(
                  `UPDATE product SET sample_file_uri = $1, sample_file_uploaded_at = $2 WHERE id = $3`,
                  [fileUri, reuploadedSample.uploaded_at, prod.id]
                );
              } catch (err) {
                console.error(`Failed to re-upload sample for product ${prod.id}:`, err);
                fileUri = null;
              }
            }
          }
        }

        if (fileUri) {
          references.push({
            file_uri: fileUri,
            mime_type: fileMime,
            label: `Product ${prod.name || prod.id}`
          });
        }
      }
    }

    const inputMeta = computeInputMeta({ kind: "inline", mime_type, buffer });

    // Call Gemini with optional reference samples
    const result = await callGeminiVision({ buffer, mime_type, prompt, references });

    const { rows } = await pool.query(
      `INSERT INTO detection (merchant_id, product_id, status, label, llm_response, input)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, merchant_id, product_id, status, label, llm_response, input, created_at`,
      [req.user.merchant_id, product_id || null, "completed", result.label, result.raw, inputMeta]
    );

    res.status(201).json({ detection: rows[0] });
  } catch (err) {
    console.error("createDetection error", err);
    if (err.responseText) {
      console.error("gemini response", err.responseText);
    }
    res.status(500).json({ error: "Failed to process detection" });
  }
}

export async function listDetections(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT id, product_id, status, label, llm_response, input, created_at
       FROM detection WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.merchant_id]
    );
    res.json({ detections: rows });
  } catch (err) {
    console.error("listDetections error", err);
    res.status(500).json({ error: "Failed to list detections" });
  }
}
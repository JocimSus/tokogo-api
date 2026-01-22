import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import { pool } from '../lib/db.js';
import { uploadReferenceImage } from "../lib/gemini.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplesDir = path.join(__dirname, '../../public/samples');

async function ensureSamplesDir() {
  try {
    await fs.mkdir(samplesDir, { recursive: true });
  } catch (err) {
    console.error('Failed to create samples directory:', err);
  }
}
ensureSamplesDir();

const MAX_BYTES = 10 * 1024 * 1024;
const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (allowedMimes.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Invalid file type. Only JPEG, PNG, WEBP, HEIC, HEIF allowed'));
  },
}).single('sample_image');

export const uploadSampleMiddleware = upload;

function asPrice(val) {
  const num = Number(val);
  if (!Number.isFinite(num) || num < 0) return null;
  return Number(num.toFixed(2));
}

async function saveSampleLocally(merchantId, productId, buffer, mimeType) {
  const ext = mimeType.split('/')[1] || 'jpg';
  const productDir = path.join(samplesDir, merchantId, productId);
  await fs.mkdir(productDir, { recursive: true });

  const filename = `sample.${ext}`;
  const filepath = path.join(productDir, filename);
  await fs.writeFile(filepath, buffer);

  // Return relative path for storage in DB
  return path.join('samples', merchantId, productId, filename);
}

async function readSampleFromDisk(localPath) {
  try {
    const fullPath = path.join(__dirname, '../../public', localPath);
    return await fs.readFile(fullPath);
  } catch (err) {
    console.error('Failed to read sample from disk:', err);
    return null;
  }
}

export async function createProduct(req, res) {
  try {
    const { name, price, metadata } = req.body;
    if (!name || price == null) return res.status(400).json({ error: 'name and price required' });
    const p = asPrice(price);
    if (p == null) return res.status(400).json({ error: 'invalid price' });
    const meta = typeof metadata === 'object' && metadata !== null ? metadata : {};

    let sample = null;
    let localPath = null;
    if (req.file) {
      // Save to disk first
      localPath = await saveSampleLocally(req.user.merchant_id, 'temp', req.file.buffer, req.file.mimetype);

      // Upload to Gemini
      sample = await uploadReferenceImage({
        buffer: req.file.buffer,
        mime_type: req.file.mimetype,
        displayName: `${name}-sample`
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO product (merchant_id, name, price, metadata, sample_file_uri, sample_mime, sample_input, sample_file_uploaded_at, sample_file_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, name, price, metadata, sample_file_uri, sample_mime, sample_input, sample_file_uploaded_at, sample_file_path, created_at` ,
      [req.user.merchant_id, name, p, meta, sample?.file_uri || null, sample?.mime_type || null, sample?.input || {}, sample?.uploaded_at || null, localPath || null]
    );

    const product = rows[0];

    // Update sample file path with actual product ID
    if (localPath) {
      const newLocalPath = await saveSampleLocally(req.user.merchant_id, product.id, req.file.buffer, req.file.mimetype);
      await pool.query(
        `UPDATE product SET sample_file_path = $1 WHERE id = $2`,
        [newLocalPath, product.id]
      );
      product.sample_file_path = newLocalPath;
    }

    res.status(201).json({ product });
  } catch (err) {
    console.error('createProduct error', err);
    res.status(500).json({ error: 'Failed to create product' });
  }
}

export async function listProducts(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, price, metadata, sample_file_uri, sample_mime, sample_input, sample_file_uploaded_at, sample_file_path, is_active, created_at
       FROM product WHERE merchant_id = $1 ORDER BY created_at DESC`,
      [req.user.merchant_id]
    );
    res.json({ products: rows });
  } catch (err) {
    console.error('listProducts error', err);
    res.status(500).json({ error: 'Failed to list products' });
  }
}

export async function getProduct(req, res) {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT id, name, price, metadata, sample_file_uri, sample_mime, sample_input, sample_file_uploaded_at, sample_file_path, is_active, created_at
       FROM product WHERE id = $1 AND merchant_id = $2`,
      [id, req.user.merchant_id]
    );
    const prod = rows[0];
    if (!prod) return res.status(404).json({ error: 'Not found' });
    res.json({ product: prod });
  } catch (err) {
    console.error('getProduct error', err);
    res.status(500).json({ error: 'Failed to get product' });
  }
}

export async function updateProduct(req, res) {
  try {
    const { id } = req.params;
    const fields = [];
    const values = [];
    let idx = 1;
    if (req.body.name) { fields.push(`name = $${idx++}`); values.push(req.body.name); }
    if (req.body.price != null) {
      const p = asPrice(req.body.price);
      if (p == null) return res.status(400).json({ error: 'invalid price' });
      fields.push(`price = $${idx++}`); values.push(p);
    }
    if (req.body.metadata) {
      fields.push(`metadata = $${idx++}`); values.push(req.body.metadata);
    }
    if (req.body.is_active != null) {
      fields.push(`is_active = $${idx++}`); values.push(Boolean(req.body.is_active));
    }

    if (req.file) {
      const sample = await uploadReferenceImage({
        buffer: req.file.buffer,
        mime_type: req.file.mimetype,
        displayName: `${req.body.name || 'product'}-sample`
      });
      const localPath = await saveSampleLocally(req.user.merchant_id, id, req.file.buffer, req.file.mimetype);
      fields.push(`sample_file_uri = $${idx++}`); values.push(sample.file_uri);
      fields.push(`sample_mime = $${idx++}`); values.push(sample.mime_type);
      fields.push(`sample_input = $${idx++}`); values.push(sample.input);
      fields.push(`sample_file_uploaded_at = $${idx++}`); values.push(sample.uploaded_at);
      fields.push(`sample_file_path = $${idx++}`); values.push(localPath);
    }

    if (fields.length === 0) return res.status(400).json({ error: 'no fields to update' });
    fields.push(`updated_at = now()`);
    values.push(id); values.push(req.user.merchant_id);

    const { rowCount, rows } = await pool.query(
      `UPDATE product SET ${fields.join(', ')} WHERE id = $${idx++} AND merchant_id = $${idx++}
       RETURNING id, name, price, metadata, sample_file_uri, sample_mime, sample_input, sample_file_uploaded_at, sample_file_path, is_active, created_at, updated_at`,
      values
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ product: rows[0] });
  } catch (err) {
    console.error('updateProduct error', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
}

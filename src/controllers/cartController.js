import { pool } from "../lib/db.js";

export async function createReceipt(req, res) {
  try {
    const { items } = req.body;
    const merchant_id = req.user.merchant_id;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items array required" });
    }

    for (const item of items) {
      if (!item.product_id || !item.quantity || item.quantity <= 0) {
        return res.status(400).json({ error: "each item must have product_id and quantity > 0" });
      }
    }

    const productIds = items.map(i => i.product_id);
    const { rows: products } = await pool.query(
      `SELECT id, price FROM product WHERE id = ANY($1) AND merchant_id = $2`,
      [productIds, merchant_id]
    );

    if (products.length !== new Set(productIds).size) {
      return res.status(404).json({ error: "some products not found or not owned by merchant" });
    }

    const priceMap = Object.fromEntries(products.map(p => [p.id, parseFloat(p.price)]));

    let totalAmount = 0;
    const enrichedItems = items.map(item => {
      const unitPrice = priceMap[item.product_id];
      const subtotal = unitPrice * item.quantity;
      totalAmount += subtotal;
      return {
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: unitPrice,
        subtotal
      };
    });

    // Create receipt
    const { rows } = await pool.query(
      `INSERT INTO receipt (merchant_id, total_amount, items)
       VALUES ($1, $2, $3)
       RETURNING id, merchant_id, total_amount, items, created_at`,
      [merchant_id, totalAmount, JSON.stringify(enrichedItems)]
    );

    res.status(201).json({ receipt: rows[0] });
  } catch (err) {
    console.error("createReceipt error", err);
    res.status(500).json({ error: "Failed to create receipt" });
  }
}

export async function getReceipts(req, res) {
  try {
    const merchant_id = req.user.merchant_id;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const { rows } = await pool.query(
      `SELECT id, merchant_id, total_amount, items, created_at
       FROM receipt
       WHERE merchant_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [merchant_id, limit, offset]
    );

    res.json({ receipts: rows });
  } catch (err) {
    console.error("getReceipts error", err);
    res.status(500).json({ error: "Failed to fetch receipts" });
  }
}

export async function getReceiptDetail(req, res) {
  try {
    const { receipt_id } = req.params;
    const merchant_id = req.user.merchant_id;

    const { rows } = await pool.query(
      `SELECT id, merchant_id, total_amount, items, created_at
       FROM receipt
       WHERE id = $1 AND merchant_id = $2`,
      [receipt_id, merchant_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Receipt not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("getReceiptDetail error", err);
    res.status(500).json({ error: "Failed to fetch receipt" });
  }
}

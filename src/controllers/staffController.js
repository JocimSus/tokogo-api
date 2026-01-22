import { pool } from "../lib/db.js";

const ALLOWED_ROLES = new Set(["manager", "cashier"]);

export async function createStaff(req, res) {
  try {
    const { role } = req.body;
    if (!role) {
      return res.status(400).json({ error: "role required manager or cashier" });
    }
    if (!ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ error: "invalid role. use manager or cashier" });
    }

    const { rows } = await pool.query(
      `INSERT INTO staff (merchant_id, role)
       VALUES ($1, $2)
       RETURNING id, merchant_id, role, created_at`,
      [req.user.merchant_id, role]
    );

    res.status(201).json({ staff: rows[0] });
  } catch (err) {
    console.error("createStaff error", err);
    res.status(500).json({ error: "Failed to create staff" });
  }
}

export async function listStaff(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT id, merchant_id, role, name, created_at
       FROM staff
       WHERE merchant_id = $1
       ORDER BY role, created_at DESC`,
      [req.user.merchant_id]
    );
    res.json({ staff: rows });
  } catch (err) {
    console.error("listStaff error", err);
    res.status(500).json({ error: "Failed to list staff" });
  }
}

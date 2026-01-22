import { verifyToken } from '../utils/jwt.js';
import { pool } from '../lib/db.js';

export async function getAuthUser(req) {
  const token = req.cookies?.session || req.headers?.authorization?.split?.(' ')[1];
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload?.sub || !payload?.merchant_id) return null;

  const { rows } = await pool.query(
    `SELECT id, email, store_name FROM merchant WHERE id = $1`,
    [payload.merchant_id]
  );
  if (!rows[0]) return null;
  const merchant = rows[0];
  return {
    id: merchant.id,
    merchant_id: merchant.id,
    email: merchant.email,
    role: payload.role,
    store_name: merchant.store_name
  };
}

export function requireAuth() {
  return async (req, res, next) => {
    try {
      const user = await getAuthUser(req);
      if (!user)
        return res.status(401).json({ error: 'Unauthorized' });
      req.user = user;
      next();
    } catch (err) {
      console.error('auth middleware error', err);
      res.status(500).json({ error: 'Internal auth error' });
    }
  };
}

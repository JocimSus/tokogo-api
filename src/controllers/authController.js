import bcrypt from 'bcrypt';
import { pool } from '../lib/db.js';
import { signToken, verifyToken } from '../utils/jwt.js';
import { createStaff } from './staffController.js';

const ALLOWED_ROLES = new Set(['manager', 'cashier']);

/**
 * POST /auth/signup
 * Body: { store_name, email, password }
 * Creates merchant account, manager role, and cashier role.
 */
export async function signup(req, res) {
  try {
    const { store_name, email, password } = req.body;
    if (!store_name || !email || !password) {
      return res.status(400).json({ error: 'store_name, email, password required' });
    }
    const password_hash = await bcrypt.hash(password, 10);

    // Create merchant
    const { rows: mRows } = await pool.query(
      'INSERT INTO merchant (store_name, email, password_hash) VALUES ($1,$2,$3) RETURNING id, store_name, email, created_at',
      [store_name, email, password_hash]
    );
    const merchant = mRows[0];

    // Create manager staff role
    await createStaff({ user: { merchant_id: merchant.id } }, { body: { role: 'manager' } });

    // Create cashier staff role
    await createStaff({ user: { merchant_id: merchant.id } }, { body: { role: 'cashier' } });

    const token = signToken({ sub: merchant.id, merchant_id: merchant.id, email: merchant.email, role: 'manager' });
    res.cookie('session', token, cookieOpts());
    return res.status(201).json({ token, user: { merchant_id: merchant.id, email: merchant.email, role: 'manager', store_name: merchant.store_name } });
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'email already exists' });
    console.error('signup error', err);
    res.status(500).json({ error: 'Failed to signup' });
  }
}

/**
 * POST /auth/login
 * Body: { email, password, role }
 * Logs in merchant and returns JWT token.
 */
export async function login(req, res) {
  try {
    const { email, password, role } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    if (role && !ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ error: 'invalid role. use manager or cashier' });
    }

    const { rows: mRows } = await pool.query(
      `SELECT id, email, password_hash, store_name FROM merchant WHERE email = $1`,
      [email]
    );
    const merchant = mRows[0];
    if (!merchant) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, merchant.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const { rows: staffRows } = await pool.query(
      `SELECT DISTINCT role FROM staff WHERE merchant_id = $1 ORDER BY role`,
      [merchant.id]
    );

    // Should never happen
    if (staffRows.length === 0) {
      return res.status(403).json({ error: 'No staff roles assigned to this merchant' });
    }

    const availableRoles = staffRows.map(s => s.role);
    const effectiveRole = role || availableRoles[0];

    if (!availableRoles.includes(effectiveRole)) {
      return res.status(403).json({ error: `role '${effectiveRole}' not available. available: ${availableRoles.join(', ')}` });
    }

    const token = signToken({ sub: merchant.id, merchant_id: merchant.id, email: merchant.email, role: effectiveRole });
    res.cookie('session', token, cookieOpts());

    const safe = { merchant_id: merchant.id, email: merchant.email, role: effectiveRole, store_name: merchant.store_name, available_roles: availableRoles };
    return res.status(200).json({ token, user: safe });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'Failed to login' });
  }
}

/**
 * POST /auth/logout
**/
export async function logout(req, res) {
  res.clearCookie('session', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  return res.status(204).end();
}

/** 
 * GET /auth/me
 * Auth: any logged-in user
 **/
export async function me(req, res) {
  try {
    const token = req.cookies?.session || req.headers?.authorization?.split?.(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const payload = verifyToken(token);
    if (!payload?.sub || !payload?.merchant_id) return res.status(401).json({ error: 'Unauthorized' });

    const { rows: mRows } = await pool.query(
      `SELECT id, email, store_name FROM merchant WHERE id = $1`,
      [payload.merchant_id]
    );
    const merchant = mRows[0];
    if (!merchant) return res.status(401).json({ error: 'Unauthorized' });

    const { rows: sRows } = await pool.query(
      `SELECT DISTINCT role FROM staff WHERE merchant_id = $1`,
      [merchant.id]
    );
    const available_roles = sRows.map(s => s.role);

    res.json({ user: { merchant_id: merchant.id, email: merchant.email, role: payload.role, store_name: merchant.store_name, available_roles } });
  } catch (err) {
    console.error('me error', err);
    res.status(500).json({ error: 'Failed' });
  }
}

function cookieOpts() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60
  };
}

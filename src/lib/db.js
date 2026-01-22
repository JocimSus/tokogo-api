import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => {
  console.error("pg pool error", err);
});

export { pool };
export const query = (text, params) => pool.query(text, params);

async function verifyConnection() {
  const timestamp = new Date().toISOString();
  try {
    const client = await pool.connect();
    client.release();
    console.log(`[db] connection OK at ${timestamp}`);
  } catch (err) {
    console.error(`[db] connection FAILED at ${timestamp}`);
    throw err;
  }
}

if (process.env.NODE_ENV !== "test") {
  verifyConnection();
}
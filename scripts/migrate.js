import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { pool } from "../src/lib/db.js";

async function migrate() {
  const schemaDir = path.resolve(process.cwd(), "schema");
  const entries = await fs.readdir(schemaDir);
  const files = entries.filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) {
    console.log("[migrate] no .sql files in schema/");
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const file of files) {
      const fullPath = path.join(schemaDir, file);
      const sql = await fs.readFile(fullPath, "utf8");
      console.log(`[migrate] applying ${file}`);
      await client.query(sql);
    }
    await client.query("COMMIT");
    console.log("[migrate] completed");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => { });
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error("[migrate] failed", err);
  process.exit(1);
});

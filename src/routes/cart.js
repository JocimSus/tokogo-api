import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import {
  createReceipt,
  getReceipts,
  getReceiptDetail
} from "../controllers/cartController.js";

const router = Router();

router.use(requireAuth());

// Create receipt (checkout)
router.post("/checkout", requireRole(["cashier", "manager", "admin"]), createReceipt);

router.get("/", requireRole(["cashier", "manager", "admin"]), getReceipts);
router.get("/:receipt_id", requireRole(["cashier", "manager", "admin"]), getReceiptDetail);

export default router;

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { createDetection, listDetections, uploadMiddleware } from "../controllers/detectionController.js";

const router = Router();

router.use(requireAuth());

router.post('/', uploadMiddleware, requireRole(["cashier", "manager", "admin"]), createDetection);
router.get('/', requireRole(["cashier", "manager", "admin"]), listDetections);

export default router;
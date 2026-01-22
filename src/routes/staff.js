import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { createStaff, listStaff } from "../controllers/staffController.js";

const router = Router();

router.use(requireAuth());

// Only managers or admins can manage staff
router.post('/', requireRole(['manager', 'admin']), createStaff);
router.get('/', requireRole(['manager', 'admin']), listStaff);

export default router;

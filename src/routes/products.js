import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { createProduct, listProducts, getProduct, updateProduct, uploadSampleMiddleware } from '../controllers/productController.js';

const router = Router();

router.use(requireAuth());

router.get('/', requireRole(["cashier", "manager", "admin"]), listProducts);
router.get('/:id', requireRole(["cashier", "manager", "admin"]), getProduct);
router.post('/', requireRole(["manager", "admin"]), uploadSampleMiddleware, createProduct);
router.patch('/:id', requireRole(["manager", "admin"]), uploadSampleMiddleware, updateProduct);

export default router;

import { Router } from "express";
import { login, logout, signup } from "../controllers/authController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post('/signup', signup);
router.post('/login', login);
router.post('/logout', requireAuth(), logout);
router.get('/me', requireAuth(), (req, res) => res.json({ user: req.user }));

export default router;
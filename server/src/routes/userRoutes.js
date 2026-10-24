import express from 'express';
import {
  getMyProfile,
  updateMyProfile,
  getPublicProfile,
} from '../controllers/userController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  validateProfileUpdate,
  validateUserId,
} from '../middleware/profileValidation.js';

const router = express.Router();

// Private profile endpoints (authenticated student)
router.get('/me/profile', requireAuth, getMyProfile);
router.patch('/me/profile', requireAuth, validateProfileUpdate, updateMyProfile);

// Public student profile endpoint (public access)
router.get('/:userId/profile', validateUserId, getPublicProfile);

export default router;

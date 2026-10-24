import express from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  validateNotificationId,
  validateGetNotifications,
} from '../middleware/notificationValidation.js';
import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  streamNotifications,
} from '../controllers/notificationController.js';

const router = express.Router();

/**
 * Static paths must be defined before dynamic parameterized paths (/:id)
 */

// GET /api/notifications - Paginated list of notifications
router.get('/', requireAuth, validateGetNotifications, getNotifications);

// GET /api/notifications/unread-count - Fast unread counter
router.get('/unread-count', requireAuth, getUnreadNotificationCount);

// GET /api/notifications/stream - Real-time SSE live updates
router.get('/stream', requireAuth, streamNotifications);

// PATCH /api/notifications/read-all - Mark all unread notifications as read
router.patch('/read-all', requireAuth, markAllNotificationsRead);

// PATCH /api/notifications/:id/read - Mark single notification as read
router.patch('/:id/read', requireAuth, validateNotificationId, markNotificationRead);

export default router;

import { Notification } from '../models/Notification.js';
import {
  getUserNotifications,
  getUnreadCount as getUnreadCountService,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  sseManager,
} from '../services/notificationService.js';

/**
 * Authenticated: Retrieve paginated notifications for the current user
 * GET /api/notifications
 */
export const getNotifications = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;

    let isRead = undefined;
    if (req.query.isRead !== undefined) {
      isRead = req.query.isRead === 'true' || req.query.isRead === '1';
    }

    const result = await getUserNotifications(req.user._id, {
      page,
      limit,
      isRead,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[NotificationController: getNotifications Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve notifications.',
    });
  }
};

/**
 * Authenticated: Get unread notification count for the current user
 * GET /api/notifications/unread-count
 */
export const getUnreadNotificationCount = async (req, res) => {
  try {
    const unreadCount = await getUnreadCountService(req.user._id);
    return res.status(200).json({
      success: true,
      data: {
        unreadCount,
      },
      unreadCount,
    });
  } catch (error) {
    console.error('[NotificationController: getUnreadNotificationCount Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve unread notification count.',
    });
  }
};

/**
 * Authenticated: Mark one notification as read
 * PATCH /api/notifications/:id/read
 */
export const markNotificationRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const notification = await markNotificationAsRead(id, userId);

    if (!notification) {
      // Check if notification exists for another user to distinguish 403 vs 404
      const otherUserNotif = await Notification.findById(id);
      if (otherUserNotif) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to update this notification.',
        });
      }

      return res.status(404).json({
        success: false,
        message: 'Notification not found.',
      });
    }

    const unreadCount = await getUnreadCountService(userId);

    return res.status(200).json({
      success: true,
      message: 'Notification marked as read.',
      data: {
        notification,
        unreadCount,
      },
      unreadCount,
    });
  } catch (error) {
    console.error('[NotificationController: markNotificationRead Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read.',
    });
  }
};

/**
 * Authenticated: Mark all notifications as read for current user
 * PATCH /api/notifications/read-all
 */
export const markAllNotificationsRead = async (req, res) => {
  try {
    const modifiedCount = await markAllNotificationsAsRead(req.user._id);

    return res.status(200).json({
      success: true,
      message: 'All notifications marked as read.',
      data: {
        modifiedCount,
        unreadCount: 0,
      },
      unreadCount: 0,
    });
  } catch (error) {
    console.error('[NotificationController: markAllNotificationsRead Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read.',
    });
  }
};

/**
 * Authenticated: Real-Time Server-Sent Events (SSE) Stream
 * GET /api/notifications/stream
 */
export const streamNotifications = (req, res) => {
  sseManager.addClient(req.user._id, req, res);
};

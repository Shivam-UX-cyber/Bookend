import mongoose from 'mongoose';
import { Notification } from '../models/Notification.js';

// In-memory active SSE clients registry: Map<userIdString, Set<http.ServerResponse>>
const sseClients = new Map();

/**
 * SSE Connection Manager
 */
export const sseManager = {
  /**
   * Register a new SSE connection for an authenticated user
   */
  addClient(userId, req, res) {
    const userIdStr = userId.toString();

    // Configure streaming headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable buffering on Nginx/reverse proxies
    });

    // Send initial handshake
    res.write(': connected\n\n');

    if (!sseClients.has(userIdStr)) {
      sseClients.set(userIdStr, new Set());
    }
    const clientSet = sseClients.get(userIdStr);
    clientSet.add(res);

    // Heartbeat every 25 seconds to keep connection alive through NAT / firewalls
    const heartbeatInterval = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
        res.write('event: heartbeat\ndata: {}\n\n');
      } catch (err) {
        clearInterval(heartbeatInterval);
      }
    }, 25000);
    if (heartbeatInterval.unref) {
      heartbeatInterval.unref();
    }

    // Clean up on disconnect
    req.on('close', () => {
      clearInterval(heartbeatInterval);
      const currentSet = sseClients.get(userIdStr);
      if (currentSet) {
        currentSet.delete(res);
        if (currentSet.size === 0) {
          sseClients.delete(userIdStr);
        }
      }
    });
  },

  /**
   * Broadcast an event to all active sessions of a specific user
   */
  broadcast(userId, eventName, data) {
    if (!userId) return;
    const userIdStr = userId.toString();
    const clientSet = sseClients.get(userIdStr);
    if (!clientSet || clientSet.size === 0) return;

    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const clientRes of clientSet) {
      try {
        clientRes.write(payload);
      } catch (err) {
        // Handled on close event
      }
    }
  },

  /**
   * Check if a user currently has an active SSE stream
   */
  hasClient(userId) {
    if (!userId) return false;
    const clientSet = sseClients.get(userId.toString());
    return Boolean(clientSet && clientSet.size > 0);
  },

  /**
   * Gracefully terminate all active SSE connections during server shutdown
   */
  closeAll() {
    for (const [userIdStr, clientSet] of sseClients.entries()) {
      for (const res of clientSet) {
        try {
          res.write('event: shutdown\ndata: {"message":"Server shutting down"}\n\n');
          res.end();
        } catch (err) {
          // Socket may already be destroyed or closed
        }
      }
    }
    sseClients.clear();
  },

  /**
   * For testing: clear all SSE connections
   */
  clearAll() {
    sseClients.clear();
  },
};

/**
 * Creates and persists a notification, and broadcasts it live if recipient is online
 */
export const createNotification = async (
  {
    recipient,
    actor = null,
    type,
    title,
    message,
    relatedBook = null,
    relatedPurchaseRequest = null,
    idempotencyKey = null,
  },
  { session = null } = {}
) => {
  // Business rule: Do not notify actor about their own action
  if (recipient && actor && recipient.toString() === actor.toString()) {
    return null;
  }

  // Idempotency: If idempotencyKey is provided, check if already sent to this recipient
  if (idempotencyKey) {
    const existing = await Notification.findOne({
      recipient,
      idempotencyKey,
    }).session(session || null);

    if (existing) {
      return existing;
    }
  }

  try {
    const notification = new Notification({
      recipient,
      actor,
      type,
      title: title.trim(),
      message: message.trim(),
      relatedBook,
      relatedPurchaseRequest,
      idempotencyKey: idempotencyKey ? idempotencyKey.trim() : null,
      isRead: false,
      readAt: null,
    });

    await notification.save({ session: session || undefined });

    // Populate references safely for presentation
    await notification.populate([
      {
        path: 'actor',
        select: 'name displayName avatarUrl',
      },
      {
        path: 'relatedBook',
        select: 'title author price priceInPaise imageUrl status',
      },
      {
        path: 'relatedPurchaseRequest',
        select: 'status',
      },
    ]);

    // Live broadcast to online recipient
    try {
      sseManager.broadcast(recipient, 'notification', notification);
    } catch (sseErr) {
      // SSE broadcast failure should never interrupt persistence
    }

    return notification;
  } catch (err) {
    // Handle duplicate key error from partial unique index on { recipient, idempotencyKey }
    if (err.code === 11000 && idempotencyKey) {
      return await Notification.findOne({
        recipient,
        idempotencyKey,
      }).session(session || null);
    }
    throw err;
  }
};

/**
 * Safe notification delivery wrapper:
 * Guarantees that any unexpected notification failure does not corrupt or abort
 * the primary business transaction.
 */
export const notifySafely = async (notificationParams, options = {}) => {
  try {
    return await createNotification(notificationParams, options);
  } catch (err) {
    // Sanitize log output: never log sensitive request data or tokens
    console.error('[NotificationService: Delivery Notice]', {
      type: notificationParams.type,
      recipient: notificationParams.recipient?.toString?.(),
      error: err.message,
    });
    return null;
  }
};

/**
 * Retrieve paginated notifications for an authenticated user
 */
export const getUserNotifications = async (
  recipientId,
  { page = 1, limit = 20, isRead = undefined } = {}
) => {
  const safePage = Math.min(1000, Math.max(1, parseInt(page, 10) || 1));
  const safeLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (safePage - 1) * safeLimit;

  const filter = { recipient: recipientId };
  if (typeof isRead === 'boolean') {
    filter.isRead = isRead;
  }

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate([
        {
          path: 'actor',
          select: 'name displayName avatarUrl',
        },
        {
          path: 'relatedBook',
          select: 'title author price priceInPaise imageUrl status',
        },
        {
          path: 'relatedPurchaseRequest',
          select: 'status',
        },
      ])
      .lean({ virtuals: true }),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipient: recipientId, isRead: false }),
  ]);

  const totalPages = Math.ceil(total / safeLimit) || 1;

  return {
    notifications,
    unreadCount,
    pagination: {
      total,
      page: safePage,
      limit: safeLimit,
      totalPages,
      hasPrev: safePage > 1,
      hasNext: safePage < totalPages,
    },
  };
};

/**
 * Retrieve unread count for an authenticated user
 */
export const getUnreadCount = async (recipientId) => {
  return await Notification.countDocuments({ recipient: recipientId, isRead: false });
};

/**
 * Mark a single notification as read (with recipient ownership protection)
 */
export const markNotificationAsRead = async (notificationId, recipientId) => {
  if (!mongoose.isValidObjectId(notificationId)) {
    return null;
  }

  const notification = await Notification.findOneAndUpdate(
    {
      _id: notificationId,
      recipient: recipientId,
    },
    {
      $set: {
        isRead: true,
        readAt: new Date(),
      },
    },
    { new: true }
  ).populate([
    {
      path: 'actor',
      select: 'name displayName avatarUrl',
    },
    {
      path: 'relatedBook',
      select: 'title author price priceInPaise imageUrl status',
    },
    {
      path: 'relatedPurchaseRequest',
      select: 'status',
    },
  ]);

  if (notification) {
    // Notify client of updated unread count
    const unreadCount = await getUnreadCount(recipientId);
    sseManager.broadcast(recipientId, 'unread_count', { unreadCount });
  }

  return notification;
};

/**
 * Mark all unread notifications for a user as read
 */
export const markAllNotificationsAsRead = async (recipientId) => {
  const result = await Notification.updateMany(
    {
      recipient: recipientId,
      isRead: false,
    },
    {
      $set: {
        isRead: true,
        readAt: new Date(),
      },
    }
  );

  // Broadcast updated unread count (0)
  sseManager.broadcast(recipientId, 'unread_count', { unreadCount: 0 });

  return result.modifiedCount || 0;
};

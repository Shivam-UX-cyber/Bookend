import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { notificationService } from '../services/notificationService';

const NotificationContext = createContext(null);

export const NotificationProvider = ({ children }) => {
  const { isAuthenticated, user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasLoadedInitial, setHasLoadedInitial] = useState(false);

  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const retryCountRef = useRef(0);
  const sessionGenerationRef = useRef(0);
  const currentUserId = user?._id || user?.id || null;

  // Canonical helper to extract unread count across dual response shapes
  const parseUnreadCount = (res) => {
    if (!res) return null;
    if (typeof res?.data?.unreadCount === 'number') return res.data.unreadCount;
    if (typeof res?.unreadCount === 'number') return res.unreadCount;
    return null;
  };

  // Fetch unread count for the active authenticated session
  const refreshUnreadCount = useCallback(async () => {
    if (!isAuthenticated) return;
    const activeGen = sessionGenerationRef.current;
    try {
      const res = await notificationService.getUnreadCount();
      if (sessionGenerationRef.current !== activeGen) return;
      const count = parseUnreadCount(res);
      if (count !== null) {
        setUnreadCount(count);
      }
    } catch (err) {
      if (sessionGenerationRef.current === activeGen) {
        console.warn('[Notifications] Failed to refresh unread count:', err.message);
      }
    }
  }, [isAuthenticated]);

  // Fetch notifications list (page 1 by default)
  const fetchNotifications = useCallback(
    async (params = { page: 1, limit: 15 }) => {
      if (!isAuthenticated) return;
      const activeGen = sessionGenerationRef.current;
      try {
        setIsLoading(true);
        setError(null);
        const res = await notificationService.getNotifications(params);
        if (sessionGenerationRef.current !== activeGen) return;

        if (res && res.data) {
          const list = Array.isArray(res.data)
            ? res.data
            : Array.isArray(res.data.notifications)
            ? res.data.notifications
            : [];
          setNotifications(list);

          const count = parseUnreadCount(res.data) ?? parseUnreadCount(res);
          if (count !== null) {
            setUnreadCount(count);
          }
        }
        setHasLoadedInitial(true);
      } catch (err) {
        if (sessionGenerationRef.current === activeGen && !err.isAborted) {
          setError(err.message || 'Failed to load notifications.');
        }
      } finally {
        if (sessionGenerationRef.current === activeGen) {
          setIsLoading(false);
        }
      }
    },
    [isAuthenticated]
  );

  // Mark a single notification as read with full state rollback on failure
  const markAsRead = useCallback(
    async (id) => {
      if (!id) return;
      const activeGen = sessionGenerationRef.current;

      // 1. Snapshot previous state for rollback
      let previousNotificationsSnapshot = [];
      let previousCountSnapshot = 0;
      setNotifications((prev) => {
        previousNotificationsSnapshot = prev;
        return prev.map((n) =>
          n._id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n
        );
      });
      setUnreadCount((prev) => {
        previousCountSnapshot = prev;
        return Math.max(0, prev - 1);
      });

      try {
        const res = await notificationService.markAsRead(id);
        if (sessionGenerationRef.current !== activeGen) return;

        const updatedCount = parseUnreadCount(res?.data) ?? parseUnreadCount(res);
        if (updatedCount !== null) {
          setUnreadCount(updatedCount);
        }
      } catch (err) {
        if (sessionGenerationRef.current !== activeGen) return;
        console.error('[Notifications] Error marking as read, rolling back:', err);
        // 2. Full rollback of optimistic update
        setNotifications(previousNotificationsSnapshot);
        setUnreadCount(previousCountSnapshot);
        setError('Could not mark notification as read. Please try again.');
        refreshUnreadCount();
      }
    },
    [refreshUnreadCount]
  );

  // Mark all notifications as read with full state rollback on failure
  const markAllAsRead = useCallback(async () => {
    const activeGen = sessionGenerationRef.current;

    // 1. Snapshot previous state
    let previousNotificationsSnapshot = [];
    let previousCountSnapshot = 0;
    setNotifications((prev) => {
      previousNotificationsSnapshot = prev;
      return prev.map((n) => ({ ...n, isRead: true, readAt: new Date().toISOString() }));
    });
    setUnreadCount((prev) => {
      previousCountSnapshot = prev;
      return 0;
    });

    try {
      const res = await notificationService.markAllAsRead();
      if (sessionGenerationRef.current !== activeGen) return;

      const updatedCount = parseUnreadCount(res?.data) ?? parseUnreadCount(res);
      if (updatedCount !== null) {
        setUnreadCount(updatedCount);
      }
    } catch (err) {
      if (sessionGenerationRef.current !== activeGen) return;
      console.error('[Notifications] Error marking all as read, rolling back:', err);
      // 2. Full rollback
      setNotifications(previousNotificationsSnapshot);
      setUnreadCount(previousCountSnapshot);
      setError('Could not mark all notifications as read. Please try again.');
      refreshUnreadCount();
    }
  }, [refreshUnreadCount]);

  // Setup SSE connection with isolation, generation tracking, and bounded backoff
  useEffect(() => {
    // Increment generation ID on session transition to invalidate in-flight responses
    sessionGenerationRef.current += 1;
    const activeGen = sessionGenerationRef.current;

    if (!isAuthenticated || !currentUserId) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      setUnreadCount(0);
      setNotifications([]);
      setHasLoadedInitial(false);
      setError(null);
      return;
    }

    // Initial unread count fetch for the active authenticated account
    refreshUnreadCount();

    const connectSSE = () => {
      if (sessionGenerationRef.current !== activeGen) return;
      try {
        const streamUrl = notificationService.getStreamUrl();
        const es = new EventSource(streamUrl, { withCredentials: true });
        eventSourceRef.current = es;

        es.addEventListener('notification', (e) => {
          if (sessionGenerationRef.current !== activeGen) return;
          retryCountRef.current = 0;
          try {
            const newNotification = JSON.parse(e.data);
            if (newNotification && newNotification._id) {
              setNotifications((prev) => {
                // Bug 2: Deduplicate in place and only increment unread count if newly added and unread
                const exists = prev.some((n) => n._id === newNotification._id);
                if (exists) return prev;
                if (!newNotification.isRead) {
                  setUnreadCount((c) => c + 1);
                }
                return [newNotification, ...prev];
              });
            }
          } catch (parseErr) {
            console.error('[Notifications SSE] Error parsing notification:', parseErr);
          }
        });

        es.addEventListener('unread_count', (e) => {
          if (sessionGenerationRef.current !== activeGen) return;
          try {
            const data = JSON.parse(e.data);
            const count = parseUnreadCount(data);
            if (count !== null) {
              setUnreadCount(count);
            }
          } catch (parseErr) {
            console.error('[Notifications SSE] Error parsing unread count:', parseErr);
          }
        });

        es.addEventListener('heartbeat', () => {
          if (sessionGenerationRef.current !== activeGen) return;
          retryCountRef.current = 0;
        });

        es.onerror = () => {
          if (sessionGenerationRef.current !== activeGen) return;
          if (es.readyState === EventSource.CLOSED) {
            es.close();
            eventSourceRef.current = null;
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            // Bounded exponential backoff with jitter
            const baseDelay = Math.min(30000, 2000 * Math.pow(1.5, retryCountRef.current));
            const jitter = Math.floor(Math.random() * 500);
            const delay = baseDelay + jitter;
            retryCountRef.current += 1;

            reconnectTimeoutRef.current = setTimeout(() => {
              if (sessionGenerationRef.current === activeGen && isAuthenticated && currentUserId) {
                refreshUnreadCount();
                connectSSE();
              }
            }, delay);
          }
        };
      } catch (sseErr) {
        console.warn('[Notifications SSE] Connection initialization error:', sseErr);
      }
    };

    connectSSE();

    return () => {
      retryCountRef.current = 0;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [isAuthenticated, currentUserId, refreshUnreadCount]);

  const value = {
    unreadCount,
    notifications,
    isLoading,
    error,
    hasLoadedInitial,
    fetchNotifications,
    refreshUnreadCount,
    markAsRead,
    markAllAsRead,
  };

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};

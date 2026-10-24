import { apiRequest } from './api.js';

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || '';

export const NOTIFICATION_TYPE_CONFIG = {
  purchase_request_created: {
    icon: 'inbox',
    badgeClass: 'badge-info',
    defaultTitle: 'New Purchase Request',
  },
  purchase_request_accepted: {
    icon: 'check-circle',
    badgeClass: 'badge-success',
    defaultTitle: 'Request Accepted',
  },
  purchase_request_rejected: {
    icon: 'x-circle',
    badgeClass: 'badge-danger',
    defaultTitle: 'Request Declined',
  },
  purchase_request_cancelled: {
    icon: 'alert-triangle',
    badgeClass: 'badge-warning',
    defaultTitle: 'Request Cancelled',
  },
  reservation_cancelled: {
    icon: 'rotate-ccw',
    badgeClass: 'badge-warning',
    defaultTitle: 'Reservation Cancelled',
  },
  sale_completed: {
    icon: 'award',
    badgeClass: 'badge-success',
    defaultTitle: 'Sale Completed',
  },
  competing_request_rejected: {
    icon: 'info',
    badgeClass: 'badge-muted',
    defaultTitle: 'Book Sold',
  },
  listing_removed: {
    icon: 'trash-2',
    badgeClass: 'badge-danger',
    defaultTitle: 'Listing Removed',
  },
  listing_sold: {
    icon: 'tag',
    badgeClass: 'badge-muted',
    defaultTitle: 'Listing Marked as Sold',
  },
  system: {
    icon: 'bell',
    badgeClass: 'badge-primary',
    defaultTitle: 'System Notification',
  },
};

export const notificationService = {
  /**
   * Get paginated notifications for the authenticated user
   * @param {Object} params - { page, limit, isRead }
   */
  async getNotifications(params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', params.page);
    if (params.limit) query.set('limit', params.limit);
    if (typeof params.isRead === 'boolean') query.set('isRead', params.isRead);

    const qs = query.toString();
    return apiRequest(`/api/notifications${qs ? `?${qs}` : ''}`, {
      method: 'GET',
    });
  },

  /**
   * Retrieve total unread notifications count for the authenticated user
   */
  async getUnreadCount() {
    return apiRequest('/api/notifications/unread-count', {
      method: 'GET',
    });
  },

  /**
   * Mark a single notification as read
   * @param {string} id - Notification ID
   */
  async markAsRead(id) {
    return apiRequest(`/api/notifications/${id}/read`, {
      method: 'PATCH',
    });
  },

  /**
   * Mark all unread notifications as read for current user
   */
  async markAllAsRead() {
    return apiRequest('/api/notifications/read-all', {
      method: 'PATCH',
    });
  },

  /**
   * Get the absolute or relative SSE stream URL
   */
  getStreamUrl() {
    return `${API_BASE_URL}/api/notifications/stream`;
  },
};

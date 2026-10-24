import { apiRequest } from './api.js';

export const REQUEST_STATUS_LABELS = {
  pending: 'Pending Review',
  accepted: 'Accepted',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const purchaseRequestService = {
  /**
   * Submit a purchase request for an available book
   * @param {Object} data - { bookId, message }
   */
  async createRequest(data) {
    return apiRequest('/api/purchase-requests', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * Get purchase requests sent by current user (as buyer)
   * @param {Object} params - { status, bookId, page, limit }
   */
  async getSentRequests(params = {}) {
    const query = new URLSearchParams();
    if (params.status?.trim()) query.set('status', params.status.trim());
    if (params.bookId?.trim()) query.set('bookId', params.bookId.trim());
    if (params.page) query.set('page', params.page);
    if (params.limit) query.set('limit', params.limit);

    const qs = query.toString();
    return apiRequest(`/api/purchase-requests/sent${qs ? `?${qs}` : ''}`, {
      method: 'GET',
    });
  },

  /**
   * Get purchase requests received by current user (as seller)
   * @param {Object} params - { status, bookId, page, limit }
   */
  async getReceivedRequests(params = {}) {
    const query = new URLSearchParams();
    if (params.status?.trim()) query.set('status', params.status.trim());
    if (params.bookId?.trim()) query.set('bookId', params.bookId.trim());
    if (params.page) query.set('page', params.page);
    if (params.limit) query.set('limit', params.limit);

    const qs = query.toString();
    return apiRequest(`/api/purchase-requests/received${qs ? `?${qs}` : ''}`, {
      method: 'GET',
    });
  },

  /**
   * Get request details by ID
   * @param {string} id - Request ID
   */
  async getRequestById(id) {
    return apiRequest(`/api/purchase-requests/${id}`, {
      method: 'GET',
    });
  },

  /**
   * Respond to request (accept or reject) - Seller only
   * @param {string} id - Request ID
   * @param {string} action - 'accept' | 'reject'
   */
  async respondToRequest(id, action, reason = '') {
    return apiRequest(`/api/purchase-requests/${id}/respond`, {
      method: 'PATCH',
      body: JSON.stringify({ action, reason }),
    });
  },

  /**
   * Cancel pending request or accepted reservation - Buyer or Seller
   * @param {string} id - Request ID
   * @param {string} reason - Optional cancellation reason
   */
  async cancelRequest(id, reason = '') {
    return apiRequest(`/api/purchase-requests/${id}/cancel`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
  },

  /**
   * Confirm real-world sale completion - Seller only
   * @param {string} id - Request ID
   */
  async completeSale(id) {
    return apiRequest(`/api/purchase-requests/${id}/complete`, {
      method: 'PATCH',
    });
  },
};

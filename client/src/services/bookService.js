import { apiRequest } from './api.js';

export { BOOK_CATEGORIES, BOOK_CONDITIONS } from '../utils/validation.js';

export const bookService = {
  /**
   * Public: Retrieve book listings with filters, search, sorting, and pagination
   * @param {Object} params - { search, category, condition, sortBy, page, limit }
   */
  async getBooks(params = {}) {
    const query = new URLSearchParams();

    if (params.search?.trim()) query.set('search', params.search.trim());
    if (params.category?.trim()) query.set('category', params.category.trim());
    if (params.condition?.trim()) query.set('condition', params.condition.trim());
    if (params.sortBy?.trim()) query.set('sortBy', params.sortBy.trim());
    if (params.page) query.set('page', params.page);
    if (params.limit) query.set('limit', params.limit);

    const qs = query.toString();
    const endpoint = `/api/books${qs ? `?${qs}` : ''}`;
    return apiRequest(endpoint, { method: 'GET' });
  },

  /**
   * Public: Retrieve single book listing details by ID
   * @param {string} id - Book ObjectId
   */
  async getBookById(id) {
    return apiRequest(`/api/books/${id}`, { method: 'GET' });
  },

  /**
   * Authenticated: Publish a new book listing for sale
   * @param {Object} bookData - { title, author, description, category, condition, price, isbn, imageUrl }
   */
  async createBook(bookData) {
    return apiRequest('/api/books', {
      method: 'POST',
      body: JSON.stringify(bookData),
    });
  },

  /**
   * Authenticated: Retrieve current user's listings (available & sold)
   * @param {Object} params - { status, page, limit }
   */
  async getMyBooks(params = {}) {
    const query = new URLSearchParams();

    if (params.status?.trim()) query.set('status', params.status.trim());
    if (params.page) query.set('page', params.page);
    if (params.limit) query.set('limit', params.limit);

    const qs = query.toString();
    const endpoint = `/api/books/mine${qs ? `?${qs}` : ''}`;
    return apiRequest(endpoint, { method: 'GET' });
  },

  /**
   * Authenticated: Update an owned book listing details
   * @param {string} id - Book ObjectId
   * @param {Object} bookData - Allowlisted editable fields
   */
  async updateBook(id, bookData) {
    return apiRequest(`/api/books/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(bookData),
    });
  },

  /**
   * Authenticated: Update listing status ('available' or 'sold')
   * @param {string} id - Book ObjectId
   * @param {string} status - 'available' | 'sold'
   */
  async updateBookStatus(id, status) {
    return apiRequest(`/api/books/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  /**
   * Authenticated: Delete an owned book listing
   * @param {string} id - Book ObjectId
   */
  async deleteBook(id) {
    return apiRequest(`/api/books/${id}`, {
      method: 'DELETE',
    });
  },
};

/**
 * Format currency in Indian Rupees (INR)
 * @param {number} amount - Price in Rupees
 */
export const formatINR = (amount, fallbackPriceInPaise = null) => {
  let val = amount;
  if (typeof amount === 'object' && amount !== null) {
    val = amount.price !== undefined && amount.price !== null
      ? amount.price
      : (typeof amount.priceInPaise === 'number' ? amount.priceInPaise / 100 : null);
  } else if ((val === undefined || val === null || (typeof val === 'number' && isNaN(val))) && typeof fallbackPriceInPaise === 'number') {
    val = fallbackPriceInPaise / 100;
  }

  if (val === undefined || val === null || (typeof val === 'number' && isNaN(val))) {
    return '₹0';
  }
  const num = Number(val);
  if (isNaN(num)) {
    return '₹0';
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: num % 1 === 0 ? 0 : 2,
  }).format(num);
};

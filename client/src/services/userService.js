import { apiRequest } from './api.js';

/**
 * Service for authenticated student profile and public student profiles.
 */
export const userService = {
  /**
   * Get authenticated user's private profile and privacy settings
   * GET /api/users/me/profile
   */
  async getMyProfile() {
    return apiRequest('/api/users/me/profile');
  },

  /**
   * Update authenticated user's profile fields and privacy settings
   * PATCH /api/users/me/profile
   */
  async updateMyProfile(profileData) {
    return apiRequest('/api/users/me/profile', {
      method: 'PATCH',
      body: JSON.stringify(profileData),
    });
  },

  /**
   * Get public student profile with seller book listings
   * GET /api/users/:userId/profile
   */
  async getPublicProfile(userId, page = 1, limit = 8) {
    const query = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    }).toString();

    return apiRequest(`/api/users/${userId}/profile?${query}`);
  },
};

export default userService;

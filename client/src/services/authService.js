import { apiRequest } from './api';

export const authService = {
  // 1. Registration (Initiate flow, sets regSession cookie)
  register: async (payload) => {
    return apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // 1b. Registration Status (Cooldown & flow verification via HTTP-only cookie)
  getRegistrationStatus: async () => {
    return apiRequest('/api/auth/registration-status', {
      method: 'GET',
    });
  },

  // 2. Verify Registration OTP (Bound to server flow session)
  verifyRegistrationOtp: async (otp) => {
    return apiRequest('/api/auth/verify-registration-otp', {
      method: 'POST',
      body: JSON.stringify({ otp }),
    });
  },

  // 3. Resend Registration OTP (Bound to server flow session)
  resendRegistrationOtp: async () => {
    return apiRequest('/api/auth/resend-registration-otp', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  // 3b. Cancel / Reset Registration Flow (Clears cookie and pending state)
  cancelRegistration: async () => {
    return apiRequest('/api/auth/cancel-registration', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  // 4. Login
  login: async (email, password) => {
    return apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  // 5. Logout
  logout: async () => {
    return apiRequest('/api/auth/logout', {
      method: 'POST',
    });
  },

  // 6. Get Current User Profile (Protected session check)
  getMe: async () => {
    return apiRequest('/api/auth/me', {
      method: 'GET',
    });
  },

  // 7. Forgot Password (Initiate recovery, sets resetSession cookie)
  forgotPassword: async (email) => {
    return apiRequest('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  // 7b. Forgot Password Flow Status (Bound to resetSession cookie)
  getForgotPasswordStatus: async () => {
    return apiRequest('/api/auth/forgot-password/status', {
      method: 'GET',
    });
  },

  // 8. Verify Password Reset OTP (Verifies code, transitions server session to verified)
  verifyResetOtp: async (otp) => {
    return apiRequest('/api/auth/verify-reset-otp', {
      method: 'POST',
      body: JSON.stringify({ otp }),
    });
  },

  // 9. Resend Password Reset OTP (Bound to resetSession cookie)
  resendResetOtp: async () => {
    return apiRequest('/api/auth/resend-reset-otp', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  // 9b. Cancel / Change Email in Forgot Password Flow
  cancelForgotPassword: async () => {
    return apiRequest('/api/auth/forgot-password/cancel', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  // 10. Reset Password (Cookie-authenticated, no raw tokens in JS payload!)
  resetPassword: async (newPassword, confirmPassword) => {
    return apiRequest('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ newPassword, confirmPassword }),
    });
  },
};

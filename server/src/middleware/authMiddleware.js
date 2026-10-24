import { verifyAuthToken } from '../services/tokenService.js';
import { User } from '../models/User.js';

const getClearAuthCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  path: '/',
});

export const requireAuth = async (req, res, next) => {
  try {
    // Read JWT from HTTP-only cookie
    const token = req.cookies?.authToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in.',
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = verifyAuthToken(token);
    } catch (err) {
      // Clear invalid cookie
      res.clearCookie('authToken', getClearAuthCookieOptions());

      return res.status(401).json({
        success: false,
        message: 'Session expired or invalid token. Please log in again.',
      });
    }

    // Fetch user from DB
    const user = await User.findById(decoded.id);
    if (!user) {
      res.clearCookie('authToken', getClearAuthCookieOptions());
      return res.status(401).json({
        success: false,
        message: 'User account not found.',
      });
    }

    // Enforce token version matching (invalidates old sessions if password changed)
    if (user.tokenVersion !== decoded.tokenVersion) {
      res.clearCookie('authToken', getClearAuthCookieOptions());
      return res.status(401).json({
        success: false,
        message: 'Session has been invalidated due to a security update. Please log in again.',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Internal server authentication error.',
    });
  }
};

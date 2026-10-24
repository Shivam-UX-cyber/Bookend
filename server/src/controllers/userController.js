import { User } from '../models/User.js';
import { Book } from '../models/Book.js';
import { serializePrivateProfile, serializePublicProfile } from '../utils/profileSerializers.js';

/**
 * Get current authenticated student's private profile
 * GET /api/users/me/profile
 */
export const getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Student account not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        profile: serializePrivateProfile(user),
      },
    });
  } catch (error) {
    console.error('[UserController: getMyProfile Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve your student profile.',
    });
  }
};

/**
 * Update authenticated student's private profile and privacy settings
 * PATCH /api/users/me/profile
 */
export const updateMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Student account not found.',
      });
    }

    const {
      displayName,
      bio,
      department,
      course,
      studyYear,
      campus,
      avatarUrl,
      privacy,
    } = req.body;

    // Partial update: apply only fields that were explicitly submitted
    if (displayName !== undefined) {
      user.displayName = typeof displayName === 'string' ? displayName.trim() : '';
    }

    if (bio !== undefined) {
      user.bio = typeof bio === 'string' ? bio.trim() : '';
    }

    if (department !== undefined) {
      user.department = typeof department === 'string' ? department.trim() : '';
    }

    if (course !== undefined) {
      user.course = typeof course === 'string' ? course.trim() : '';
    }

    if (studyYear !== undefined) {
      user.studyYear = typeof studyYear === 'string' ? studyYear.trim() : '';
    }

    if (campus !== undefined) {
      user.campus = typeof campus === 'string' ? campus.trim() : '';
    }

    if (avatarUrl !== undefined) {
      user.avatarUrl = typeof avatarUrl === 'string' ? avatarUrl.trim() : '';
    }

    // Merge privacy settings without resetting unspecified keys
    if (privacy && typeof privacy === 'object' && !Array.isArray(privacy)) {
      if (!user.privacy) {
        user.privacy = {
          showBio: true,
          showDepartment: false,
          showCourse: false,
          showStudyYear: false,
          showCampus: false,
        };
      }

      if (typeof privacy.showBio === 'boolean') {
        user.privacy.showBio = privacy.showBio;
      }
      if (typeof privacy.showDepartment === 'boolean') {
        user.privacy.showDepartment = privacy.showDepartment;
      }
      if (typeof privacy.showCourse === 'boolean') {
        user.privacy.showCourse = privacy.showCourse;
      }
      if (typeof privacy.showStudyYear === 'boolean') {
        user.privacy.showStudyYear = privacy.showStudyYear;
      }
      if (typeof privacy.showCampus === 'boolean') {
        user.privacy.showCampus = privacy.showCampus;
      }
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      data: {
        profile: serializePrivateProfile(user),
      },
    });
  } catch (error) {
    console.error('[UserController: updateMyProfile Error]', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: Object.values(error.errors)[0]?.message || 'Profile validation failed.',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to update student profile.',
    });
  }
};

/**
 * Get public student profile with seller listings and server-side privacy enforcement
 * GET /api/users/:userId/profile
 */
export const getPublicProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = Math.min(1000, Math.max(1, parseInt(req.query.page, 10) || 1));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 8));
    const skip = (page - 1) * limit;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found.',
      });
    }

    // Query seller's public listings (available, reserved, sold)
    const filter = {
      seller: user._id,
      status: { $in: ['available', 'reserved', 'sold'] },
    };

    const [books, total] = await Promise.all([
      Book.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean({ virtuals: true }),
      Book.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    // Sanitize book objects so buyer/acceptedRequest information is never revealed
    const formattedBooks = books.map((b) => ({
      _id: b._id,
      title: b.title,
      author: b.author,
      description: b.description,
      category: b.category,
      condition: b.condition,
      price: b.price !== undefined ? b.price : (typeof b.priceInPaise === 'number' ? b.priceInPaise / 100 : 0),
      priceInPaise: b.priceInPaise,
      imageUrl: b.imageUrl || '',
      status: b.status,
      createdAt: b.createdAt,
    }));

    const pagination = {
      total,
      page,
      limit,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
    };

    const profile = serializePublicProfile(user, formattedBooks, pagination);

    return res.status(200).json({
      success: true,
      data: {
        profile,
      },
    });
  } catch (error) {
    console.error('[UserController: getPublicProfile Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve student profile.',
    });
  }
};

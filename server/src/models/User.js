import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [70, 'Name cannot exceed 70 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      select: false, // Do not return password by default in queries
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
    displayName: {
      type: String,
      trim: true,
      maxlength: [70, 'Display name cannot exceed 70 characters'],
      default: '',
    },
    bio: {
      type: String,
      trim: true,
      maxlength: [500, 'Bio cannot exceed 500 characters'],
      default: '',
    },
    department: {
      type: String,
      trim: true,
      maxlength: [100, 'Department cannot exceed 100 characters'],
      default: '',
    },
    course: {
      type: String,
      trim: true,
      maxlength: [100, 'Course cannot exceed 100 characters'],
      default: '',
    },
    studyYear: {
      type: String,
      trim: true,
      enum: {
        values: ['', '1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year', 'Graduate / PhD'],
        message: '{VALUE} is not a valid year of study',
      },
      default: '',
    },
    campus: {
      type: String,
      trim: true,
      maxlength: [100, 'Campus cannot exceed 100 characters'],
      default: '',
    },
    avatarUrl: {
      type: String,
      trim: true,
      default: '',
      validate: {
        validator: function (v) {
          if (!v) return true;
          return /^https?:\/\/.+/i.test(v);
        },
        message: 'Avatar URL must be a valid HTTP or HTTPS address',
      },
    },
    privacy: {
      showBio: {
        type: Boolean,
        default: true,
      },
      showDepartment: {
        type: Boolean,
        default: false,
      },
      showCourse: {
        type: Boolean,
        default: false,
      },
      showStudyYear: {
        type: Boolean,
        default: false,
      },
      showCampus: {
        type: Boolean,
        default: false,
      },
    },
  },
  {
    timestamps: true,
  }
);

export const User = mongoose.model('User', userSchema);

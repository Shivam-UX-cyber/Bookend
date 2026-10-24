import mongoose from 'mongoose';

const pendingRegistrationSchema = new mongoose.Schema(
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
      required: [true, 'Hashed password is required'],
    },
    flowTokenHash: {
      type: String,
      required: true,
      index: true,
    },
    otpHash: {
      type: String,
      required: [true, 'Hashed OTP is required'],
    },
    otpVersion: {
      type: Number,
      default: 1,
    },
    status: {
      type: String,
      enum: ['pending_delivery', 'active', 'delivery_failed'],
      default: 'pending_delivery',
    },
    otpExpiresAt: {
      type: Date,
      required: true,
    },
    resendAvailableAt: {
      type: Date,
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  {
    timestamps: true,
  }
);

export const PendingRegistration = mongoose.model('PendingRegistration', pendingRegistrationSchema);

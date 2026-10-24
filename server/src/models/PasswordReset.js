import mongoose from 'mongoose';

const passwordResetSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    flowTokenHash: {
      type: String,
      required: true,
      index: true,
    },
    otpHash: {
      type: String,
      required: true,
    },
    otpVersion: {
      type: Number,
      default: 1,
    },
    status: {
      type: String,
      enum: ['pending_delivery', 'active', 'delivery_failed', 'verified'],
      default: 'pending_delivery',
    },
    isAnonymous: {
      type: Boolean,
      default: false,
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
    resetTokenHash: {
      type: String,
      default: null,
    },
    resetTokenExpiresAt: {
      type: Date,
      default: null,
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

export const PasswordReset = mongoose.model('PasswordReset', passwordResetSchema);

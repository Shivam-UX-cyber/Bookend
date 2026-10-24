import mongoose from 'mongoose';

export const NOTIFICATION_TYPES = [
  'purchase_request_created',
  'purchase_request_accepted',
  'purchase_request_rejected',
  'purchase_request_cancelled',
  'reservation_cancelled',
  'sale_completed',
  'competing_request_rejected',
  'listing_removed',
  'listing_sold',
  'system',
];

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Recipient reference is required'],
      index: true,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    type: {
      type: String,
      enum: {
        values: NOTIFICATION_TYPES,
        message: '{VALUE} is not a valid notification type',
      },
      required: [true, 'Notification type is required'],
    },
    title: {
      type: String,
      required: [true, 'Notification title is required'],
      trim: true,
      maxlength: [100, 'Title cannot exceed 100 characters'],
    },
    message: {
      type: String,
      required: [true, 'Notification message is required'],
      trim: true,
      maxlength: [500, 'Message cannot exceed 500 characters'],
    },
    relatedBook: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Book',
      default: null,
    },
    relatedPurchaseRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchaseRequest',
      default: null,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for query performance and deduplication
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

// Partial unique compound index to prevent duplicate notifications during retries
notificationSchema.index(
  { recipient: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  }
);

export const Notification = mongoose.model('Notification', notificationSchema);

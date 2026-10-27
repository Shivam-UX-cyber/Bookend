import mongoose from 'mongoose';

export const REQUEST_STATUSES = ['pending', 'accepted', 'rejected', 'cancelled', 'completed'];

const purchaseRequestSchema = new mongoose.Schema(
  {
    book: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Book',
      required: [true, 'Book reference is required'],
    },
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Buyer reference is required'],
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Seller reference is required'],
    },
    message: {
      type: String,
      trim: true,
      maxlength: [500, 'Message cannot exceed 500 characters'],
      default: '',
    },
    status: {
      type: String,
      enum: {
        values: REQUEST_STATUSES,
        message: '{VALUE} is not a valid request status',
      },
      default: 'pending',
      index: true,
    },
    cancelledBy: {
      type: String,
      enum: {
        values: ['buyer', 'seller'],
        message: '{VALUE} is not a valid canceller role',
      },
      default: null,
    },
    cancellationReason: {
      type: String,
      trim: true,
      maxlength: [500, 'Cancellation reason cannot exceed 500 characters'],
      default: '',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for query performance
purchaseRequestSchema.index({ buyer: 1, createdAt: -1 });
purchaseRequestSchema.index({ seller: 1, createdAt: -1 });
purchaseRequestSchema.index({ book: 1, status: 1 });

// Prevent duplicate active requests (pending or accepted) from the same buyer for the same book
purchaseRequestSchema.index(
  { book: 1, buyer: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['pending', 'accepted'] } },
  }
);

// Invariant: At most one purchase request can be in 'accepted' status per book at any time
purchaseRequestSchema.index(
  { book: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'accepted' },
    name: 'unique_accepted_request_per_book',
  }
);

export const PurchaseRequest = mongoose.model('PurchaseRequest', purchaseRequestSchema);

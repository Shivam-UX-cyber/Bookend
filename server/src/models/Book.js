import mongoose from 'mongoose';

export const BOOK_CATEGORIES = [
  'Computer Science',
  'Mathematics',
  'Engineering',
  'Physics',
  'Chemistry',
  'Biology & Life Sciences',
  'Business & Economics',
  'Humanities & Social Sciences',
  'Literature & Languages',
  'Medicine & Health',
  'Law & Legal Studies',
  'Other',
];

export const BOOK_CONDITIONS = ['New', 'Like New', 'Good', 'Acceptable'];

export const BOOK_STATUSES = ['available', 'reserved', 'sold'];
export const MANUAL_BOOK_STATUSES = ['available', 'sold'];

const bookSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Book title is required'],
      trim: true,
      minlength: [2, 'Title must be at least 2 characters long'],
      maxlength: [150, 'Title cannot exceed 150 characters'],
    },
    author: {
      type: String,
      required: [true, 'Author is required'],
      trim: true,
      minlength: [2, 'Author must be at least 2 characters long'],
      maxlength: [100, 'Author cannot exceed 100 characters'],
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      minlength: [10, 'Description must be at least 10 characters long'],
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },
    category: {
      type: String,
      required: [true, 'Category / subject is required'],
      trim: true,
      enum: {
        values: BOOK_CATEGORIES,
        message: '{VALUE} is not a valid academic category',
      },
    },
    condition: {
      type: String,
      required: [true, 'Book condition is required'],
      trim: true,
      enum: {
        values: BOOK_CONDITIONS,
        message: '{VALUE} is not a valid condition',
      },
    },
    // Stored as integer number of paise (1 INR = 100 paise) to avoid floating point issues
    priceInPaise: {
      type: Number,
      required: [true, 'Selling price is required'],
      min: [100, 'Price must be at least ₹1 (100 paise)'],
      max: [10000000, 'Price cannot exceed ₹1,00,000'],
      validate: {
        validator: Number.isInteger,
        message: 'Price in paise must be an integer',
      },
    },
    imageUrl: {
      type: String,
      trim: true,
      default: '',
      validate: {
        validator: function (v) {
          if (!v) return true; // Optional
          return /^https?:\/\/.+/i.test(v);
        },
        message: 'Image URL must be a valid HTTP or HTTPS web address',
      },
    },
    isbn: {
      type: String,
      trim: true,
      default: '',
      validate: {
        validator: function (v) {
          if (!v) return true; // Optional
          const clean = v.replace(/[-\s]/g, '');
          return /^(97[89])?\d{9}[\dX]$/i.test(clean);
        },
        message: 'ISBN must be a valid 10 or 13-digit standard book identifier',
      },
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Seller reference is required'],
    },
    status: {
      type: String,
      enum: {
        values: BOOK_STATUSES,
        message: '{VALUE} is not a valid listing status',
      },
      default: 'available',
    },
    // Reference to accepted purchase request when the book is reserved for handover
    acceptedRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchaseRequest',
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual property to expose price in INR rupees (e.g. 450.00)
bookSchema.virtual('price').get(function () {
  if (typeof this.priceInPaise === 'number') {
    return this.priceInPaise / 100;
  }
  return undefined;
});

// Indexes for common queries and marketplace catalog search
bookSchema.index({ status: 1, createdAt: -1 });
bookSchema.index({ seller: 1, createdAt: -1 });
bookSchema.index({ status: 1, category: 1, createdAt: -1 });
bookSchema.index({ status: 1, category: 1, priceInPaise: 1 });
bookSchema.index({ status: 1, title: 1 });
bookSchema.index({ status: 1, author: 1 });

export const Book = mongoose.model('Book', bookSchema);

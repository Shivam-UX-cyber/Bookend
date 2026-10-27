import mongoose from 'mongoose';
import { Book, BOOK_CATEGORIES, BOOK_CONDITIONS, BOOK_STATUSES } from '../models/Book.js';
import { PurchaseRequest } from '../models/PurchaseRequest.js';
import { notifySafely } from '../services/notificationService.js';
import { runWithOptionalTransaction } from '../utils/transactionHelper.js';

/**
 * Escapes regex special characters to prevent ReDoS or malformed query attacks
 */
const escapeRegex = (str) => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Explicit Public Book Data Transfer Object (DTO)
 * Strips internal database fields like `acceptedRequest` and standardizes price.
 */
export const serializePublicBook = (bookDoc) => {
  if (!bookDoc) return null;
  const b = typeof bookDoc.toObject === 'function' ? bookDoc.toObject({ virtuals: true }) : { ...bookDoc };
  const price = b.price !== undefined ? b.price : (typeof b.priceInPaise === 'number' ? b.priceInPaise / 100 : 0);

  return {
    _id: b._id,
    id: b.id || b._id,
    title: b.title,
    author: b.author,
    description: b.description,
    category: b.category,
    condition: b.condition,
    price,
    priceInPaise: b.priceInPaise,
    imageUrl: b.imageUrl || '',
    isbn: b.isbn || '',
    seller: b.seller && typeof b.seller === 'object' ? {
      _id: b.seller._id,
      id: b.seller.id || b.seller._id,
      name: b.seller.name,
      displayName: b.seller.displayName || b.seller.name,
      avatarUrl: b.seller.avatarUrl || '',
    } : b.seller,
    status: b.status,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
};

/**
 * Public: Browse available books with search, filter, sort, and pagination
 * GET /api/books
 */
export const getBooks = async (req, res) => {
  try {
    const page = Math.min(1000, Math.max(1, parseInt(req.query.page, 10) || 1));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const skip = (page - 1) * limit;

    // Marketplace query always filters by available books
    const filter = { status: 'available' };

    // Search by title or author
    if (req.query.search && typeof req.query.search === 'string') {
      const trimmedSearch = req.query.search.trim().slice(0, 100);
      if (trimmedSearch.length > 0) {
        const safeRegex = new RegExp(escapeRegex(trimmedSearch), 'i');
        filter.$or = [
          { title: { $regex: safeRegex } },
          { author: { $regex: safeRegex } },
        ];
      }
    }

    // Category filter
    if (req.query.category && typeof req.query.category === 'string') {
      const trimmedCategory = req.query.category.trim();
      if (BOOK_CATEGORIES.includes(trimmedCategory)) {
        filter.category = trimmedCategory;
      }
    }

    // Condition filter
    if (req.query.condition && typeof req.query.condition === 'string') {
      const trimmedCondition = req.query.condition.trim();
      if (BOOK_CONDITIONS.includes(trimmedCondition)) {
        filter.condition = trimmedCondition;
      }
    }

    // Sorting options with deterministic _id tie-breaker
    let sort = { createdAt: -1, _id: -1 }; // Default: newest first
    if (req.query.sortBy === 'price_asc') {
      sort = { priceInPaise: 1, createdAt: -1, _id: -1 };
    } else if (req.query.sortBy === 'price_desc') {
      sort = { priceInPaise: -1, createdAt: -1, _id: -1 };
    } else if (req.query.sortBy === 'oldest') {
      sort = { createdAt: 1, _id: 1 };
    }

    const [rawBooks, total] = await Promise.all([
      Book.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate('seller', 'name displayName avatarUrl')
        .lean({ virtuals: true }),
      Book.countDocuments(filter),
    ]);

    const books = rawBooks.map(serializePublicBook);

    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      data: {
        books,
        pagination: {
          total,
          page,
          limit,
          totalPages,
          hasPrev: page > 1,
          hasNext: page < totalPages,
        },
      },
    });
  } catch (error) {
    console.error('[BookController: getBooks Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve book listings.',
    });
  }
};

/**
 * Public: Get single book details
 * GET /api/books/:id
 */
export const getBookById = async (req, res) => {
  try {
    const { id } = req.params;
    const book = await Book.findById(id).populate('seller', 'name displayName avatarUrl');

    if (!book) {
      return res.status(404).json({
        success: false,
        message: 'Book listing not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        book: serializePublicBook(book),
      },
    });
  } catch (error) {
    console.error('[BookController: getBookById Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve book details.',
    });
  }
};

/**
 * Authenticated: Create a new book listing
 * POST /api/books
 */
export const createBook = async (req, res) => {
  try {
    const { title, author, description, category, condition, price, isbn, imageUrl } = req.body;

    // Convert price (Rupees) to integer paise
    const priceInPaise = Math.round(Number(price) * 100);

    // Derive seller strictly from the authenticated session
    const seller = req.user._id;

    const book = new Book({
      title: title.trim(),
      author: author.trim(),
      description: description.trim(),
      category: category.trim(),
      condition: condition.trim(),
      priceInPaise,
      imageUrl: imageUrl ? imageUrl.trim() : '',
      isbn: isbn ? isbn.trim().replace(/[-\s]/g, '') : '',
      seller,
      status: 'available',
    });

    await book.save();
    await book.populate('seller', 'name displayName avatarUrl');

    return res.status(201).json({
      success: true,
      message: 'Book listing published successfully.',
      data: {
        book,
      },
    });
  } catch (error) {
    console.error('[BookController: createBook Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to publish book listing.',
    });
  }
};

/**
 * Authenticated: Retrieve current user's listings (available and sold)
 * GET /api/books/mine
 */
export const getMyBooks = async (req, res) => {
  try {
    const page = Math.min(1000, Math.max(1, parseInt(req.query.page, 10) || 1));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const skip = (page - 1) * limit;

    const filter = { seller: req.user._id };

    // Optional status filter for the owner
    if (req.query.status && typeof req.query.status === 'string' && BOOK_STATUSES.includes(req.query.status.trim())) {
      filter.status = req.query.status.trim();
    }

    const [rawBooks, total] = await Promise.all([
      Book.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .populate('seller', 'name displayName avatarUrl')
        .lean({ virtuals: true }),
      Book.countDocuments(filter),
    ]);

    const books = rawBooks.map((b) => ({
      ...b,
      price: b.price !== undefined ? b.price : (typeof b.priceInPaise === 'number' ? b.priceInPaise / 100 : 0),
    }));

    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      data: {
        books,
        pagination: {
          total,
          page,
          limit,
          totalPages,
          hasPrev: page > 1,
          hasNext: page < totalPages,
        },
      },
    });
  } catch (error) {
    console.error('[BookController: getMyBooks Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve your listings.',
    });
  }
};

/**
 * Authenticated: Update an owned book listing (details only, not status or seller)
 * PATCH /api/books/:id
 */
export const updateBook = async (req, res) => {
  try {
    const { id } = req.params;
    const book = await Book.findById(id);

    if (!book) {
      return res.status(404).json({
        success: false,
        message: 'Book listing not found.',
      });
    }

    // Authorization check: Verify ownership
    if (book.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to edit this listing.',
      });
    }

    // Business rule: Cannot edit listing if it is reserved or sold
    if (book.status === 'reserved' || book.status === 'sold' || book.acceptedRequest) {
      return res.status(400).json({
        success: false,
        message: `Cannot edit a book listing that is currently ${book.status}. Protected listing fields cannot be modified while an active reservation or sale exists.`,
      });
    }

    // Allowlisted update fields only
    const { title, author, description, category, condition, price, isbn, imageUrl } = req.body;

    if (title !== undefined) book.title = title.trim();
    if (author !== undefined) book.author = author.trim();
    if (description !== undefined) book.description = description.trim();
    if (category !== undefined) book.category = category.trim();
    if (condition !== undefined) book.condition = condition.trim();
    if (price !== undefined) book.priceInPaise = Math.round(Number(price) * 100);
    if (isbn !== undefined) book.isbn = isbn ? isbn.trim().replace(/[-\s]/g, '') : '';
    if (imageUrl !== undefined) book.imageUrl = imageUrl ? imageUrl.trim() : '';

    await book.save();
    await book.populate('seller', 'name displayName avatarUrl');

    return res.status(200).json({
      success: true,
      message: 'Listing updated successfully.',
      data: {
        book,
      },
    });
  } catch (error) {
    console.error('[BookController: updateBook Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update book listing.',
    });
  }
};

/**
 * Authenticated: Update listing status (available or sold)
 * PATCH /api/books/:id/status
 */
export const updateBookStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const book = await Book.findById(id);

    if (!book) {
      return res.status(404).json({
        success: false,
        message: 'Book listing not found.',
      });
    }

    // Authorization check: Verify ownership
    if (book.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to change the status of this listing.',
      });
    }

    // Business rule: If book is currently reserved, status cannot be manually toggled
    if (book.status === 'reserved' || book.acceptedRequest) {
      return res.status(400).json({
        success: false,
        message: 'Cannot manually change the status of a reserved book. Please cancel the reservation or complete the sale through the Purchase Requests dashboard.',
      });
    }

    const newStatus = status.trim();

    if (!['available', 'sold'].includes(newStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status transition. Manual status updates only permit "available" or "sold". Reservations are managed exclusively through the purchase request lifecycle.',
      });
    }

    let updatedBook = null;
    let pendingRequests = [];

    await runWithOptionalTransaction(async (session) => {
      // Atomic conditional update to guard against concurrent reservation
      updatedBook = await Book.findOneAndUpdate(
        {
          _id: id,
          status: { $in: ['available', 'sold'] },
          acceptedRequest: null,
        },
        {
          $set: {
            status: newStatus,
            acceptedRequest: null,
          },
        },
        { new: true, session: session || undefined }
      );

      if (!updatedBook) {
        return;
      }

      // If seller manually marks as sold, reject any pending purchase requests
      if (newStatus === 'sold') {
        pendingRequests = await PurchaseRequest.find({
          book: id,
          status: 'pending',
        })
          .select('_id buyer')
          .session(session || null);

        if (pendingRequests.length > 0) {
          try {
            await PurchaseRequest.updateMany(
              {
                book: id,
                status: 'pending',
              },
              {
                $set: {
                  status: 'rejected',
                  cancellationReason: 'The seller marked this listing as sold.',
                },
              },
              { session: session || undefined }
            );
          } catch (updateErr) {
            // Compensate for standalone MongoDB: revert book to available if requests couldn't be rejected
            if (!session && updatedBook) {
              try {
                await Book.updateOne(
                  { _id: id, status: 'sold', acceptedRequest: null },
                  { $set: { status: 'available' } }
                );
              } catch (compErr) {
                console.error('[Rollback Error: updateBookStatus]', compErr);
              }
            }
            throw updateErr;
          }
        }
      }
    });

    if (!updatedBook) {
      return res.status(400).json({
        success: false,
        message: 'Cannot update listing status: book is currently reserved or not in a modifiable status.',
      });
    }

    if (newStatus === 'sold' && pendingRequests.length > 0) {
      for (const pr of pendingRequests) {
        await notifySafely({
          recipient: pr.buyer,
          actor: req.user._id,
          type: 'listing_sold',
          title: 'Book Marked as Sold',
          message: `The seller marked "${book.title}" as sold.`,
          relatedBook: id,
          relatedPurchaseRequest: pr._id,
          idempotencyKey: `listing_sold_${pr._id}`,
        });
      }
    }

    await updatedBook.populate('seller', 'name displayName avatarUrl');

    return res.status(200).json({
      success: true,
      message: `Listing marked as ${updatedBook.status}.`,
      data: {
        book: updatedBook,
      },
    });
  } catch (error) {
    console.error('[BookController: updateBookStatus Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update listing status.',
    });
  }
};

/**
 * Authenticated: Delete an owned book listing
 * DELETE /api/books/:id
 */
export const deleteBook = async (req, res) => {
  try {
    const { id } = req.params;
    const book = await Book.findById(id);

    if (!book) {
      return res.status(404).json({
        success: false,
        message: 'Book listing not found.',
      });
    }

    // Authorization check: Verify ownership
    if (book.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to delete this listing.',
      });
    }

    // Business rule: Cannot delete listing if it is reserved or sold
    if (book.status === 'reserved' || book.status === 'sold' || book.acceptedRequest) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete a book listing that is currently ${book.status}. Listings with active reservations or completed sales cannot be removed.`,
      });
    }

    let deletedBook = null;
    let pendingRequests = [];

    await runWithOptionalTransaction(async (session) => {
      // Atomic conditional deletion to prevent deleting a book that became reserved concurrently
      deletedBook = await Book.findOneAndDelete(
        {
          _id: id,
          status: 'available',
          acceptedRequest: null,
        },
        { session: session || undefined }
      );

      if (!deletedBook) {
        return;
      }

      // Clean up any pending purchase requests for this deleted book so they are not left orphaned
      pendingRequests = await PurchaseRequest.find({
        book: id,
        status: 'pending',
      })
        .select('_id buyer')
        .session(session || null);

      if (pendingRequests.length > 0) {
        try {
          await PurchaseRequest.updateMany(
            {
              book: id,
              status: 'pending',
            },
            {
              $set: {
                status: 'rejected',
                cancellationReason: 'This listing was removed by the seller.',
              },
            },
            { session: session || undefined }
          );
        } catch (updateErr) {
          // Compensate for standalone MongoDB: restore deleted book document if request cleanup failed
          if (!session && deletedBook) {
            try {
              await Book.create([deletedBook.toObject()]);
            } catch (compErr) {
              console.error('[Rollback Error: deleteBook restoration failed]', compErr);
            }
          }
          throw updateErr;
        }
      }
    });

    if (!deletedBook) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete listing: book is no longer available or has an active reservation.',
      });
    }

    for (const pr of pendingRequests) {
      await notifySafely({
        recipient: pr.buyer,
        actor: req.user._id,
        type: 'listing_removed',
        title: 'Listing Removed by Seller',
        message: `The listing for "${book.title}" was removed by the seller.`,
        relatedBook: id,
        relatedPurchaseRequest: pr._id,
        idempotencyKey: `listing_removed_${pr._id}`,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Listing deleted successfully.',
    });
  } catch (error) {
    console.error('[BookController: deleteBook Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete book listing.',
    });
  }
};

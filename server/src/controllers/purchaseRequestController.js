import mongoose from 'mongoose';
import { PurchaseRequest, REQUEST_STATUSES } from '../models/PurchaseRequest.js';
import { Book } from '../models/Book.js';
import { runWithOptionalTransaction } from '../utils/transactionHelper.js';
import { notifySafely } from '../services/notificationService.js';

/**
 * Authenticated: Submit a purchase request for an available book
 * POST /api/purchase-requests
 */
export const createPurchaseRequest = async (req, res) => {
  try {
    const { bookId, message } = req.body;
    const buyerId = req.user._id;

    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({
        success: false,
        message: 'Book listing not found.',
      });
    }

    // Business rule: Buyer cannot request their own book
    if (book.seller.toString() === buyerId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot submit a purchase request for your own book.',
      });
    }

    // Business rule: Book must be available and not already reserved
    if (book.status !== 'available') {
      return res.status(400).json({
        success: false,
        message: 'This book is marked as sold and is not available for purchase.',
      });
    }

    if (book.acceptedRequest) {
      return res.status(409).json({
        success: false,
        message: 'This book is currently reserved by an accepted purchase request.',
      });
    }

    // Business rule: No duplicate active requests (pending or accepted) from the same buyer
    const existingActiveRequest = await PurchaseRequest.findOne({
      book: book._id,
      buyer: buyerId,
      status: { $in: ['pending', 'accepted'] },
    });

    if (existingActiveRequest) {
      return res.status(409).json({
        success: false,
        message: 'You already have an active purchase request for this book.',
        data: {
          request: existingActiveRequest,
        },
      });
    }

    const purchaseRequest = new PurchaseRequest({
      book: book._id,
      buyer: buyerId,
      seller: book.seller,
      message: message ? message.trim() : '',
      status: 'pending',
    });

    await purchaseRequest.save();

    await purchaseRequest.populate([
      {
        path: 'book',
        select: 'title author price priceInPaise imageUrl status category condition',
      },
      {
        path: 'seller',
        select: 'name',
      },
      {
        path: 'buyer',
        select: 'name',
      },
    ]);

    await notifySafely({
      recipient: book.seller,
      actor: buyerId,
      type: 'purchase_request_created',
      title: 'New Purchase Request',
      message: `${req.user.name || 'A student'} submitted a purchase request for "${book.title}".`,
      relatedBook: book._id,
      relatedPurchaseRequest: purchaseRequest._id,
      idempotencyKey: `request_created_${purchaseRequest._id}`,
    });

    return res.status(201).json({
      success: true,
      message: 'Purchase request submitted successfully.',
      data: {
        request: purchaseRequest,
      },
    });
  } catch (error) {
    // Handle duplicate key error from partial unique index
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'You already have an active purchase request for this book.',
      });
    }
    console.error('[PurchaseRequestController: createPurchaseRequest Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit purchase request.',
    });
  }
};

/**
 * Authenticated: Retrieve requests sent by the current user (as buyer)
 * GET /api/purchase-requests/sent
 */
export const getSentRequests = async (req, res) => {
  try {
    const page = Math.min(1000, Math.max(1, parseInt(req.query.page, 10) || 1));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const skip = (page - 1) * limit;

    const filter = { buyer: req.user._id };

    if (req.query.status && typeof req.query.status === 'string' && REQUEST_STATUSES.includes(req.query.status.trim())) {
      filter.status = req.query.status.trim();
    }

    if (req.query.bookId && typeof req.query.bookId === 'string' && mongoose.isValidObjectId(req.query.bookId)) {
      filter.book = req.query.bookId;
    }

    const [rawRequests, total] = await Promise.all([
      PurchaseRequest.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .populate([
          {
            path: 'book',
            select: 'title author price priceInPaise imageUrl status category condition',
          },
          {
            path: 'seller',
            select: 'name',
          },
        ])
        .lean({ virtuals: true }),
      PurchaseRequest.countDocuments(filter),
    ]);

    const requests = rawRequests.map((r) => {
      if (r.book && typeof r.book === 'object') {
        r.book.price = r.book.price !== undefined ? r.book.price : (typeof r.book.priceInPaise === 'number' ? r.book.priceInPaise / 100 : 0);
      }
      return r;
    });

    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      data: {
        requests,
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
    console.error('[PurchaseRequestController: getSentRequests Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve sent purchase requests.',
    });
  }
};

/**
 * Authenticated: Retrieve requests received by the current user (as seller)
 * GET /api/purchase-requests/received
 */
export const getReceivedRequests = async (req, res) => {
  try {
    const page = Math.min(1000, Math.max(1, parseInt(req.query.page, 10) || 1));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const skip = (page - 1) * limit;

    const filter = { seller: req.user._id };

    if (req.query.status && typeof req.query.status === 'string' && REQUEST_STATUSES.includes(req.query.status.trim())) {
      filter.status = req.query.status.trim();
    }

    if (req.query.bookId && typeof req.query.bookId === 'string' && mongoose.isValidObjectId(req.query.bookId)) {
      filter.book = req.query.bookId;
    }

    const [rawRequests, total] = await Promise.all([
      PurchaseRequest.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .populate([
          {
            path: 'book',
            select: 'title author price priceInPaise imageUrl status category condition',
          },
          {
            path: 'buyer',
            select: 'name',
          },
        ])
        .lean({ virtuals: true }),
      PurchaseRequest.countDocuments(filter),
    ]);

    const requests = rawRequests.map((r) => {
      if (r.book && typeof r.book === 'object') {
        r.book.price = r.book.price !== undefined ? r.book.price : (typeof r.book.priceInPaise === 'number' ? r.book.priceInPaise / 100 : 0);
      }
      return r;
    });

    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      data: {
        requests,
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
    console.error('[PurchaseRequestController: getReceivedRequests Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve received purchase requests.',
    });
  }
};

/**
 * Authenticated: Retrieve a single request by ID (authorized for buyer or seller only)
 * GET /api/purchase-requests/:id
 */
export const getRequestById = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await PurchaseRequest.findById(id).populate([
      {
        path: 'book',
        select: 'title author price priceInPaise imageUrl status category condition',
      },
      {
        path: 'buyer',
        select: 'name',
      },
      {
        path: 'seller',
        select: 'name',
      },
    ]);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Purchase request not found.',
      });
    }

    const currentUserId = req.user._id.toString();
    const isBuyer = request.buyer?._id?.toString() === currentUserId || request.buyer?.toString() === currentUserId;
    const isSeller = request.seller?._id?.toString() === currentUserId || request.seller?.toString() === currentUserId;

    if (!isBuyer && !isSeller) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to view this purchase request.',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        request,
      },
    });
  } catch (error) {
    console.error('[PurchaseRequestController: getRequestById Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve purchase request details.',
    });
  }
};

/**
 * Authenticated: Seller responds to request (accept or reject)
 * PATCH /api/purchase-requests/:id/respond
 */
export const respondToRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await PurchaseRequest.findById(id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Purchase request not found.',
      });
    }

    // Authorization: Only the seller may accept or reject
    if (request.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only the seller can accept or reject this purchase request.',
      });
    }

    // Business rule: Only pending requests can be transitioned
    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot respond to a request that is already ${request.status}.`,
      });
    }

    const action = req.normalizedAction || (req.body.action?.toLowerCase().startsWith('accept') ? 'accept' : 'reject');

    if (action === 'reject') {
      const rejectedRequest = await PurchaseRequest.findOneAndUpdate(
        {
          _id: request._id,
          status: 'pending',
        },
        {
          $set: {
            status: 'rejected',
            cancellationReason: req.body.reason ? req.body.reason.trim() : '',
          },
        },
        { new: true }
      );

      if (!rejectedRequest) {
        const currentReq = await PurchaseRequest.findById(id);
        return res.status(400).json({
          success: false,
          message: `Cannot respond to a request that is already ${currentReq?.status || 'finalized'}.`,
        });
      }

      await rejectedRequest.populate([
        {
          path: 'book',
          select: 'title author price priceInPaise imageUrl status category condition',
        },
        {
          path: 'buyer',
          select: 'name',
        },
        {
          path: 'seller',
          select: 'name',
        },
      ]);

      const reasonText = req.body.reason ? ` Reason: ${req.body.reason.trim()}` : '';
      await notifySafely({
        recipient: rejectedRequest.buyer?._id || rejectedRequest.buyer,
        actor: req.user._id,
        type: 'purchase_request_rejected',
        title: 'Purchase Request Declined',
        message: `${req.user.name || 'The seller'} declined your purchase request for "${rejectedRequest.book?.title || 'the book'}".${reasonText}`,
        relatedBook: request.book,
        relatedPurchaseRequest: rejectedRequest._id,
        idempotencyKey: `request_rejected_${rejectedRequest._id}`,
      });

      return res.status(200).json({
        success: true,
        message: 'Purchase request rejected.',
        data: {
          request: rejectedRequest,
        },
      });
    }

    // Action === 'accept'
    // CONCURRENCY CONTROL / OVERSOLD PREVENTION:
    // Atomically find the book if status is 'available' and acceptedRequest is null, and bind this request with status 'reserved'
    let updatedBook = null;
    let savedRequest = null;

    await runWithOptionalTransaction(async (session) => {
      updatedBook = await Book.findOneAndUpdate(
        {
          _id: request.book,
          status: 'available',
          acceptedRequest: null,
        },
        {
          $set: {
            status: 'reserved',
            acceptedRequest: request._id,
          },
        },
        { new: true, session: session || undefined }
      );

      if (!updatedBook) {
        const error = new Error('CANNOT_ACCEPT_CONFLICT');
        error.isConflict = true;
        throw error;
      }

      let requestUpdated = false;
      try {
        // Atomically transition the request from pending to accepted
        savedRequest = await PurchaseRequest.findOneAndUpdate(
          {
            _id: request._id,
            status: 'pending',
          },
          {
            $set: {
              status: 'accepted',
            },
          },
          { new: true, session: session || undefined }
        );

        if (!savedRequest) {
          const error = new Error('CANNOT_ACCEPT_CONFLICT');
          error.isConflict = true;
          throw error;
        }
        requestUpdated = true;
      } catch (step2Error) {
        // Concurrency-safe, conditional rollback for standalone MongoDB:
        // Revert ONLY if running outside a transaction and the request update did not succeed.
        // Guard condition { _id: request.book, status: 'reserved', acceptedRequest: request._id }
        // guarantees we never overwrite concurrent modifications.
        if (!session && !requestUpdated) {
          try {
            await Book.updateOne(
              { _id: request.book, status: 'reserved', acceptedRequest: request._id },
              { $set: { status: 'available', acceptedRequest: null } }
            );
          } catch (compErr) {
            console.error('[Rollback Compensation Failure: respondToRequest]', compErr);
          }
        }
        throw step2Error;
      }
    });

    await savedRequest.populate([
      {
        path: 'book',
        select: 'title author price priceInPaise imageUrl status category condition',
      },
      {
        path: 'buyer',
        select: 'name',
      },
      {
        path: 'seller',
        select: 'name',
      },
    ]);

    await notifySafely({
      recipient: savedRequest.buyer?._id || savedRequest.buyer,
      actor: req.user._id,
      type: 'purchase_request_accepted',
      title: 'Purchase Request Accepted',
      message: `${req.user.name || 'The seller'} accepted your purchase request for "${savedRequest.book?.title || updatedBook.title}". The book is now reserved for you.`,
      relatedBook: request.book,
      relatedPurchaseRequest: savedRequest._id,
      idempotencyKey: `request_accepted_${savedRequest._id}`,
    });

    return res.status(200).json({
      success: true,
      message: 'Purchase request accepted! The book is now reserved for handover with the buyer.',
      data: {
        request: savedRequest,
        book: updatedBook,
      },
    });
  } catch (error) {
    if (error.isConflict || error.message === 'CANNOT_ACCEPT_CONFLICT' || error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Cannot accept request: This book is no longer available or has already been reserved by another accepted purchase request.',
      });
    }
    console.error('[PurchaseRequestController: respondToRequest Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process purchase request response.',
    });
  }
};

/**
 * Authenticated: Cancel a pending request (buyer) or an accepted reservation (buyer or seller)
 * PATCH /api/purchase-requests/:id/cancel
 */
export const cancelRequest = async (req, res) => {
  try {
    const { id } = req.params;
    let request = await PurchaseRequest.findById(id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Purchase request not found.',
      });
    }

    const currentUserId = req.user._id.toString();
    const isBuyer = request.buyer.toString() === currentUserId;
    const isSeller = request.seller.toString() === currentUserId;

    // Terminal states cannot be cancelled
    if (['cancelled', 'rejected', 'completed'].includes(request.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a request that is already ${request.status}.`,
      });
    }

    // Cancellation of a pending request: ONLY the buyer can cancel
    if (request.status === 'pending') {
      if (!isBuyer) {
        return res.status(403).json({
          success: false,
          message: 'Only the buyer can cancel their own pending purchase request.',
        });
      }

      // Atomically update only if status is still pending
      const updatedRequest = await PurchaseRequest.findOneAndUpdate(
        {
          _id: request._id,
          status: 'pending',
        },
        {
          $set: {
            status: 'cancelled',
            cancelledBy: 'buyer',
            cancellationReason: req.body.reason ? req.body.reason.trim() : '',
          },
        },
        { new: true }
      );

      if (!updatedRequest) {
        // Concurrently transitioned: re-fetch to see if seller concurrently accepted it
        const currentReq = await PurchaseRequest.findById(id);
        if (currentReq && currentReq.status === 'accepted') {
          // Seller concurrently accepted it! Proceed to accepted reservation cancellation!
          request = currentReq;
        } else {
          return res.status(400).json({
            success: false,
            message: `Cannot cancel a request that is already ${currentReq?.status || 'finalized'}.`,
          });
        }
      } else {
        await updatedRequest.populate([
          {
            path: 'book',
            select: 'title author price priceInPaise imageUrl status category condition',
          },
          {
            path: 'seller',
            select: 'name',
          },
          {
            path: 'buyer',
            select: 'name',
          },
        ]);

        await notifySafely({
          recipient: updatedRequest.seller?._id || updatedRequest.seller,
          actor: req.user._id,
          type: 'purchase_request_cancelled',
          title: 'Purchase Request Cancelled',
          message: `${req.user.name || 'The buyer'} cancelled their purchase request for "${updatedRequest.book?.title || 'the book'}".`,
          relatedBook: updatedRequest.book?._id || updatedRequest.book,
          relatedPurchaseRequest: updatedRequest._id,
          idempotencyKey: `request_cancelled_${updatedRequest._id}`,
        });

        return res.status(200).json({
          success: true,
          message: 'Purchase request cancelled successfully.',
          data: {
            request: updatedRequest,
          },
        });
      }
    }

    // Cancellation of an accepted request: EITHER buyer or seller can cancel before completion!
    if (request.status === 'accepted') {
      if (!isBuyer && !isSeller) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to cancel this accepted reservation.',
        });
      }

      let updatedBook = null;
      let savedRequest = null;

      await runWithOptionalTransaction(async (session) => {
        // Atomically release the reservation on the book back to 'available'
        updatedBook = await Book.findOneAndUpdate(
          {
            _id: request.book,
            status: 'reserved',
            acceptedRequest: request._id,
          },
          {
            $set: {
              status: 'available',
              acceptedRequest: null,
            },
          },
          { new: true, session: session || undefined }
        );

        if (!updatedBook) {
          const error = new Error('CANCEL_RESERVATION_CONFLICT');
          error.isConflict = true;
          throw error;
        }

        let requestCancelled = false;
        try {
          savedRequest = await PurchaseRequest.findOneAndUpdate(
            {
              _id: request._id,
              status: 'accepted',
            },
            {
              $set: {
                status: 'cancelled',
                cancelledBy: isBuyer ? 'buyer' : 'seller',
                cancellationReason: req.body.reason ? req.body.reason.trim() : '',
              },
            },
            { new: true, session: session || undefined }
          );

          if (!savedRequest) {
            const error = new Error('CANCEL_RESERVATION_CONFLICT');
            error.isConflict = true;
            throw error;
          }
          requestCancelled = true;
        } catch (step2Error) {
          // Compensating conditional rollback for standalone MongoDB
          if (!session && !requestCancelled) {
            try {
              await Book.updateOne(
                { _id: request.book, acceptedRequest: null, status: 'available' },
                { $set: { status: 'reserved', acceptedRequest: request._id } }
              );
            } catch (compErr) {
              console.error('[Rollback Compensation Failure: cancelRequest]', compErr);
            }
          }
          throw step2Error;
        }
      });

      await savedRequest.populate([
        {
          path: 'book',
          select: 'title author price priceInPaise imageUrl status category condition',
        },
        {
          path: 'seller',
          select: 'name',
        },
        {
          path: 'buyer',
          select: 'name',
        },
      ]);

      const targetRecipient = isBuyer
        ? (savedRequest.seller?._id || savedRequest.seller)
        : (savedRequest.buyer?._id || savedRequest.buyer);
      const cancellerRole = isBuyer ? 'The buyer' : 'The seller';

      await notifySafely({
        recipient: targetRecipient,
        actor: req.user._id,
        type: 'reservation_cancelled',
        title: 'Book Reservation Cancelled',
        message: `${req.user.name || cancellerRole} cancelled the reservation for "${savedRequest.book?.title || updatedBook?.title || 'the book'}". The book is available again.`,
        relatedBook: request.book,
        relatedPurchaseRequest: savedRequest._id,
        idempotencyKey: `reservation_cancelled_${savedRequest._id}`,
      });

      return res.status(200).json({
        success: true,
        message: 'Reservation cancelled successfully and the book has been released back to available.',
        data: {
          request: savedRequest,
          book: updatedBook,
        },
      });
    }

    return res.status(400).json({
      success: false,
      message: `Invalid state for cancellation: ${request.status}.`,
    });
  } catch (error) {
    if (error.isConflict || error.message === 'CANCEL_RESERVATION_CONFLICT') {
      return res.status(409).json({
        success: false,
        message: 'Cancellation conflict: The reservation could not be released because the book has already been sold or is no longer reserved for this request.',
      });
    }
    console.error('[PurchaseRequestController: cancelRequest Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to cancel purchase request.',
    });
  }
};

/**
 * Authenticated: Seller confirms sale completion for an accepted request
 * PATCH /api/purchase-requests/:id/complete
 */
export const completeSale = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await PurchaseRequest.findById(id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Purchase request not found.',
      });
    }

    // Authorization: Only the seller can confirm the sale
    if (request.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only the seller can confirm sale completion.',
      });
    }

    if (request.status === 'completed') {
      return res.status(409).json({
        success: false,
        message: 'This sale has already been confirmed as completed.',
      });
    }

    if (request.status !== 'accepted') {
      return res.status(400).json({
        success: false,
        message: `Cannot complete a sale for a request in '${request.status}' status. Only accepted reservations can be completed.`,
      });
    }

    let updatedBook = null;
    let savedRequest = null;
    let competingRequests = [];

    await runWithOptionalTransaction(async (session) => {
      // Find competing pending requests before they are rejected so buyers can be notified
      competingRequests = await PurchaseRequest.find({
        book: request.book,
        _id: { $ne: request._id },
        status: 'pending',
      })
        .select('_id buyer')
        .session(session || null);

      // Atomically mark the book as sold where status is 'reserved' and acceptedRequest matches this request
      updatedBook = await Book.findOneAndUpdate(
        {
          _id: request.book,
          status: 'reserved',
          acceptedRequest: request._id,
        },
        {
          $set: {
            status: 'sold',
          },
        },
        { new: true, session: session || undefined }
      );

      if (!updatedBook) {
        const error = new Error('COMPLETE_SALE_CONFLICT');
        error.isConflict = true;
        throw error;
      }

      let saleCompleted = false;
      let competingRejected = false;

      try {
        savedRequest = await PurchaseRequest.findOneAndUpdate(
          {
            _id: request._id,
            status: 'accepted',
          },
          {
            $set: {
              status: 'completed',
            },
          },
          { new: true, session: session || undefined }
        );

        if (!savedRequest) {
          const error = new Error('COMPLETE_SALE_CONFLICT');
          error.isConflict = true;
          throw error;
        }
        saleCompleted = true;

        // Automatically transition all other competing pending requests for this book to rejected
        await PurchaseRequest.updateMany(
          {
            book: request.book,
            _id: { $ne: request._id },
            status: 'pending',
          },
          {
            $set: {
              status: 'rejected',
              cancellationReason: 'The book was sold to another buyer.',
            },
          },
          { session: session || undefined }
        );
        competingRejected = true;
      } catch (saleErr) {
        // Compensating conditional rollback for standalone MongoDB
        if (!session) {
          try {
            if (saleCompleted && !competingRejected) {
              await PurchaseRequest.updateOne(
                { _id: request._id, status: 'completed' },
                { $set: { status: 'accepted' } }
              );
            }
            await Book.updateOne(
              { _id: request.book, status: 'sold', acceptedRequest: request._id },
              { $set: { status: 'reserved' } }
            );
          } catch (compErr) {
            console.error('[Rollback Compensation Failure: completeSale]', compErr);
          }
        }
        throw saleErr;
      }
    });

    await savedRequest.populate([
      {
        path: 'book',
        select: 'title author price priceInPaise imageUrl status category condition',
      },
      {
        path: 'seller',
        select: 'name',
      },
      {
        path: 'buyer',
        select: 'name',
      },
    ]);

    // Notify the buyer who purchased the book
    await notifySafely({
      recipient: savedRequest.buyer?._id || savedRequest.buyer,
      actor: req.user._id,
      type: 'sale_completed',
      title: 'Sale Completed',
      message: `${req.user.name || 'The seller'} confirmed that the sale of "${savedRequest.book?.title || updatedBook?.title || 'the book'}" is complete.`,
      relatedBook: request.book,
      relatedPurchaseRequest: savedRequest._id,
      idempotencyKey: `sale_completed_${savedRequest._id}`,
    });

    // Notify competing pending request buyers that book was sold
    for (const compReq of competingRequests) {
      await notifySafely({
        recipient: compReq.buyer,
        actor: req.user._id,
        type: 'competing_request_rejected',
        title: 'Book Sold to Another Student',
        message: `"${savedRequest.book?.title || updatedBook?.title || 'A textbook you requested'}" was sold to another buyer.`,
        relatedBook: request.book,
        relatedPurchaseRequest: compReq._id,
        idempotencyKey: `competing_rejected_${compReq._id}`,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Sale confirmed as complete! The book is now marked as sold.',
      data: {
        request: savedRequest,
        book: updatedBook,
      },
    });
  } catch (error) {
    if (error.isConflict || error.message === 'COMPLETE_SALE_CONFLICT') {
      return res.status(409).json({
        success: false,
        message: 'Sale confirmation conflict: This book is no longer reserved for this request or has already been marked as sold/cancelled.',
      });
    }
    console.error('[PurchaseRequestController: completeSale Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to complete sale.',
    });
  }
};


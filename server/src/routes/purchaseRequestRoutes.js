import express from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  validateRequestId,
  validateCreatePurchaseRequest,
  validateRespondPurchaseRequest,
  validateCancelPurchaseRequest,
} from '../middleware/purchaseRequestValidation.js';
import {
  createPurchaseRequest,
  getSentRequests,
  getReceivedRequests,
  getRequestById,
  respondToRequest,
  cancelRequest,
  completeSale,
} from '../controllers/purchaseRequestController.js';

const router = express.Router();

/**
 * Static paths must be defined before dynamic parameterized paths (/:id)
 */

// POST /api/purchase-requests - Submit purchase request
router.post('/', requireAuth, validateCreatePurchaseRequest, createPurchaseRequest);

// GET /api/purchase-requests/sent - Buyer's sent requests
router.get('/sent', requireAuth, getSentRequests);

// GET /api/purchase-requests/received - Seller's received requests
router.get('/received', requireAuth, getReceivedRequests);

// GET /api/purchase-requests/:id - Retrieve request details
router.get('/:id', requireAuth, validateRequestId, getRequestById);

// PATCH /api/purchase-requests/:id/respond - Seller accepts or rejects
router.patch('/:id/respond', requireAuth, validateRequestId, validateRespondPurchaseRequest, respondToRequest);

// PATCH /api/purchase-requests/:id/cancel - Buyer cancels pending request or buyer/seller cancels accepted reservation
router.patch('/:id/cancel', requireAuth, validateRequestId, validateCancelPurchaseRequest, cancelRequest);

// PATCH /api/purchase-requests/:id/complete - Seller confirms sale completion
router.patch('/:id/complete', requireAuth, validateRequestId, completeSale);

export default router;

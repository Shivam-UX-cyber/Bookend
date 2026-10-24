import test from 'node:test';
import assert from 'node:assert';
import { REQUEST_STATUS_LABELS, purchaseRequestService } from '../src/services/purchaseRequestService.js';

test('1. REQUEST_STATUS_LABELS mapping integrity', () => {
  assert.strictEqual(REQUEST_STATUS_LABELS.pending, 'Pending Review');
  assert.strictEqual(REQUEST_STATUS_LABELS.accepted, 'Accepted');
  assert.strictEqual(REQUEST_STATUS_LABELS.completed, 'Completed');
  assert.strictEqual(REQUEST_STATUS_LABELS.rejected, 'Rejected');
  assert.strictEqual(REQUEST_STATUS_LABELS.cancelled, 'Cancelled');
});

test('2. purchaseRequestService method definitions', () => {
  assert.strictEqual(typeof purchaseRequestService.createRequest, 'function');
  assert.strictEqual(typeof purchaseRequestService.getSentRequests, 'function');
  assert.strictEqual(typeof purchaseRequestService.getReceivedRequests, 'function');
  assert.strictEqual(typeof purchaseRequestService.getRequestById, 'function');
  assert.strictEqual(typeof purchaseRequestService.respondToRequest, 'function');
  assert.strictEqual(typeof purchaseRequestService.cancelRequest, 'function');
  assert.strictEqual(typeof purchaseRequestService.completeSale, 'function');
});


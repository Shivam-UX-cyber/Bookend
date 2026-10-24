process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Book } from '../src/models/Book.js';
import { PurchaseRequest } from '../src/models/PurchaseRequest.js';
import { generateAuthToken } from '../src/services/tokenService.js';

console.log('🧪 Starting Purchase Request System Integration Test Suite...\n');

let mongod;
let app;

async function setup() {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectDB(uri);
  const serverModule = await import('../src/server.js');
  app = serverModule.default;
}

async function cleanup() {
  await disconnectDB();
  if (mongod) {
    await mongod.stop();
  }
}

async function clearCollections() {
  await User.deleteMany({});
  await Book.deleteMany({});
  await PurchaseRequest.deleteMany({});
}

async function runPurchaseRequestIntegrationTests() {
  await setup();

  try {
    const createUserSession = async (name, email) => {
      const user = await User.create({
        name,
        email,
        password: '$2a$12$eX4mPL3h45h1nGf0rT3sT1nGPuRP05e50nLY0000000000000000',
        isVerified: true,
        tokenVersion: 0,
      });
      const token = generateAuthToken(user);
      return { user, token, cookie: `authToken=${token}` };
    };

    const createTestBook = async (sellerId, overrides = {}) => {
      return await Book.create({
        title: 'Operating System Concepts',
        author: 'Silberschatz, Galvin, Gagne',
        description: 'Comprehensive introduction to operating systems principles, concurrency, memory management.',
        category: 'Computer Science',
        condition: 'Good',
        priceInPaise: 95000, // ₹950
        seller: sellerId,
        status: 'available',
        ...overrides,
      });
    };

    // -------------------------------------------------------------------------
    // TEST 1: Authenticated buyer creates a valid request
    // -------------------------------------------------------------------------
    console.log('▶ [1/11] Testing Valid Purchase Request Creation...');
    await clearCollections();
    const sellerAlice = await createUserSession('Alice Seller', 'alice.seller@gmail.com');
    const buyerBob = await createUserSession('Bob Buyer', 'bob.buyer@gmail.com');
    const book = await createTestBook(sellerAlice.user._id);

    const res1 = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({
        bookId: book._id.toString(),
        message: 'Hi Alice, I need this for CS201. Can we meet at the campus library?',
      });

    assert.strictEqual(res1.status, 201, 'Should return 201 Created');
    assert.strictEqual(res1.body.success, true);
    assert.strictEqual(res1.body.data.request.status, 'pending');
    assert.strictEqual(res1.body.data.request.message, 'Hi Alice, I need this for CS201. Can we meet at the campus library?');
    assert.strictEqual(res1.body.data.request.book._id.toString(), book._id.toString());
    assert.strictEqual(res1.body.data.request.seller.name, 'Alice Seller');
    assert.strictEqual(res1.body.data.request.seller.email, undefined, 'Private email must not be exposed');
    assert.strictEqual(res1.body.data.request.buyer.name, 'Bob Buyer');
    console.log('   ✓ Purchase request created with safe seller/buyer information and pending status.\n');

    // -------------------------------------------------------------------------
    // TEST 2: Unauthenticated requests are rejected
    // -------------------------------------------------------------------------
    console.log('▶ [2/11] Testing Unauthenticated Purchase Request Creation...');
    const res2 = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        bookId: book._id.toString(),
        message: 'Unauthenticated attempt',
      });

    assert.strictEqual(res2.status, 401, 'Should return 401 Unauthorized');
    assert.strictEqual(res2.body.success, false);
    console.log('   ✓ Unauthenticated purchase request rejected with 401.\n');

    // -------------------------------------------------------------------------
    // TEST 3: Buyer cannot request their own listing
    // -------------------------------------------------------------------------
    console.log('▶ [3/11] Testing Self-Request Prevention...');
    const res3 = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie]) // Alice owns the book
      .send({
        bookId: book._id.toString(),
        message: 'Trying to buy my own book',
      });

    assert.strictEqual(res3.status, 400, 'Should return 400 Bad Request');
    assert.strictEqual(res3.body.success, false);
    assert.match(res3.body.message, /own book/i);
    console.log('   ✓ Requesting own book listing rejected with 400.\n');

    // -------------------------------------------------------------------------
    // TEST 4: Sold or unavailable books cannot be requested
    // -------------------------------------------------------------------------
    console.log('▶ [4/11] Testing Requesting Sold or Reserved Books...');
    const soldBook = await createTestBook(sellerAlice.user._id, { status: 'sold' });

    const res4a = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({
        bookId: soldBook._id.toString(),
      });

    assert.strictEqual(res4a.status, 400, 'Should return 400 for sold book');
    assert.strictEqual(res4a.body.success, false);
    assert.match(res4a.body.message, /sold|not available/i);

    // Book reserved by another accepted request
    const dummyRequestId = new mongoose.Types.ObjectId();
    const reservedBook = await createTestBook(sellerAlice.user._id, { acceptedRequest: dummyRequestId });
    const res4b = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({
        bookId: reservedBook._id.toString(),
      });

    assert.strictEqual(res4b.status, 409, 'Should return 409 for reserved book');
    assert.strictEqual(res4b.body.success, false);
    console.log('   ✓ Requests for sold or reserved books correctly rejected.\n');

    // -------------------------------------------------------------------------
    // TEST 5: Invalid book IDs and messages are rejected
    // -------------------------------------------------------------------------
    console.log('▶ [5/11] Testing Validation of Malformed IDs & Messages...');
    // Malformed bookId
    const res5a = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({
        bookId: 'not-an-object-id',
      });
    assert.strictEqual(res5a.status, 400);

    // Non-existent bookId
    const res5b = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({
        bookId: new mongoose.Types.ObjectId().toString(),
      });
    assert.strictEqual(res5b.status, 404);

    // Message exceeding 500 characters
    const res5c = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({
        bookId: book._id.toString(),
        message: 'x'.repeat(501),
      });
    assert.strictEqual(res5c.status, 400);
    console.log('   ✓ Invalid book IDs and excessive message lengths rejected.\n');

    // -------------------------------------------------------------------------
    // TEST 6: Duplicate active requests are handled correctly
    // -------------------------------------------------------------------------
    console.log('▶ [6/11] Testing Duplicate Active Request Prevention...');
    // Bob already submitted a pending request for 'book' in Test 1
    const res6 = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({
        bookId: book._id.toString(),
        message: 'Second duplicate request attempt',
      });

    assert.strictEqual(res6.status, 409, 'Should return 409 Conflict for duplicate active request');
    assert.strictEqual(res6.body.success, false);
    assert.match(res6.body.message, /already have an active purchase request/i);
    console.log('   ✓ Duplicate active request prevented with 409 Conflict.\n');

    // -------------------------------------------------------------------------
    // TEST 7: Only the seller can accept or reject
    // -------------------------------------------------------------------------
    console.log('▶ [7/11] Testing Seller Authorization on Response (Accept/Reject)...');
    const existingReq = res1.body.data.request;
    const thirdUserCharlie = await createUserSession('Charlie Intruder', 'charlie.intruder@gmail.com');

    // Charlie (neither buyer nor seller) tries to accept
    const res7a = await request(app)
      .patch(`/api/purchase-requests/${existingReq._id}/respond`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [thirdUserCharlie.cookie])
      .send({ action: 'accept' });

    assert.strictEqual(res7a.status, 403, 'Should return 403 Forbidden for non-seller');

    // Bob (the buyer) tries to accept his own request
    const res7b = await request(app)
      .patch(`/api/purchase-requests/${existingReq._id}/respond`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({ action: 'accept' });

    assert.strictEqual(res7b.status, 403, 'Should return 403 Forbidden for buyer');

    console.log('   ✓ Non-seller response attempts blocked with 403 Forbidden.\n');

    // -------------------------------------------------------------------------
    // TEST 8: Only the buyer can cancel their pending request
    // -------------------------------------------------------------------------
    console.log('▶ [8/11] Testing Buyer Authorization on Cancellation...');
    // Alice (seller) tries to cancel Bob's request
    const res8a = await request(app)
      .patch(`/api/purchase-requests/${existingReq._id}/cancel`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie]);

    assert.strictEqual(res8a.status, 403, 'Should return 403 Forbidden for non-buyer');

    // Charlie tries to cancel
    const res8b = await request(app)
      .patch(`/api/purchase-requests/${existingReq._id}/cancel`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [thirdUserCharlie.cookie]);

    assert.strictEqual(res8b.status, 403, 'Should return 403 Forbidden for third party');

    console.log('   ✓ Non-buyer cancellation attempts blocked with 403 Forbidden.\n');

    // -------------------------------------------------------------------------
    // TEST 9: Invalid status transitions are rejected
    // -------------------------------------------------------------------------
    console.log('▶ [9/11] Testing Rejection of Invalid Status Transitions...');
    // Bob cancels his pending request
    const resCancel = await request(app)
      .patch(`/api/purchase-requests/${existingReq._id}/cancel`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie]);

    assert.strictEqual(resCancel.status, 200);
    assert.strictEqual(resCancel.body.data.request.status, 'cancelled');

    // Bob tries to cancel again
    const resRepeatCancel = await request(app)
      .patch(`/api/purchase-requests/${existingReq._id}/cancel`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie]);

    assert.strictEqual(resRepeatCancel.status, 400, 'Should reject cancelling already cancelled request');
    assert.match(resRepeatCancel.body.message, /already cancelled/i);

    // Alice tries to accept a cancelled request
    const resRespondCancelled = await request(app)
      .patch(`/api/purchase-requests/${existingReq._id}/respond`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie])
      .send({ action: 'accept' });

    assert.strictEqual(resRespondCancelled.status, 400, 'Should reject responding to cancelled request');
    console.log('   ✓ State transitions from finalized (cancelled/rejected) requests rejected.\n');

    // -------------------------------------------------------------------------
    // TEST 10: Concurrent acceptance attempts cannot sell or reserve the same book twice
    // -------------------------------------------------------------------------
    console.log('▶ [10/11] Testing Concurrent Acceptance & Overselling Prevention...');
    // Create new book for Alice
    const compBook = await createTestBook(sellerAlice.user._id, { title: 'Distributed Systems' });

    // Bob and Charlie both submit purchase requests for the same book
    const reqBob = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({ bookId: compBook._id.toString(), message: 'Bob wants it' });

    const reqCharlie = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [thirdUserCharlie.cookie])
      .send({ bookId: compBook._id.toString(), message: 'Charlie wants it' });

    assert.strictEqual(reqBob.status, 201);
    assert.strictEqual(reqCharlie.status, 201);

    // Alice attempts to accept both requests concurrently
    const [acceptBob, acceptCharlie] = await Promise.all([
      request(app)
        .patch(`/api/purchase-requests/${reqBob.body.data.request._id}/respond`)
        .set('Origin', 'http://localhost:5173')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', [sellerAlice.cookie])
        .send({ action: 'accept' }),
      request(app)
        .patch(`/api/purchase-requests/${reqCharlie.body.data.request._id}/respond`)
        .set('Origin', 'http://localhost:5173')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', [sellerAlice.cookie])
        .send({ action: 'accept' }),
    ]);

    // Exactly one must succeed (200) and the competing one must fail with 409 Conflict
    const statuses = [acceptBob.status, acceptCharlie.status];
    assert(statuses.includes(200), 'One acceptance request must succeed with 200');
    assert(statuses.includes(409), 'Competing acceptance request must fail with 409 Conflict');

    // Verify DB state: Book acceptedRequest points only to the winner
    const refreshedBook = await Book.findById(compBook._id);
    const winnerId = statuses[0] === 200 ? reqBob.body.data.request._id : reqCharlie.body.data.request._id;
    assert.strictEqual(refreshedBook.acceptedRequest.toString(), winnerId.toString());

    console.log('   ✓ Atomic concurrency control strictly prevented double reservation/overselling.\n');

    // -------------------------------------------------------------------------
    // TEST 11: Unauthorized users cannot view another user's requests
    // -------------------------------------------------------------------------
    console.log("▶ [11/11] Testing Request Access Authorization (Buyer/Seller Only)...");
    const davidNewUser = await createUserSession('David Stranger', 'david.stranger@gmail.com');

    // David tries to access Bob's request to Alice
    const res11 = await request(app)
      .get(`/api/purchase-requests/${reqBob.body.data.request._id}`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [davidNewUser.cookie]);

    assert.strictEqual(res11.status, 403, 'Should return 403 Forbidden for uninvolved user');
    assert.strictEqual(res11.body.success, false);

    // Bob (buyer) can access
    const resBobView = await request(app)
      .get(`/api/purchase-requests/${reqBob.body.data.request._id}`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie]);
    assert.strictEqual(resBobView.status, 200);

    // Alice (seller) can access
    const resAliceView = await request(app)
      .get(`/api/purchase-requests/${reqBob.body.data.request._id}`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie]);
    assert.strictEqual(resAliceView.status, 200);

    console.log('   ✓ Strict access authorization: Only buyer and seller can view request details.\n');

    // -------------------------------------------------------------------------
    // TEST 12: Seller cancels an accepted reservation (returns book to available)
    // -------------------------------------------------------------------------
    console.log("▶ [12/20] Testing Seller Cancels Accepted Reservation...");
    const book12 = await createTestBook(sellerAlice.user._id, { title: 'Compiler Construction' });
    const req12 = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({ bookId: book12._id.toString(), message: 'Taking compilers' });

    // Accept request
    await request(app)
      .patch(`/api/purchase-requests/${req12.body.data.request._id}/respond`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie])
      .send({ action: 'accept' });

    // Book is now reserved
    let book12Check = await Book.findById(book12._id);
    assert.strictEqual(book12Check.status, 'reserved');
    assert.strictEqual(book12Check.acceptedRequest.toString(), req12.body.data.request._id);

    // Seller cancels reservation
    const res12Cancel = await request(app)
      .patch(`/api/purchase-requests/${req12.body.data.request._id}/cancel`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie])
      .send({ reason: 'Buyer did not show up at library' });

    assert.strictEqual(res12Cancel.status, 200);
    assert.strictEqual(res12Cancel.body.data.request.status, 'cancelled');
    assert.strictEqual(res12Cancel.body.data.request.cancelledBy, 'seller');
    assert.strictEqual(res12Cancel.body.data.request.cancellationReason, 'Buyer did not show up at library');

    // Verify book is released back to available
    book12Check = await Book.findById(book12._id);
    assert.strictEqual(book12Check.status, 'available');
    assert.strictEqual(book12Check.acceptedRequest, null);
    console.log('   ✓ Seller cancellation safely released reservation back to available.\n');

    // -------------------------------------------------------------------------
    // TEST 13: Buyer cancels an accepted reservation
    // -------------------------------------------------------------------------
    console.log("▶ [13/20] Testing Buyer Cancels Accepted Reservation...");
    const book13 = await createTestBook(sellerAlice.user._id, { title: 'Network Security' });
    const req13 = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({ bookId: book13._id.toString(), message: 'Taking network sec' });

    await request(app)
      .patch(`/api/purchase-requests/${req13.body.data.request._id}/respond`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie])
      .send({ action: 'accept' });

    // Buyer cancels their accepted reservation
    const res13Cancel = await request(app)
      .patch(`/api/purchase-requests/${req13.body.data.request._id}/cancel`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({ reason: 'Dropped the course' });

    assert.strictEqual(res13Cancel.status, 200);
    assert.strictEqual(res13Cancel.body.data.request.status, 'cancelled');
    assert.strictEqual(res13Cancel.body.data.request.cancelledBy, 'buyer');
    assert.strictEqual(res13Cancel.body.data.request.cancellationReason, 'Dropped the course');

    const book13Check = await Book.findById(book13._id);
    assert.strictEqual(book13Check.status, 'available');
    assert.strictEqual(book13Check.acceptedRequest, null);
    console.log('   ✓ Buyer cancellation safely released reservation back to available.\n');

    // -------------------------------------------------------------------------
    // TEST 14: Seller confirms sale completion
    // -------------------------------------------------------------------------
    console.log("▶ [14/20] Testing Seller Confirms Sale Completion...");
    const book14 = await createTestBook(sellerAlice.user._id, { title: 'Artificial Intelligence' });

    // Bob & Charlie submit requests
    const req14Bob = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({ bookId: book14._id.toString(), message: 'AI textbook for me' });

    const req14Charlie = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [thirdUserCharlie.cookie])
      .send({ bookId: book14._id.toString(), message: 'AI textbook also for me' });

    // Alice accepts Bob's request
    await request(app)
      .patch(`/api/purchase-requests/${req14Bob.body.data.request._id}/respond`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie])
      .send({ action: 'accept' });

    // Alice confirms sale completed
    const resComplete = await request(app)
      .patch(`/api/purchase-requests/${req14Bob.body.data.request._id}/complete`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie]);

    assert.strictEqual(resComplete.status, 200);
    assert.strictEqual(resComplete.body.data.request.status, 'completed');
    assert.strictEqual(resComplete.body.data.book.status, 'sold');

    // Verify DB state for book
    const book14Check = await Book.findById(book14._id);
    assert.strictEqual(book14Check.status, 'sold');

    // Verify competing request (Charlie) was automatically rejected with notice
    const charlieReqCheck = await PurchaseRequest.findById(req14Charlie.body.data.request._id);
    assert.strictEqual(charlieReqCheck.status, 'rejected');
    assert.strictEqual(charlieReqCheck.cancellationReason, 'The book was sold to another buyer.');
    console.log('   ✓ Sale completed: Book marked sold, request completed, competing request rejected.\n');

    // -------------------------------------------------------------------------
    // TEST 15: Non-seller cannot complete sale
    // -------------------------------------------------------------------------
    console.log("▶ [15/20] Testing Non-Seller Cannot Complete Sale...");
    const resNonSellerComplete = await request(app)
      .patch(`/api/purchase-requests/${req14Bob.body.data.request._id}/complete`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie]);

    assert.strictEqual(resNonSellerComplete.status, 403, 'Non-seller should receive 403');
    console.log('   ✓ Non-seller completion attempt blocked with 403 Forbidden.\n');

    // -------------------------------------------------------------------------
    // TEST 16: Completed sale cannot be cancelled or completed again
    // -------------------------------------------------------------------------
    console.log("▶ [16/20] Testing Completed Sale Re-completion and Cancellation Rejection...");
    const resRecomplete = await request(app)
      .patch(`/api/purchase-requests/${req14Bob.body.data.request._id}/complete`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie]);

    assert.strictEqual(resRecomplete.status, 409, 'Re-completion must return 409 Conflict');

    const resCancelCompleted = await request(app)
      .patch(`/api/purchase-requests/${req14Bob.body.data.request._id}/cancel`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie]);

    assert.strictEqual(resCancelCompleted.status, 400, 'Cannot cancel completed request');
    console.log('   ✓ Completed sale cannot be re-completed or cancelled.\n');

    // -------------------------------------------------------------------------
    // TEST 17: Sold or reserved books cannot be edited or deleted
    // -------------------------------------------------------------------------
    console.log("▶ [17/20] Testing Protection of Reserved and Sold Books (Edit/Delete)...");
    // Attempt to edit sold book
    const resEditSold = await request(app)
      .patch(`/api/books/${book14._id}`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie])
      .send({ price: 100 });

    assert.strictEqual(resEditSold.status, 400, 'Cannot edit sold book');

    // Attempt to delete sold book
    const resDeleteSold = await request(app)
      .delete(`/api/books/${book14._id}`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie]);

    assert.strictEqual(resDeleteSold.status, 400, 'Cannot delete sold book');
    console.log('   ✓ Edit and delete operations correctly blocked for sold books.\n');

    // -------------------------------------------------------------------------
    // TEST 18: Concurrency Race: Cancellation vs. Sale Completion
    // -------------------------------------------------------------------------
    console.log("▶ [18/20] Testing Concurrency Race: Cancellation vs Sale Completion...");
    const raceBook1 = await createTestBook(sellerAlice.user._id, { title: 'Theory of Computation' });
    const raceReq1 = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({ bookId: raceBook1._id.toString() });

    // Accept to create an active reservation
    await request(app)
      .patch(`/api/purchase-requests/${raceReq1.body.data.request._id}/respond`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie])
      .send({ action: 'accept' });

    // Concurrent race: Buyer cancels reservation vs. Seller completes sale
    const [cancelRace, completeRace] = await Promise.all([
      request(app)
        .patch(`/api/purchase-requests/${raceReq1.body.data.request._id}/cancel`)
        .set('Origin', 'http://localhost:5173')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', [buyerBob.cookie]),
      request(app)
        .patch(`/api/purchase-requests/${raceReq1.body.data.request._id}/complete`)
        .set('Origin', 'http://localhost:5173')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', [sellerAlice.cookie]),
    ]);

    const raceStatuses = [cancelRace.status, completeRace.status];
    assert(raceStatuses.includes(200), 'One racing operation must succeed with 200');
    assert(raceStatuses.includes(409), 'The losing racing operation must receive 409 Conflict');

    // Verify DB consistency: final state must match the winning operation
    const finalReqState = await PurchaseRequest.findById(raceReq1.body.data.request._id);
    const finalBookState = await Book.findById(raceBook1._id);

    if (cancelRace.status === 200) {
      assert.strictEqual(finalReqState.status, 'cancelled');
      assert.strictEqual(finalBookState.status, 'available');
      assert.strictEqual(finalBookState.acceptedRequest, null);
    } else {
      assert.strictEqual(finalReqState.status, 'completed');
      assert.strictEqual(finalBookState.status, 'sold');
    }
    console.log('   ✓ Cancellation vs Completion race resolved deterministically without state corruption.\n');

    // -------------------------------------------------------------------------
    // TEST 19: Concurrency Race: Two Concurrent Completion Attempts
    // -------------------------------------------------------------------------
    console.log("▶ [19/20] Testing Concurrency Race: Two Simultaneous Completion Attempts...");
    const raceBook2 = await createTestBook(sellerAlice.user._id, { title: 'Software Engineering' });
    const raceReq2 = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({ bookId: raceBook2._id.toString() });

    await request(app)
      .patch(`/api/purchase-requests/${raceReq2.body.data.request._id}/respond`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie])
      .send({ action: 'accept' });

    const [comp1, comp2] = await Promise.all([
      request(app)
        .patch(`/api/purchase-requests/${raceReq2.body.data.request._id}/complete`)
        .set('Origin', 'http://localhost:5173')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', [sellerAlice.cookie]),
      request(app)
        .patch(`/api/purchase-requests/${raceReq2.body.data.request._id}/complete`)
        .set('Origin', 'http://localhost:5173')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', [sellerAlice.cookie]),
    ]);

    const compStatuses = [comp1.status, comp2.status];
    assert(compStatuses.includes(200), 'First completion must succeed with 200');
    assert(compStatuses.includes(409), 'Second concurrent completion must return 409 Conflict');

    const finalCompReq = await PurchaseRequest.findById(raceReq2.body.data.request._id);
    const finalCompBook = await Book.findById(raceBook2._id);
    assert.strictEqual(finalCompReq.status, 'completed');
    assert.strictEqual(finalCompBook.status, 'sold');
    console.log('   ✓ Concurrent completion race strictly prevents double sale completion.\n');

    // -------------------------------------------------------------------------
    // TEST 20: Stale cancellation cannot release a newer reservation
    // -------------------------------------------------------------------------
    console.log("▶ [20/20] Testing Stale Cancellation Cannot Release Newer Reservation...");
    const book20 = await createTestBook(sellerAlice.user._id, { title: 'Machine Learning' });

    // Bob creates request, Alice accepts, then Bob cancels -> book returns to available
    const reqBob20 = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({ bookId: book20._id.toString() });

    await request(app)
      .patch(`/api/purchase-requests/${reqBob20.body.data.request._id}/respond`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie])
      .send({ action: 'accept' });

    await request(app)
      .patch(`/api/purchase-requests/${reqBob20.body.data.request._id}/cancel`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie]);

    // Now Charlie requests the available book, and Alice accepts Charlie's request
    const reqCharlie20 = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [thirdUserCharlie.cookie])
      .send({ bookId: book20._id.toString() });

    await request(app)
      .patch(`/api/purchase-requests/${reqCharlie20.body.data.request._id}/respond`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie])
      .send({ action: 'accept' });

    // Book is now reserved for Charlie
    const bookCheck20 = await Book.findById(book20._id);
    assert.strictEqual(bookCheck20.acceptedRequest.toString(), reqCharlie20.body.data.request._id);

    // Stale replay: Bob tries to cancel his old already-cancelled request again
    const staleCancel = await request(app)
      .patch(`/api/purchase-requests/${reqBob20.body.data.request._id}/cancel`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie]);

    assert.strictEqual(staleCancel.status, 400, 'Stale cancellation must be rejected');

    // Charlie's reservation is untouched
    const bookCheckAfterStale = await Book.findById(book20._id);
    assert.strictEqual(bookCheckAfterStale.status, 'reserved');
    assert.strictEqual(bookCheckAfterStale.acceptedRequest.toString(), reqCharlie20.body.data.request._id);
    console.log('   ✓ Stale cancellation safely rejected; newer reservation strictly protected.\n');

    // -------------------------------------------------------------------------
    // TEST 21: Two different buyers concurrently request the same available book
    // -------------------------------------------------------------------------
    console.log('▶ [21/29] Testing Two Different Buyers Concurrently Request Available Book...');
    const book21 = await createTestBook(sellerAlice.user._id, { title: 'Concurrent Algorithms' });

    const [res21Bob, res21Charlie] = await Promise.all([
      request(app)
        .post('/api/purchase-requests')
        .set('Origin', 'http://localhost:5173')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', [buyerBob.cookie])
        .send({ bookId: book21._id.toString(), message: 'Bob simultaneous request' }),
      request(app)
        .post('/api/purchase-requests')
        .set('Origin', 'http://localhost:5173')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', [thirdUserCharlie.cookie])
        .send({ bookId: book21._id.toString(), message: 'Charlie simultaneous request' }),
    ]);

    assert.strictEqual(res21Bob.status, 201, 'Bob request must succeed');
    assert.strictEqual(res21Charlie.status, 201, 'Charlie request must succeed');
    assert.strictEqual(res21Bob.body.data.request.status, 'pending');
    assert.strictEqual(res21Charlie.body.data.request.status, 'pending');

    const bookCheck21 = await Book.findById(book21._id);
    assert.strictEqual(bookCheck21.status, 'available');
    assert.strictEqual(bookCheck21.acceptedRequest, null);
    console.log('   ✓ Concurrent requests from different buyers both succeed with pending status.\n');

    // -------------------------------------------------------------------------
    // TEST 22: Duplicate concurrent submissions by the same buyer (double-click)
    // -------------------------------------------------------------------------
    console.log('▶ [22/29] Testing Duplicate Concurrent Submissions by Same Buyer (Double-Click)...');
    const book22 = await createTestBook(sellerAlice.user._id, { title: 'Database Internals' });

    const [res22a, res22b] = await Promise.all([
      request(app)
        .post('/api/purchase-requests')
        .set('Origin', 'http://localhost:5173')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', [buyerBob.cookie])
        .send({ bookId: book22._id.toString(), message: 'Double click 1' }),
      request(app)
        .post('/api/purchase-requests')
        .set('Origin', 'http://localhost:5173')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', [buyerBob.cookie])
        .send({ bookId: book22._id.toString(), message: 'Double click 2' }),
    ]);

    const res22Statuses = [res22a.status, res22b.status];
    assert(res22Statuses.includes(201), 'One request must succeed with 201');
    assert(res22Statuses.includes(409), 'Duplicate concurrent request must return 409 Conflict');

    const userRequests22 = await PurchaseRequest.find({ book: book22._id, buyer: buyerBob.user._id });
    assert.strictEqual(userRequests22.length, 1, 'Only exactly 1 active request must be stored');
    console.log('   ✓ Duplicate concurrent submissions by same buyer safely deduplicated with 409.\n');

    // -------------------------------------------------------------------------
    // TEST 23: Concurrency Race: Buyer Cancels Pending Request vs Seller Accepts It
    // -------------------------------------------------------------------------
    console.log('▶ [23/29] Testing Concurrency Race: Buyer Cancels Pending vs Seller Accepts...');
    const book23 = await createTestBook(sellerAlice.user._id, { title: 'Distributed Systems Patterns' });

    const req23 = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({ bookId: book23._id.toString() });

    assert.strictEqual(req23.status, 201);
    const req23Id = req23.body.data.request._id;

    // Buyer cancels pending request while Seller accepts it concurrently
    const [cancel23, accept23] = await Promise.all([
      request(app)
        .patch(`/api/purchase-requests/${req23Id}/cancel`)
        .set('Origin', 'http://localhost:5173')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', [buyerBob.cookie]),
      request(app)
        .patch(`/api/purchase-requests/${req23Id}/respond`)
        .set('Origin', 'http://localhost:5173')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', [sellerAlice.cookie])
        .send({ action: 'accept' }),
    ]);

    const finalReq23 = await PurchaseRequest.findById(req23Id);
    const finalBook23 = await Book.findById(book23._id);

    // Assert that the database is NEVER in a contradictory state:
    // If request is cancelled, book MUST NOT be reserved!
    if (finalReq23.status === 'cancelled') {
      assert.strictEqual(finalBook23.status, 'available', 'Book must remain available if request is cancelled');
      assert.strictEqual(finalBook23.acceptedRequest, null, 'acceptedRequest must be null if request is cancelled');
    } else if (finalReq23.status === 'accepted') {
      assert.strictEqual(finalBook23.status, 'reserved', 'Book must be reserved if request is accepted');
      assert.strictEqual(finalBook23.acceptedRequest.toString(), req23Id.toString());
    } else {
      assert.fail(`Unexpected final request status: ${finalReq23.status}`);
    }
    console.log('   ✓ Cancel vs Accept race strictly prevents bricked/contradictory reservation state.\n');

    // -------------------------------------------------------------------------
    // TEST 24: Concurrency Race: Buyer Cancels Pending Request vs Seller Rejects It
    // -------------------------------------------------------------------------
    console.log('▶ [24/29] Testing Concurrency Race: Buyer Cancels Pending vs Seller Rejects...');
    const book24 = await createTestBook(sellerAlice.user._id, { title: 'Cloud Architecture' });

    const req24 = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({ bookId: book24._id.toString() });

    assert.strictEqual(req24.status, 201);
    const req24Id = req24.body.data.request._id;

    const [cancel24, reject24] = await Promise.all([
      request(app)
        .patch(`/api/purchase-requests/${req24Id}/cancel`)
        .set('Origin', 'http://localhost:5173')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', [buyerBob.cookie]),
      request(app)
        .patch(`/api/purchase-requests/${req24Id}/respond`)
        .set('Origin', 'http://localhost:5173')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', [sellerAlice.cookie])
        .send({ action: 'reject' }),
    ]);

    const statuses24 = [cancel24.status, reject24.status];
    assert(statuses24.includes(200), 'One terminal transition must succeed with 200');
    // The other must return 400 (cannot transition a request that is already finalized)
    assert(statuses24.includes(400), 'Competing transition on already finalized request must return 400');

    const finalReq24 = await PurchaseRequest.findById(req24Id);
    assert(['cancelled', 'rejected'].includes(finalReq24.status));
    console.log('   ✓ Cancel vs Reject race safely resolves to exactly one terminal state without overwrite.\n');

    // -------------------------------------------------------------------------
    // TEST 25: Deleting an Available Book Automatically Cleans Up Active Pending Requests
    // -------------------------------------------------------------------------
    console.log('▶ [25/29] Testing Deleting Available Book Cleans Up Active Pending Requests...');
    const book25 = await createTestBook(sellerAlice.user._id, { title: 'Microservices Design' });

    const req25Bob = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({ bookId: book25._id.toString() });

    const req25Charlie = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [thirdUserCharlie.cookie])
      .send({ bookId: book25._id.toString() });

    assert.strictEqual(req25Bob.status, 201);
    assert.strictEqual(req25Charlie.status, 201);

    // Alice deletes her available book
    const delete25 = await request(app)
      .delete(`/api/books/${book25._id}`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie]);

    assert.strictEqual(delete25.status, 200);

    // Check that pending requests are now rejected with notification reason
    const bobReq25Check = await PurchaseRequest.findById(req25Bob.body.data.request._id);
    const charlieReq25Check = await PurchaseRequest.findById(req25Charlie.body.data.request._id);

    assert.strictEqual(bobReq25Check.status, 'rejected');
    assert.match(bobReq25Check.cancellationReason, /removed by the seller/i);
    assert.strictEqual(charlieReq25Check.status, 'rejected');
    assert.match(charlieReq25Check.cancellationReason, /removed by the seller/i);
    console.log('   ✓ Available book deletion automatically transitions pending requests to rejected.\n');

    // -------------------------------------------------------------------------
    // TEST 26: Manually Marking a Book as Sold Cleans Up Active Pending Requests
    // -------------------------------------------------------------------------
    console.log('▶ [26/29] Testing Manually Marking Book as Sold Cleans Up Pending Requests...');
    const book26 = await createTestBook(sellerAlice.user._id, { title: 'Site Reliability Engineering' });

    const req26 = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({ bookId: book26._id.toString() });

    assert.strictEqual(req26.status, 201);

    // Alice marks book as sold manually
    const status26 = await request(app)
      .patch(`/api/books/${book26._id}/status`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie])
      .send({ status: 'sold' });

    assert.strictEqual(status26.status, 200);

    const req26Check = await PurchaseRequest.findById(req26.body.data.request._id);
    assert.strictEqual(req26Check.status, 'rejected');
    assert.match(req26Check.cancellationReason, /marked this listing as sold/i);
    console.log('   ✓ Manual status update to sold cleanly transitions pending requests.\n');

    // -------------------------------------------------------------------------
    // TEST 27: Concurrency Race: Delete Book vs Concurrently Accepting a Request
    // -------------------------------------------------------------------------
    console.log('▶ [27/29] Testing Concurrency Race: Delete Book vs Concurrently Accepting Request...');
    const book27 = await createTestBook(sellerAlice.user._id, { title: 'Data Intensive Applications' });

    const req27 = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({ bookId: book27._id.toString() });

    assert.strictEqual(req27.status, 201);

    // Alice tries to delete book and accept request simultaneously
    const [delRes27, acceptRes27] = await Promise.all([
      request(app)
        .delete(`/api/books/${book27._id}`)
        .set('Origin', 'http://localhost:5173')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', [sellerAlice.cookie]),
      request(app)
        .patch(`/api/purchase-requests/${req27.body.data.request._id}/respond`)
        .set('Origin', 'http://localhost:5173')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', [sellerAlice.cookie])
        .send({ action: 'accept' }),
    ]);

    // Book must NEVER be both deleted and reserved!
    if (acceptRes27.status === 200) {
      assert.strictEqual(delRes27.status, 400, 'Delete must fail if accept won');
      const book27Check = await Book.findById(book27._id);
      assert.strictEqual(book27Check.status, 'reserved');
    } else {
      assert.strictEqual(delRes27.status, 200, 'Delete succeeded');
      assert.strictEqual(acceptRes27.status, 409, 'Accept must fail with 409 if delete won');
      const book27Check = await Book.findById(book27._id);
      assert.strictEqual(book27Check, null, 'Book was deleted');
    }
    console.log('   ✓ Concurrent delete vs accept resolves deterministically without deleting reserved book.\n');

    // -------------------------------------------------------------------------
    // TEST 28: Missing / Deleted Book Record Handled Safely Without 500 Crashing
    // -------------------------------------------------------------------------
    console.log('▶ [28/29] Testing Missing / Deleted Book Record Handled Safely...');
    const book28 = await createTestBook(sellerAlice.user._id, { title: 'Ghost Book' });

    const req28 = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({ bookId: book28._id.toString() });

    assert.strictEqual(req28.status, 201);
    const req28Id = req28.body.data.request._id;

    // Simulate direct deletion of book record from database
    await Book.findByIdAndDelete(book28._id);

    // Seller attempts to accept request for deleted book
    const acceptDeletedBook = await request(app)
      .patch(`/api/purchase-requests/${req28Id}/respond`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie])
      .send({ action: 'accept' });

    assert.strictEqual(acceptDeletedBook.status, 409, 'Must return 409 Conflict for deleted book');
    assert.match(acceptDeletedBook.body.message, /no longer available/i);

    // Buyer retrieves sent requests
    const sentView28 = await request(app)
      .get('/api/purchase-requests/sent')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie]);

    assert.strictEqual(sentView28.status, 200, 'Sent requests listing must not crash when book is deleted');

    // Buyer cancels request for deleted book
    const cancel28 = await request(app)
      .patch(`/api/purchase-requests/${req28Id}/cancel`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie]);

    assert.strictEqual(cancel28.status, 200, 'Buyer can cancel request for deleted book');
    console.log('   ✓ Missing/deleted book records handled safely without crashes or 500s.\n');

    // -------------------------------------------------------------------------
    // TEST 29: Standalone Rollback Compensation Verification
    // -------------------------------------------------------------------------
    console.log('▶ [29/29] Testing Standalone Rollback Compensation (No Stuck Reservations)...');
    const book29 = await createTestBook(sellerAlice.user._id, { title: 'Failure Recovery Mechanics' });

    const req29 = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyerBob.cookie])
      .send({ bookId: book29._id.toString() });

    assert.strictEqual(req29.status, 201);
    const req29Id = req29.body.data.request._id;

    // Pre-cancel the request directly in DB to simulate racing condition right after findById
    await PurchaseRequest.updateOne({ _id: req29Id }, { $set: { status: 'cancelled', cancelledBy: 'buyer' } });

    // Seller tries to accept: Book.findOneAndUpdate reserves it, but PurchaseRequest.findOneAndUpdate
    // matching status: 'pending' fails! Compensation must rollback the book!
    const resCompensate = await request(app)
      .patch(`/api/purchase-requests/${req29Id}/respond`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [sellerAlice.cookie])
      .send({ action: 'accept' });

    assert.strictEqual(resCompensate.status, 400, 'Must return 400 Bad Request when request is already cancelled');

    // Verify book was rolled back and is NOT stuck in 'reserved'
    const book29Check = await Book.findById(book29._id);
    assert.strictEqual(book29Check.status, 'available', 'Book must remain available after failed transition');
    assert.strictEqual(book29Check.acceptedRequest, null, 'acceptedRequest must be null');
    console.log('   ✓ Rollback compensation successfully prevents orphaned reservations.\n');

    console.log('🎉 ALL 29 PURCHASE REQUEST & SALE LIFECYCLE INTEGRATION TEST SUITES PASSED!\n');
  } finally {
    await cleanup();
  }
}

runPurchaseRequestIntegrationTests().catch((err) => {
  console.error('\n❌ Purchase Request Integration Test Failure:', err);
  process.exit(1);
});


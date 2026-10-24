process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Book } from '../src/models/Book.js';
import { PurchaseRequest } from '../src/models/PurchaseRequest.js';
import { Notification, NOTIFICATION_TYPES } from '../src/models/Notification.js';
import { generateAuthToken } from '../src/services/tokenService.js';
import {
  createNotification,
  notifySafely,
  getUserNotifications,
  getUnreadCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  sseManager,
} from '../src/services/notificationService.js';

console.log('🧪 Starting In-App Notification System Integration Test Suite...\n');

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
  sseManager.clearAll();
  await disconnectDB();
  if (mongod) {
    await mongod.stop();
  }
}

async function clearCollections() {
  await User.deleteMany({});
  await Book.deleteMany({});
  await PurchaseRequest.deleteMany({});
  await Notification.deleteMany({});
}

async function runNotificationIntegrationTests() {
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
        title: 'Computer Networks',
        author: 'Andrew S. Tanenbaum',
        description: 'Comprehensive guide to modern computer networking principles.',
        category: 'Computer Science',
        condition: 'Good',
        priceInPaise: 75000,
        seller: sellerId,
        status: 'available',
        ...overrides,
      });
    };

    // -------------------------------------------------------------------------
    // TEST 1: Notification Model Validation & Defaults
    // -------------------------------------------------------------------------
    console.log('▶ [1/18] Testing Notification Model Validation & Defaults...');
    await clearCollections();
    const alice = await createUserSession('Alice Student', 'alice@gmail.com');
    const bob = await createUserSession('Bob Student', 'bob@gmail.com');

    const validNotif = await Notification.create({
      recipient: alice.user._id,
      actor: bob.user._id,
      type: 'purchase_request_created',
      title: 'New Purchase Request',
      message: 'Bob submitted a request.',
    });

    assert.strictEqual(validNotif.isRead, false, 'Default isRead must be false');
    assert.strictEqual(validNotif.readAt, null, 'Default readAt must be null');
    assert.strictEqual(validNotif.type, 'purchase_request_created');
    assert.strictEqual(validNotif.recipient.toString(), alice.user._id.toString());
    assert.strictEqual(validNotif.actor.toString(), bob.user._id.toString());

    // Invalid type enum validation
    await assert.rejects(
      async () => {
        await Notification.create({
          recipient: alice.user._id,
          type: 'invalid_type_name',
          title: 'Invalid',
          message: 'Invalid type should throw',
        });
      },
      /not a valid notification type/,
      'Should reject invalid notification type'
    );

    // Missing required fields
    await assert.rejects(
      async () => {
        await Notification.create({
          type: 'system',
          title: 'Missing recipient',
          message: 'No recipient provided',
        });
      },
      /Recipient reference is required/,
      'Should reject missing recipient'
    );
    console.log('   ✓ Notification model validates types, required fields, and sets safe defaults.\n');

    // -------------------------------------------------------------------------
    // TEST 2: Self-Notification Suppression & Idempotency / Deduplication
    // -------------------------------------------------------------------------
    console.log('▶ [2/18] Testing Self-Notification Suppression & Idempotency...');
    // Self notification should return null and not persist
    const selfNotif = await createNotification({
      recipient: alice.user._id,
      actor: alice.user._id, // same as recipient
      type: 'system',
      title: 'Self Action',
      message: 'Actor is the recipient',
    });
    assert.strictEqual(selfNotif, null, 'Self notification must be suppressed');

    const notifCountAfterSelf = await Notification.countDocuments({ recipient: alice.user._id });
    assert.strictEqual(notifCountAfterSelf, 1, 'No self notification document must be created');

    // Idempotent creation
    const idemKey = 'event_test_idempotency_123';
    const notifA = await createNotification({
      recipient: alice.user._id,
      actor: bob.user._id,
      type: 'purchase_request_created',
      title: 'Idempotency Test',
      message: 'First attempt',
      idempotencyKey: idemKey,
    });

    const notifB = await createNotification({
      recipient: alice.user._id,
      actor: bob.user._id,
      type: 'purchase_request_created',
      title: 'Idempotency Test Duplicate',
      message: 'Second duplicate attempt',
      idempotencyKey: idemKey,
    });

    assert.strictEqual(notifA._id.toString(), notifB._id.toString(), 'Idempotency key must return existing document');
    const idemDocs = await Notification.find({ recipient: alice.user._id, idempotencyKey: idemKey });
    assert.strictEqual(idemDocs.length, 1, 'Only exactly 1 document should exist for idempotencyKey');
    console.log('   ✓ Self-notifications suppressed and duplicate events safely deduplicated.\n');

    // -------------------------------------------------------------------------
    // TEST 3: Unauthenticated Access to Notification API is Blocked
    // -------------------------------------------------------------------------
    console.log('▶ [3/18] Testing Unauthenticated Access Rejection...');
    const unauthGet = await request(app).get('/api/notifications');
    assert.strictEqual(unauthGet.status, 401);
    assert.strictEqual(unauthGet.body.success, false);

    const unauthCount = await request(app).get('/api/notifications/unread-count');
    assert.strictEqual(unauthCount.status, 401);

    const unauthReadAll = await request(app)
      .patch('/api/notifications/read-all')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest');
    assert.strictEqual(unauthReadAll.status, 401);

    const unauthReadOne = await request(app)
      .patch(`/api/notifications/${notifA._id}/read`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest');
    assert.strictEqual(unauthReadOne.status, 401);
    console.log('   ✓ Unauthenticated requests consistently rejected with 401.\n');

    // -------------------------------------------------------------------------
    // TEST 4: Authenticated User Retrieves Own Notifications (Newest First)
    // -------------------------------------------------------------------------
    console.log('▶ [4/18] Testing Authenticated User Retrieves Own Notifications...');
    // Alice currently has notifA and validNotif
    const resAlice = await request(app)
      .get('/api/notifications')
      .set('Cookie', [alice.cookie]);

    assert.strictEqual(resAlice.status, 200);
    assert.strictEqual(resAlice.body.success, true);
    assert.strictEqual(resAlice.body.data.notifications.length, 2);
    assert.strictEqual(resAlice.body.data.unreadCount, 2);
    assert.strictEqual(resAlice.body.data.pagination.total, 2);
    assert.strictEqual(resAlice.body.data.pagination.page, 1);

    // Verify ordering: newest notification first
    const [first, second] = resAlice.body.data.notifications;
    assert(new Date(first.createdAt) >= new Date(second.createdAt), 'Notifications must be sorted newest first');
    console.log('   ✓ Authenticated user retrieves paginated notifications sorted newest first.\n');

    // -------------------------------------------------------------------------
    // TEST 5: Recipient Isolation (User B cannot see User A's notifications)
    // -------------------------------------------------------------------------
    console.log('▶ [5/18] Testing Strict Recipient Isolation...');
    const resBob = await request(app)
      .get('/api/notifications')
      .set('Cookie', [bob.cookie]);

    assert.strictEqual(resBob.status, 200);
    assert.strictEqual(resBob.body.data.notifications.length, 0, "Bob must NOT see Alice's notifications");
    assert.strictEqual(resBob.body.data.unreadCount, 0);
    assert.strictEqual(resBob.body.data.pagination.total, 0);
    console.log("   ✓ User isolation enforced: Bob cannot see Alice's notifications.\n");

    // -------------------------------------------------------------------------
    // TEST 6: Unread Count Endpoint
    // -------------------------------------------------------------------------
    console.log('▶ [6/18] Testing Unread Count Endpoint...');
    const aliceCountRes = await request(app)
      .get('/api/notifications/unread-count')
      .set('Cookie', [alice.cookie]);

    assert.strictEqual(aliceCountRes.status, 200);
    assert.strictEqual(aliceCountRes.body.data.unreadCount, 2);

    const bobCountRes = await request(app)
      .get('/api/notifications/unread-count')
      .set('Cookie', [bob.cookie]);

    assert.strictEqual(bobCountRes.status, 200);
    assert.strictEqual(bobCountRes.body.data.unreadCount, 0);
    console.log('   ✓ Unread count accurately reflects user-specific unread notifications.\n');

    // -------------------------------------------------------------------------
    // TEST 7: Mark Single Notification As Read (With Ownership Protection)
    // -------------------------------------------------------------------------
    console.log('▶ [7/18] Testing Mark Single Notification as Read & Ownership Protection...');
    // Bob tries to mark Alice's notification as read -> 403 Forbidden
    const bobStealRead = await request(app)
      .patch(`/api/notifications/${notifA._id}/read`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [bob.cookie]);

    assert.strictEqual(bobStealRead.status, 403, 'Cross-user mark as read must return 403');
    assert.match(bobStealRead.body.message, /not authorized/i);

    // Alice marks her own notification as read -> 200 OK
    const aliceReadRes = await request(app)
      .patch(`/api/notifications/${notifA._id}/read`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [alice.cookie]);

    assert.strictEqual(aliceReadRes.status, 200);
    assert.strictEqual(aliceReadRes.body.data.notification.isRead, true);
    assert(aliceReadRes.body.data.notification.readAt !== null, 'readAt timestamp must be recorded');

    // Check Alice's unread count decreased from 2 to 1
    const aliceCountAfterRead = await request(app)
      .get('/api/notifications/unread-count')
      .set('Cookie', [alice.cookie]);
    assert.strictEqual(aliceCountAfterRead.body.data.unreadCount, 1);
    console.log('   ✓ Cross-user update blocked with 403; owner mark-as-read succeeds and updates unread count.\n');

    // -------------------------------------------------------------------------
    // TEST 8: Mark All Notifications As Read
    // -------------------------------------------------------------------------
    console.log('▶ [8/18] Testing Mark All Notifications as Read...');
    const readAllRes = await request(app)
      .patch('/api/notifications/read-all')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [alice.cookie]);

    assert.strictEqual(readAllRes.status, 200);
    assert.strictEqual(readAllRes.body.data.modifiedCount, 1, 'Should mark the remaining 1 unread notification');

    const aliceCountAfterReadAll = await request(app)
      .get('/api/notifications/unread-count')
      .set('Cookie', [alice.cookie]);
    assert.strictEqual(aliceCountAfterReadAll.body.data.unreadCount, 0);
    console.log('   ✓ Mark all as read updates all remaining notifications for authenticated user.\n');

    // -------------------------------------------------------------------------
    // TEST 9: Invalid Notification IDs and Pagination Bounds
    // -------------------------------------------------------------------------
    console.log('▶ [9/18] Testing Invalid IDs & Pagination Bounds...');
    // Malformed ID
    const malformedIdRes = await request(app)
      .patch('/api/notifications/not-a-valid-id/read')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [alice.cookie]);
    assert.strictEqual(malformedIdRes.status, 404);

    // Non-existent ObjectId
    const nonExistentId = new mongoose.Types.ObjectId();
    const nonExistentRes = await request(app)
      .patch(`/api/notifications/${nonExistentId}/read`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [alice.cookie]);
    assert.strictEqual(nonExistentRes.status, 404);

    // Invalid page parameter
    const invalidPage = await request(app)
      .get('/api/notifications?page=-1')
      .set('Cookie', [alice.cookie]);
    assert.strictEqual(invalidPage.status, 400);

    // Invalid limit parameter
    const invalidLimit = await request(app)
      .get('/api/notifications?limit=999')
      .set('Cookie', [alice.cookie]);
    assert.strictEqual(invalidLimit.status, 400);
    console.log('   ✓ Invalid IDs return 404 and out-of-bounds pagination parameters return 400.\n');

    // -------------------------------------------------------------------------
    // TEST 10: Event: Buyer Submits Purchase Request -> Seller Notified
    // -------------------------------------------------------------------------
    console.log('▶ [10/18] Testing Event: Buyer Submits Purchase Request...');
    await clearCollections();
    const seller = await createUserSession('Prof Seller', 'prof.seller@gmail.com');
    const buyer1 = await createUserSession('Student Buyer1', 'buyer1@gmail.com');
    const book = await createTestBook(seller.user._id, { title: 'Algorithms Unlocked' });

    const submitRes = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyer1.cookie])
      .send({ bookId: book._id.toString(), message: 'Can I purchase this textbook?' });

    assert.strictEqual(submitRes.status, 201);
    const req1Id = submitRes.body.data.request._id;

    // Seller must have received a notification
    const sellerNotifs = await Notification.find({ recipient: seller.user._id });
    assert.strictEqual(sellerNotifs.length, 1);
    assert.strictEqual(sellerNotifs[0].type, 'purchase_request_created');
    assert.strictEqual(sellerNotifs[0].actor.toString(), buyer1.user._id.toString());
    assert.strictEqual(sellerNotifs[0].relatedBook.toString(), book._id.toString());
    assert.strictEqual(sellerNotifs[0].relatedPurchaseRequest.toString(), req1Id.toString());
    assert.match(sellerNotifs[0].message, /submitted a purchase request for "Algorithms Unlocked"/i);

    // Buyer must NOT have received a self-notification
    const buyerNotifs = await Notification.find({ recipient: buyer1.user._id });
    assert.strictEqual(buyerNotifs.length, 0);
    console.log('   ✓ Seller receives purchase_request_created notification upon buyer submission.\n');

    // -------------------------------------------------------------------------
    // TEST 11: Event: Seller Accepts Request -> Buyer Notified
    // -------------------------------------------------------------------------
    console.log('▶ [11/18] Testing Event: Seller Accepts Purchase Request...');
    const acceptRes = await request(app)
      .patch(`/api/purchase-requests/${req1Id}/respond`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [seller.cookie])
      .send({ action: 'accept' });

    assert.strictEqual(acceptRes.status, 200);

    // Buyer must have received acceptance notification
    const buyerNotifsAfterAccept = await Notification.find({ recipient: buyer1.user._id });
    assert.strictEqual(buyerNotifsAfterAccept.length, 1);
    assert.strictEqual(buyerNotifsAfterAccept[0].type, 'purchase_request_accepted');
    assert.strictEqual(buyerNotifsAfterAccept[0].actor.toString(), seller.user._id.toString());
    assert.match(buyerNotifsAfterAccept[0].message, /reserved for you/i);
    console.log('   ✓ Buyer receives purchase_request_accepted notification upon seller acceptance.\n');

    // -------------------------------------------------------------------------
    // TEST 12: Event: Buyer or Seller Cancels Accepted Reservation -> Other Party Notified
    // -------------------------------------------------------------------------
    console.log('▶ [12/18] Testing Event: Buyer Cancels Accepted Reservation...');
    const cancelRes = await request(app)
      .patch(`/api/purchase-requests/${req1Id}/cancel`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyer1.cookie])
      .send({ reason: 'Found another copy in the library' });

    assert.strictEqual(cancelRes.status, 200);

    // Seller must have received reservation_cancelled notification
    const sellerNotifsAfterCancel = await Notification.find({
      recipient: seller.user._id,
      type: 'reservation_cancelled',
    });
    assert.strictEqual(sellerNotifsAfterCancel.length, 1);
    assert.match(sellerNotifsAfterCancel[0].message, /cancelled the reservation/i);
    console.log('   ✓ Seller receives reservation_cancelled notification when buyer cancels reservation.\n');

    // -------------------------------------------------------------------------
    // TEST 13: Event: Seller Rejects Purchase Request -> Buyer Notified
    // -------------------------------------------------------------------------
    console.log('▶ [13/18] Testing Event: Seller Rejects Purchase Request...');
    // Create new book and request
    const book2 = await createTestBook(seller.user._id, { title: 'Compilers: Principles & Techniques' });
    const req2 = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyer1.cookie])
      .send({ bookId: book2._id.toString() });

    const req2Id = req2.body.data.request._id;

    const rejectRes = await request(app)
      .patch(`/api/purchase-requests/${req2Id}/respond`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [seller.cookie])
      .send({ action: 'reject', reason: 'Prefer handing over to classmate' });

    assert.strictEqual(rejectRes.status, 200);

    const buyerRejectNotifs = await Notification.find({
      recipient: buyer1.user._id,
      type: 'purchase_request_rejected',
    });
    assert.strictEqual(buyerRejectNotifs.length, 1);
    assert.match(buyerRejectNotifs[0].message, /Prefer handing over to classmate/i);
    console.log('   ✓ Buyer receives purchase_request_rejected notification with optional reason.\n');

    // -------------------------------------------------------------------------
    // TEST 14: Event: Buyer Cancels Pending Request -> Seller Notified
    // -------------------------------------------------------------------------
    console.log('▶ [14/18] Testing Event: Buyer Cancels Pending Request...');
    const book3 = await createTestBook(seller.user._id, { title: 'Artificial Intelligence' });
    const req3 = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyer1.cookie])
      .send({ bookId: book3._id.toString() });

    const req3Id = req3.body.data.request._id;

    // Buyer cancels while pending
    const cancelPendingRes = await request(app)
      .patch(`/api/purchase-requests/${req3Id}/cancel`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyer1.cookie]);

    assert.strictEqual(cancelPendingRes.status, 200);

    const sellerPendingCancelNotifs = await Notification.find({
      recipient: seller.user._id,
      type: 'purchase_request_cancelled',
    });
    assert.strictEqual(sellerPendingCancelNotifs.length, 1);
    assert.match(sellerPendingCancelNotifs[0].message, /cancelled their purchase request/i);
    console.log('   ✓ Seller receives purchase_request_cancelled notification when pending request is cancelled.\n');

    // -------------------------------------------------------------------------
    // TEST 15: Event: Sale Completion -> Winning Buyer & Competing Buyers Notified
    // -------------------------------------------------------------------------
    console.log('▶ [15/18] Testing Event: Sale Completed & Competing Requests Closed...');
    const book4 = await createTestBook(seller.user._id, { title: 'Modern Operating Systems' });
    const buyer2 = await createUserSession('Student Buyer2', 'buyer2@gmail.com');

    // Buyer 1 and Buyer 2 both request book4
    const req4a = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyer1.cookie])
      .send({ bookId: book4._id.toString(), message: 'I want this book' });

    const req4b = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyer2.cookie])
      .send({ bookId: book4._id.toString(), message: 'I also want this book' });

    // Seller accepts Buyer 1
    await request(app)
      .patch(`/api/purchase-requests/${req4a.body.data.request._id}/respond`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [seller.cookie])
      .send({ action: 'accept' });

    // Seller confirms sale completion
    const completeRes = await request(app)
      .patch(`/api/purchase-requests/${req4a.body.data.request._id}/complete`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [seller.cookie]);

    assert.strictEqual(completeRes.status, 200);

    // Winning Buyer 1 receives sale_completed
    const buyer1SaleNotifs = await Notification.find({
      recipient: buyer1.user._id,
      type: 'sale_completed',
    });
    assert.strictEqual(buyer1SaleNotifs.length, 1);
    assert.match(buyer1SaleNotifs[0].message, /sale of "Modern Operating Systems" is complete/i);

    // Competing Buyer 2 receives competing_request_rejected
    const buyer2CompNotifs = await Notification.find({
      recipient: buyer2.user._id,
      type: 'competing_request_rejected',
    });
    assert.strictEqual(buyer2CompNotifs.length, 1);
    assert.match(buyer2CompNotifs[0].message, /was sold to another buyer/i);
    console.log('   ✓ Winning buyer notified of sale completion and competing buyers notified of book sale.\n');

    // -------------------------------------------------------------------------
    // TEST 16: Event: Deleting Available Book Notifies Pending Buyers
    // -------------------------------------------------------------------------
    console.log('▶ [16/18] Testing Event: Listing Deleted Notifies Pending Buyers...');
    const book5 = await createTestBook(seller.user._id, { title: 'Discrete Mathematics' });

    const req5 = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyer2.cookie])
      .send({ bookId: book5._id.toString() });

    // Seller deletes the book
    const delBookRes = await request(app)
      .delete(`/api/books/${book5._id}`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [seller.cookie]);

    assert.strictEqual(delBookRes.status, 200);

    const buyer2DeleteNotifs = await Notification.find({
      recipient: buyer2.user._id,
      type: 'listing_removed',
    });
    assert.strictEqual(buyer2DeleteNotifs.length, 1);
    assert.match(buyer2DeleteNotifs[0].message, /was removed by the seller/i);
    console.log('   ✓ Deleting available book notifies pending buyers with listing_removed event.\n');

    // -------------------------------------------------------------------------
    // TEST 17: Event: Marking Book as Sold Manually Notifies Pending Buyers
    // -------------------------------------------------------------------------
    console.log('▶ [17/18] Testing Event: Manual Sold Toggle Notifies Pending Buyers...');
    const book6 = await createTestBook(seller.user._id, { title: 'Software Engineering' });

    const req6 = await request(app)
      .post('/api/purchase-requests')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [buyer2.cookie])
      .send({ bookId: book6._id.toString() });

    // Seller marks status as sold
    const markSoldRes = await request(app)
      .patch(`/api/books/${book6._id}/status`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [seller.cookie])
      .send({ status: 'sold' });

    assert.strictEqual(markSoldRes.status, 200);

    const buyer2SoldNotifs = await Notification.find({
      recipient: buyer2.user._id,
      type: 'listing_sold',
    });
    assert.strictEqual(buyer2SoldNotifs.length, 1);
    assert.match(buyer2SoldNotifs[0].message, /marked "Software Engineering" as sold/i);
    console.log('   ✓ Manually marking book sold notifies pending buyers with listing_sold event.\n');

    // -------------------------------------------------------------------------
    // TEST 18: Server-Sent Events (SSE) Live Stream Delivery & Recipient Isolation
    // -------------------------------------------------------------------------
    console.log('▶ [18/18] Testing Server-Sent Events (SSE) Stream Delivery & Recipient Isolation...');
    // Create dummy mock responses to test sseManager
    const eventsReceivedAlice = [];
    const eventsReceivedBob = [];

    const mockResAlice = {
      writeHead: () => {},
      write: (str) => eventsReceivedAlice.push(str),
    };
    const mockReqAlice = {
      on: () => {},
    };

    const mockResBob = {
      writeHead: () => {},
      write: (str) => eventsReceivedBob.push(str),
    };
    const mockReqBob = {
      on: () => {},
    };

    sseManager.addClient(alice.user._id, mockReqAlice, mockResAlice);
    sseManager.addClient(bob.user._id, mockReqBob, mockResBob);

    assert(sseManager.hasClient(alice.user._id), 'Alice must have active SSE connection');
    assert(sseManager.hasClient(bob.user._id), 'Bob must have active SSE connection');

    // Dispatch notification to Alice
    await createNotification({
      recipient: alice.user._id,
      actor: bob.user._id,
      type: 'system',
      title: 'Real-time Live Alert',
      message: 'Hello Alice, live notification over SSE!',
    });

    // Verify Alice received event and Bob did NOT
    const aliceLiveEvents = eventsReceivedAlice.join('');
    assert.match(aliceLiveEvents, /event: notification/i, 'Alice must receive notification SSE event');
    assert.match(aliceLiveEvents, /Real-time Live Alert/i);

    const bobLiveEvents = eventsReceivedBob.join('');
    assert(!bobLiveEvents.includes('Real-time Live Alert'), "Bob must NOT receive Alice's notification event");

    // Clean up
    sseManager.clearAll();
    assert(!sseManager.hasClient(alice.user._id), 'All SSE connections cleared cleanly');
    console.log('   ✓ Real-time SSE stream dispatches events strictly to intended recipient with complete isolation.\n');

    console.log('🎉 ALL 18 IN-APP NOTIFICATION INTEGRATION TEST SUITES PASSED!\n');
    process.exit(0);
  } finally {
    await cleanup();
  }
}

runNotificationIntegrationTests().catch((err) => {
  console.error('\n❌ Notification Integration Test Failure:', err);
  process.exit(1);
});

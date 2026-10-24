process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Book } from '../src/models/Book.js';
import { generateAuthToken } from '../src/services/tokenService.js';

console.log('🧪 Starting Book Listings & Marketplace Integration Test Suite...\n');

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
}

async function runBookIntegrationTests() {
  await setup();

  try {
    // -------------------------------------------------------------------------
    // Helper: Create Verified User & Session
    // -------------------------------------------------------------------------
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

    // -------------------------------------------------------------------------
    // TEST 1: Creating a listing with valid data (Price conversion, paise storage, safe seller)
    // -------------------------------------------------------------------------
    console.log('▶ [1/17] Testing Book Creation with Valid Data...');
    await clearCollections();
    const alice = await createUserSession('Alice Scholar', 'alice.scholar@gmail.com');

    const createPayload = {
      title: 'Introduction to Algorithms (CLRS)',
      author: 'Thomas H. Cormen',
      description: 'Comprehensive textbook on modern algorithm design and analysis. Clean condition with no marks.',
      category: 'Computer Science',
      condition: 'Like New',
      price: 1450.50, // ₹1,450.50
      isbn: '9780262033848',
      imageUrl: 'https://images.unsplash.com/photo-1532012164546-f432f2f37b73',
    };

    const res1 = await request(app)
      .post('/api/books')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [alice.cookie])
      .send(createPayload);

    assert.strictEqual(res1.status, 201, 'Should return 201 Created');
    assert.strictEqual(res1.body.success, true);
    assert.strictEqual(res1.body.data.book.title, createPayload.title);
    assert.strictEqual(res1.body.data.book.author, createPayload.author);
    assert.strictEqual(res1.body.data.book.priceInPaise, 145050, 'Price must be stored as 145050 paise');
    assert.strictEqual(res1.body.data.book.price, 1450.5, 'Virtual price should reflect ₹1450.50');
    assert.strictEqual(res1.body.data.book.status, 'available');
    assert.strictEqual(res1.body.data.book.seller.name, 'Alice Scholar');
    assert.strictEqual(res1.body.data.book.seller.email, undefined, 'Seller email must NOT be exposed');
    assert.strictEqual(res1.body.data.book.seller.password, undefined, 'Seller password must NOT be exposed');
    console.log('   ✓ Listing created successfully with integer paise storage and clean currency boundary.\n');

    // -------------------------------------------------------------------------
    // TEST 2: Rejecting unauthenticated listing creation
    // -------------------------------------------------------------------------
    console.log('▶ [2/17] Testing Unauthenticated Listing Creation...');
    const res2 = await request(app)
      .post('/api/books')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send(createPayload);

    assert.strictEqual(res2.status, 401, 'Should return 401 Unauthorized');
    assert.strictEqual(res2.body.success, false);
    assert.match(res2.body.message, /authentication required/i);
    console.log('   ✓ Unauthenticated requests rejected with 401.\n');

    // -------------------------------------------------------------------------
    // TEST 3: Rejecting invalid or missing fields
    // -------------------------------------------------------------------------
    console.log('▶ [3/17] Testing Validation of Missing & Malformed Fields...');
    const invalidPayloads = [
      { ...createPayload, title: '' }, // empty title
      { ...createPayload, author: 'A' }, // author under 2 chars
      { ...createPayload, description: 'Short' }, // description under 10 chars
      { ...createPayload, category: 'InvalidCategory' }, // non-enum category
      { ...createPayload, condition: 'Mint Condition' }, // non-enum condition
      { ...createPayload, isbn: '123' }, // invalid isbn
      { ...createPayload, imageUrl: 'not-a-url' }, // invalid image URL
    ];

    for (const payload of invalidPayloads) {
      const res = await request(app)
        .post('/api/books')
        .set('Origin', 'http://localhost:5173')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', [alice.cookie])
        .send(payload);

      assert.strictEqual(res.status, 400, `Payload should fail validation: ${JSON.stringify(payload)}`);
      assert.strictEqual(res.body.success, false);
      assert(Array.isArray(res.body.errors), 'Should return validation errors array');
    }
    console.log('   ✓ All invalid or missing fields rejected with 400.\n');

    // -------------------------------------------------------------------------
    // TEST 4: Rejecting zero, negative, non-finite, or invalid prices
    // -------------------------------------------------------------------------
    console.log('▶ [4/17] Testing Price Validation (Zero, Negative, Infinity, Exceeding Max)...');
    const invalidPrices = [
      0, // zero
      -50, // negative
      'free', // non-numeric
      0.5, // under ₹1 minimum
      100000.01, // exceeding ₹1,00,000 maximum
      15.999, // more than 2 decimal places
    ];

    for (const price of invalidPrices) {
      const res = await request(app)
        .post('/api/books')
        .set('Origin', 'http://localhost:5173')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', [alice.cookie])
        .send({ ...createPayload, price });

      assert.strictEqual(res.status, 400, `Price ${price} should be rejected`);
      assert.strictEqual(res.body.success, false);
    }
    console.log('   ✓ Zero, negative, fraction-paise, and out-of-range prices rejected.\n');

    // -------------------------------------------------------------------------
    // TEST 5: Listing available books publicly
    // -------------------------------------------------------------------------
    console.log('▶ [5/17] Testing Public Marketplace Listings Endpoint...');
    const res5 = await request(app).get('/api/books');
    assert.strictEqual(res5.status, 200);
    assert.strictEqual(res5.body.success, true);
    assert.strictEqual(res5.body.data.books.length, 1);
    assert.strictEqual(res5.body.data.pagination.total, 1);
    assert.strictEqual(res5.body.data.pagination.page, 1);
    console.log('   ✓ Public marketplace endpoint returns available books and pagination metadata.\n');

    // -------------------------------------------------------------------------
    // Seed Additional Books for Search, Filter, and Sort Tests
    // -------------------------------------------------------------------------
    const bob = await createUserSession('Bob Engineer', 'bob.engineer@gmail.com');
    await Book.create([
      {
        title: 'Artificial Intelligence: A Modern Approach',
        author: 'Stuart Russell',
        description: 'Standard textbook for university artificial intelligence courses. Excellent overview.',
        category: 'Computer Science',
        condition: 'Good',
        priceInPaise: 250000, // ₹2,500
        seller: bob.user._id,
        status: 'available',
      },
      {
        title: 'Calculus: Early Transcendentals',
        author: 'James Stewart',
        description: 'Comprehensive single and multivariable calculus course material with practice problem sets.',
        category: 'Mathematics',
        condition: 'Acceptable',
        priceInPaise: 85000, // ₹850
        seller: bob.user._id,
        status: 'available',
      },
      {
        title: 'University Physics with Modern Physics',
        author: 'Hugh D. Young',
        description: 'Foundations of mechanics, thermodynamics, and quantum physics for engineering majors.',
        category: 'Physics',
        condition: 'New',
        priceInPaise: 320000, // ₹3,200
        seller: alice.user._id,
        status: 'available',
      },
      {
        title: 'Clean Code: Handbook of Agile Software Craftsmanship',
        author: 'Robert C. Martin',
        description: 'Classic guide on writing readable, testable, and maintainable object-oriented software.',
        category: 'Computer Science',
        condition: 'New',
        priceInPaise: 110000, // ₹1,100
        seller: alice.user._id,
        status: 'sold', // MARKED AS SOLD
      },
    ]);

    // -------------------------------------------------------------------------
    // TEST 6: Searching by title and author (with safe regex escaping)
    // -------------------------------------------------------------------------
    console.log('▶ [6/17] Testing Search by Title and Author...');
    // Search by title
    const searchRes1 = await request(app).get('/api/books?search=Artificial');
    assert.strictEqual(searchRes1.body.data.books.length, 1);
    assert.strictEqual(searchRes1.body.data.books[0].title, 'Artificial Intelligence: A Modern Approach');

    // Search by author
    const searchRes2 = await request(app).get('/api/books?search=Stewart');
    assert.strictEqual(searchRes2.body.data.books.length, 1);
    assert.strictEqual(searchRes2.body.data.books[0].author, 'James Stewart');

    // Search with special regex characters (should not crash or trigger ReDoS)
    const searchRes3 = await request(app).get('/api/books?search=[(.*+?^${})]');
    assert.strictEqual(searchRes3.status, 200);
    assert.strictEqual(searchRes3.body.data.books.length, 0);
    console.log('   ✓ Safe regex search across title and author validated.\n');

    // -------------------------------------------------------------------------
    // TEST 7: Filtering by category and condition
    // -------------------------------------------------------------------------
    console.log('▶ [7/17] Testing Filtering by Category and Condition...');
    const catRes = await request(app).get('/api/books?category=Computer+Science');
    assert(catRes.body.data.books.every((b) => b.category === 'Computer Science'));

    const condRes = await request(app).get('/api/books?condition=New');
    assert(condRes.body.data.books.every((b) => b.condition === 'New'));
    assert.strictEqual(condRes.body.data.books.length, 1, 'Only available New books (sold Clean Code excluded)');
    console.log('   ✓ Filtering by category and condition verified.\n');

    // -------------------------------------------------------------------------
    // TEST 8: Sorting by price (ascending & descending)
    // -------------------------------------------------------------------------
    console.log('▶ [8/17] Testing Price Sorting (Low-to-High & High-to-Low)...');
    const sortAscRes = await request(app).get('/api/books?sortBy=price_asc');
    const ascPrices = sortAscRes.body.data.books.map((b) => b.priceInPaise);
    for (let i = 1; i < ascPrices.length; i++) {
      assert(ascPrices[i] >= ascPrices[i - 1], `Ascending order failed: ${ascPrices.join(', ')}`);
    }

    const sortDescRes = await request(app).get('/api/books?sortBy=price_desc');
    const descPrices = sortDescRes.body.data.books.map((b) => b.priceInPaise);
    for (let i = 1; i < descPrices.length; i++) {
      assert(descPrices[i] <= descPrices[i - 1], `Descending order failed: ${descPrices.join(', ')}`);
    }
    console.log('   ✓ Price sorting (asc/desc) working accurately.\n');

    // -------------------------------------------------------------------------
    // TEST 9: Pagination metadata and page-size limits
    // -------------------------------------------------------------------------
    console.log('▶ [9/17] Testing Pagination Metadata & Enforced Page-Size Bounds...');
    const pagRes = await request(app).get('/api/books?page=1&limit=2');
    assert.strictEqual(pagRes.body.data.books.length, 2);
    assert.strictEqual(pagRes.body.data.pagination.page, 1);
    assert.strictEqual(pagRes.body.data.pagination.limit, 2);
    assert.strictEqual(pagRes.body.data.pagination.total, 4); // 4 available books
    assert.strictEqual(pagRes.body.data.pagination.totalPages, 2);
    assert.strictEqual(pagRes.body.data.pagination.hasNext, true);
    assert.strictEqual(pagRes.body.data.pagination.hasPrev, false);

    // Page 2
    const pagRes2 = await request(app).get('/api/books?page=2&limit=2');
    assert.strictEqual(pagRes2.body.data.books.length, 2);
    assert.strictEqual(pagRes2.body.data.pagination.hasPrev, true);
    assert.strictEqual(pagRes2.body.data.pagination.hasNext, false);

    // Limit capped at 50
    const pagResMax = await request(app).get('/api/books?limit=999');
    assert.strictEqual(pagResMax.body.data.pagination.limit, 50, 'Page limit must cap at 50');
    console.log('   ✓ Pagination metadata and size limit boundaries confirmed.\n');

    // -------------------------------------------------------------------------
    // TEST 10: Returning 404 for invalid or missing listing IDs
    // -------------------------------------------------------------------------
    console.log('▶ [10/17] Testing 404 for Invalid or Non-Existent Listing IDs...');
    const invalidIdRes = await request(app).get('/api/books/not-an-object-id-123');
    assert.strictEqual(invalidIdRes.status, 404, 'Malformed ObjectId must return 404');
    assert.strictEqual(invalidIdRes.body.success, false);

    const nonExistentIdRes = await request(app).get('/api/books/65f1234567890abcdef12345');
    assert.strictEqual(nonExistentIdRes.status, 404, 'Non-existent ObjectId must return 404');
    assert.strictEqual(nonExistentIdRes.body.success, false);
    console.log('   ✓ Invalid and non-existent IDs reliably return 404.\n');

    // -------------------------------------------------------------------------
    // TEST 11: Preventing one user from editing another user's listing
    // -------------------------------------------------------------------------
    console.log("▶ [11/17] Testing Authorization: Prevent Editing Another User's Listing...");
    // Alice's book
    const aliceBook = await Book.findOne({ seller: alice.user._id, status: 'available' });

    // Bob attempts to edit Alice's book
    const unauthorizedEdit = await request(app)
      .patch(`/api/books/${aliceBook._id}`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [bob.cookie])
      .send({ title: 'Hacked Title By Bob' });

    assert.strictEqual(unauthorizedEdit.status, 403, 'Should return 403 Forbidden');
    assert.strictEqual(unauthorizedEdit.body.success, false);

    // Verify title was not altered in DB
    const freshAliceBook = await Book.findById(aliceBook._id);
    assert.strictEqual(freshAliceBook.title, aliceBook.title, 'Title must not have changed');
    console.log('   ✓ Cross-user editing blocked with 403 Forbidden.\n');

    // -------------------------------------------------------------------------
    // TEST 12: Preventing one user from deleting another user's listing
    // -------------------------------------------------------------------------
    console.log("▶ [12/17] Testing Authorization: Prevent Deleting Another User's Listing...");
    const unauthorizedDelete = await request(app)
      .delete(`/api/books/${aliceBook._id}`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [bob.cookie]);

    assert.strictEqual(unauthorizedDelete.status, 403, 'Should return 403 Forbidden');
    assert.strictEqual(unauthorizedDelete.body.success, false);

    // Verify still in DB
    const stillExists = await Book.findById(aliceBook._id);
    assert(stillExists !== null, 'Listing must still exist in DB');
    console.log('   ✓ Cross-user deletion blocked with 403 Forbidden.\n');

    // -------------------------------------------------------------------------
    // TEST 13: Preventing one user from changing another user's listing status
    // -------------------------------------------------------------------------
    console.log("▶ [13/17] Testing Authorization: Prevent Changing Another User's Listing Status...");
    const unauthorizedStatus = await request(app)
      .patch(`/api/books/${aliceBook._id}/status`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [bob.cookie])
      .send({ status: 'sold' });

    assert.strictEqual(unauthorizedStatus.status, 403, 'Should return 403 Forbidden');
    assert.strictEqual(unauthorizedStatus.body.success, false);

    // Verify status was not altered
    const statusCheck = await Book.findById(aliceBook._id);
    assert.strictEqual(statusCheck.status, 'available');
    console.log('   ✓ Cross-user status change blocked with 403 Forbidden.\n');

    // -------------------------------------------------------------------------
    // TEST 14: Returning only safe seller information
    // -------------------------------------------------------------------------
    console.log('▶ [14/17] Testing Seller Information Sanitization...');
    const detailRes = await request(app).get(`/api/books/${aliceBook._id}`);
    assert.strictEqual(detailRes.status, 200);
    const sellerInfo = detailRes.body.data.book.seller;
    assert.strictEqual(sellerInfo.name, 'Alice Scholar');
    assert.strictEqual(sellerInfo.email, undefined, 'Email must be omitted');
    assert.strictEqual(sellerInfo.password, undefined, 'Password hash must be omitted');
    assert.strictEqual(sellerInfo.tokenVersion, undefined, 'tokenVersion must be omitted');
    assert.strictEqual(sellerInfo.isVerified, undefined, 'isVerified internal field omitted');
    console.log('   ✓ Only public seller display name is returned in book payloads.\n');

    // -------------------------------------------------------------------------
    // TEST 15: Keeping sold listings out of the default available marketplace
    // -------------------------------------------------------------------------
    console.log('▶ [15/17] Testing Sold Listings Are Excluded from Public Marketplace...');
    const allPublic = await request(app).get('/api/books');
    const allTitles = allPublic.body.data.books.map((b) => b.title);
    assert(!allTitles.includes('Clean Code: Handbook of Agile Software Craftsmanship'), 'Sold book must not be listed');
    assert(allPublic.body.data.books.every((b) => b.status === 'available'), 'All public books must have available status');
    console.log('   ✓ Sold listings strictly omitted from public available queries.\n');

    // -------------------------------------------------------------------------
    // TEST 16: Returning available and sold listings to their respective owners through My Listings
    // -------------------------------------------------------------------------
    console.log('▶ [16/17] Testing /api/books/mine Returns Available and Sold Listings to Owner...');
    const aliceMine = await request(app)
      .get('/api/books/mine')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [alice.cookie]);

    assert.strictEqual(aliceMine.status, 200);
    const aliceTitles = aliceMine.body.data.books.map((b) => b.title);
    assert(aliceTitles.includes('Clean Code: Handbook of Agile Software Craftsmanship'), 'Owner must see their sold book');
    assert(aliceTitles.includes('Introduction to Algorithms (CLRS)'), 'Owner must see their available book');
    assert(aliceTitles.includes('University Physics with Modern Physics'), 'Owner must see all their books');
    assert(!aliceTitles.includes('Calculus: Early Transcendentals'), "Owner must NOT see other users' books");
    console.log("   ✓ /api/books/mine correctly provides all owner's books (both available & sold).\n");

    // -------------------------------------------------------------------------
    // TEST 17: Handling database errors without exposing internal information
    // -------------------------------------------------------------------------
    console.log('▶ [17/17] Testing Graceful Database Error Handling & Information Hiding...');
    // Simulate database failure by stubbing Book.find temporarily
    const originalFind = Book.find;
    Book.find = () => {
      throw new Error('Simulated internal database crash with sensitive connection string');
    };

    const errRes = await request(app).get('/api/books');
    Book.find = originalFind; // restore immediately

    assert.strictEqual(errRes.status, 500);
    assert.strictEqual(errRes.body.success, false);
    assert.strictEqual(errRes.body.message, 'Failed to retrieve book listings.');
    assert(!JSON.stringify(errRes.body).includes('Simulated internal database crash'), 'Internal stack/error details must NOT leak');
    console.log('   ✓ Server errors handled gracefully without leaking internal database details.\n');

    // -------------------------------------------------------------------------
    // TEST: Owner editing, status updating, and deleting their own book
    // -------------------------------------------------------------------------
    console.log("▶ [Bonus] Testing Valid Owner Update, Status Transition, and Deletion Workflow...");
    // 1. Owner updates price and description
    const updateRes = await request(app)
      .patch(`/api/books/${aliceBook._id}`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [alice.cookie])
      .send({ price: 1200, condition: 'Good' });

    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.body.data.book.priceInPaise, 120000);
    assert.strictEqual(updateRes.body.data.book.condition, 'Good');

    // 2. Owner marks as sold
    const statusRes = await request(app)
      .patch(`/api/books/${aliceBook._id}/status`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [alice.cookie])
      .send({ status: 'sold' });

    assert.strictEqual(statusRes.status, 200);
    assert.strictEqual(statusRes.body.data.book.status, 'sold');

    // 3. Owner marks back to available
    const statusRes2 = await request(app)
      .patch(`/api/books/${aliceBook._id}/status`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [alice.cookie])
      .send({ status: 'available' });

    assert.strictEqual(statusRes2.status, 200);
    assert.strictEqual(statusRes2.body.data.book.status, 'available');

    // 3b. Regression test: Owner CANNOT manually set status to 'reserved' (must go through purchase requests)
    const invalidStatusRes = await request(app)
      .patch(`/api/books/${aliceBook._id}/status`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [alice.cookie])
      .send({ status: 'reserved' });

    assert.strictEqual(invalidStatusRes.status, 400);
    assert.strictEqual(invalidStatusRes.body.success, false);

    // 4. Owner deletes listing
    const deleteRes = await request(app)
      .delete(`/api/books/${aliceBook._id}`)
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', [alice.cookie]);

    assert.strictEqual(deleteRes.status, 200);
    assert.strictEqual(deleteRes.body.success, true);

    const deletedCheck = await Book.findById(aliceBook._id);
    assert.strictEqual(deletedCheck, null, 'Deleted book must not exist in DB');
    console.log('   ✓ Owner update, status toggling, and deletion executed and verified.\n');

    console.log('🎉 ALL 17 BOOK MARKETPLACE INTEGRATION TEST SUITES PASSED!\n');
  } finally {
    await cleanup();
  }
}

runBookIntegrationTests().catch((err) => {
  console.error('\n❌ Book Integration Test Failure:', err);
  process.exit(1);
});

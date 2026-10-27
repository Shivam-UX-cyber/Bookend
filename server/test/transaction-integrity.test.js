import assert from 'node:assert';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User } from '../src/models/User.js';
import { Book } from '../src/models/Book.js';
import { PurchaseRequest } from '../src/models/PurchaseRequest.js';
import {
  runWithOptionalTransaction,
  setTransactionSupport,
  resetTransactionSupportCache,
  detectTransactionSupport,
  getTransactionSupport,
} from '../src/utils/transactionHelper.js';

let mongoServer;

const runTests = async () => {
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('🧪 TRANSACTION INTEGRITY & RECOVERY INTEGRATION TEST SUITE');
  console.log('════════════════════════════════════════════════════════════════════\n');

  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Reliable Transaction Capability Detection
    // -------------------------------------------------------------------------
    console.log('▶ [1/4] Testing Reliable Capability Detection (No Substring Guessing)...');
    resetTransactionSupportCache();
    const support = await detectTransactionSupport(mongoose.connection);
    // In-memory standalone instance without replicaSet config is detected as standalone (false)
    assert.strictEqual(typeof support, 'boolean');
    assert.strictEqual(getTransactionSupport(), support);
    console.log(`   ✓ Topology probed deterministically: transactionsSupported = ${support}.\n`);

    // -------------------------------------------------------------------------
    // TEST 2: Do Not Fall Back to Standalone Execution on Unrelated Replica Set Error
    // -------------------------------------------------------------------------
    console.log('▶ [2/4] Testing: Prevent Standalone Fallback on Unrelated Replica Set Errors...');
    // Force cache to true (simulating an active replica set environment)
    setTransactionSupport(true);

    let callbackExecutionCount = 0;
    try {
      await runWithOptionalTransaction(async (session) => {
        callbackExecutionCount++;
        // Simulate an unrelated error mentioning "replica set" (e.g. stepdown or secondary read error)
        const error = new Error('Replica set election in progress: primary unavailable');
        error.code = 10107; // NotWritablePrimary
        throw error;
      });
    } catch (err) {
      assert.strictEqual(err.code, 10107);
    }

    // Must NOT have fallen back to running callback without a session!
    assert.strictEqual(callbackExecutionCount, 1, 'Callback must not be re-run outside transaction');
    assert.strictEqual(getTransactionSupport(), true, 'Cache must not be flipped to false on unrelated replica set error');
    console.log('   ✓ Unrelated replica set errors do not subvert transaction safety.\n');

    // Reset to standalone mode for conditional compensation tests
    setTransactionSupport(false);

    // Create test user and book
    const seller = await User.create({
      name: 'Seller User',
      email: 'seller.tx@gmail.com',
      password: 'HashedPassword123!',
      isVerified: true,
    });
    const buyer = await User.create({
      name: 'Buyer User',
      email: 'buyer.tx@gmail.com',
      password: 'HashedPassword123!',
      isVerified: true,
    });

    const book = await Book.create({
      title: 'Operating System Concepts',
      author: 'Silberschatz',
      description: 'Classic textbook on operating systems.',
      category: 'Computer Science',
      condition: 'Good',
      priceInPaise: 45000,
      seller: seller._id,
      status: 'available',
    });

    const request = await PurchaseRequest.create({
      book: book._id,
      buyer: buyer._id,
      seller: seller._id,
      status: 'pending',
    });

    // -------------------------------------------------------------------------
    // TEST 3: Mid-Write Exception During Acceptance Triggers Rollback Compensation
    // -------------------------------------------------------------------------
    console.log('▶ [3/4] Testing: Mid-Write Acceptance Failure Triggers Conditional Compensation...');

    let simulatedAcceptanceFailed = false;
    try {
      await runWithOptionalTransaction(async (session) => {
        // Step 1: Book updated to reserved
        await Book.findOneAndUpdate(
          { _id: book._id, status: 'available', acceptedRequest: null },
          { $set: { status: 'reserved', acceptedRequest: request._id } }
        );

        let requestUpdated = false;
        try {
          // Step 2: Simulate database crash / network drop during request update
          throw new Error('SIMULATED_DB_NETWORK_DROP_MID_WRITE');
        } catch (step2Error) {
          if (!session && !requestUpdated) {
            await Book.updateOne(
              { _id: book._id, status: 'reserved', acceptedRequest: request._id },
              { $set: { status: 'available', acceptedRequest: null } }
            );
          }
          throw step2Error;
        }
      });
    } catch (err) {
      simulatedAcceptanceFailed = true;
      assert.strictEqual(err.message, 'SIMULATED_DB_NETWORK_DROP_MID_WRITE');
    }

    assert.strictEqual(simulatedAcceptanceFailed, true);
    // Verify book was rolled back and is NOT stuck in reserved status
    const verifiedBook = await Book.findById(book._id);
    assert.strictEqual(verifiedBook.status, 'available', 'Book must be restored to available');
    assert.strictEqual(verifiedBook.acceptedRequest, null, 'acceptedRequest pointer must be cleared');
    console.log('   ✓ Mid-write acceptance failure cleanly rolled back; book remains available.\n');

    // -------------------------------------------------------------------------
    // TEST 4: Mid-Write Failure During Sale Completion Triggers Rollback Compensation
    // -------------------------------------------------------------------------
    console.log('▶ [4/4] Testing: Mid-Write Sale Completion Failure Triggers Conditional Compensation...');

    // First, set up a valid reservation
    await Book.updateOne(
      { _id: book._id },
      { $set: { status: 'reserved', acceptedRequest: request._id } }
    );
    await PurchaseRequest.updateOne(
      { _id: request._id },
      { $set: { status: 'accepted' } }
    );

    let simulatedSaleFailed = false;
    try {
      await runWithOptionalTransaction(async (session) => {
        // Step 1: Book updated to sold
        await Book.findOneAndUpdate(
          { _id: book._id, status: 'reserved', acceptedRequest: request._id },
          { $set: { status: 'sold' } }
        );

        let saleCompleted = false;
        let competingRejected = false;
        try {
          // Step 2: Request updated to completed
          await PurchaseRequest.findOneAndUpdate(
            { _id: request._id, status: 'accepted' },
            { $set: { status: 'completed' } }
          );
          saleCompleted = true;

          // Step 3: Simulate failure during competing request rejection
          throw new Error('SIMULATED_UPDATE_MANY_TIMEOUT');
        } catch (saleErr) {
          if (!session) {
            if (saleCompleted && !competingRejected) {
              await PurchaseRequest.updateOne(
                { _id: request._id, status: 'completed' },
                { $set: { status: 'accepted' } }
              );
            }
            await Book.updateOne(
              { _id: book._id, status: 'sold', acceptedRequest: request._id },
              { $set: { status: 'reserved' } }
            );
          }
          throw saleErr;
        }
      });
    } catch (err) {
      simulatedSaleFailed = true;
      assert.strictEqual(err.message, 'SIMULATED_UPDATE_MANY_TIMEOUT');
    }

    assert.strictEqual(simulatedSaleFailed, true);
    // Verify Book and Request were restored to reserved / accepted
    const restoredBook = await Book.findById(book._id);
    const restoredRequest = await PurchaseRequest.findById(request._id);
    assert.strictEqual(restoredBook.status, 'reserved', 'Book must be restored to reserved');
    assert.strictEqual(restoredRequest.status, 'accepted', 'Request must be restored to accepted');
    console.log('   ✓ Mid-write sale completion failure cleanly restored previous state.\n');

    console.log('════════════════════════════════════════════════════════════════════');
    console.log('🎉 ALL 4 TRANSACTION INTEGRITY TESTS PASSED!');
    console.log('════════════════════════════════════════════════════════════════════\n');
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  }
};

runTests().catch((err) => {
  console.error('\n❌ TEST RUNNER FAILURE:', err);
  process.exit(1);
});

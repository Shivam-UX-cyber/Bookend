import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Book } from '../models/Book.js';
import { PurchaseRequest } from '../models/PurchaseRequest.js';
import { Notification } from '../models/Notification.js';
import { connectDB, disconnectDB } from '../config/db.js';

/**
 * Idempotent, Safe Database Index Migration Runner
 * 
 * Pre-checks existing collections for duplicate or conflicting data BEFORE
 * creating unique constraints. Fails safely with actionable diagnostics.
 */
export const runIndexMigration = async ({ dryRun = false, logger = console } = {}) => {
  logger.log('\n[Index Migration] ═══════════════════════════════════════════════════════');
  logger.log(`[Index Migration] Starting index migration (dryRun: ${dryRun})...`);

  // ---------------------------------------------------------------------------
  // STEP 1: Pre-flight Invariant Audits
  // ---------------------------------------------------------------------------
  logger.log('[Index Migration] Step 1/3: Auditing database for constraint violations...');

  // 1.1 Check for duplicate User emails
  const duplicateEmails = await User.aggregate([
    { $group: { _id: { $toLower: '$email' }, count: { $sum: 1 }, userIds: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (duplicateEmails.length > 0) {
    const errorMsg = `FATAL: Found ${duplicateEmails.length} duplicate email address(es) in User collection. Unique index cannot be enforced without data corruption.\n` +
      JSON.stringify(duplicateEmails, null, 2);
    logger.error(`[Index Migration] ${errorMsg}`);
    throw new Error(errorMsg);
  }
  logger.log('  ✓ User email uniqueness invariant verified (0 violations).');

  // 1.2 Check for duplicate accepted PurchaseRequests for the same book
  const duplicateAcceptedRequests = await PurchaseRequest.aggregate([
    { $match: { status: 'accepted' } },
    { $group: { _id: '$book', count: { $sum: 1 }, requestIds: { $push: '$_id' }, buyerIds: { $push: '$buyer' } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (duplicateAcceptedRequests.length > 0) {
    const errorMsg = `FATAL: Found ${duplicateAcceptedRequests.length} book(s) with multiple accepted purchase requests. Unique index 'unique_accepted_request_per_book' cannot be enforced.\n` +
      JSON.stringify(duplicateAcceptedRequests, null, 2);
    logger.error(`[Index Migration] ${errorMsg}`);
    throw new Error(errorMsg);
  }
  logger.log('  ✓ Single accepted purchase request invariant verified (0 violations).');

  // 1.3 Check for duplicate active (pending or accepted) requests by the same buyer for the same book
  const duplicateActiveRequests = await PurchaseRequest.aggregate([
    { $match: { status: { $in: ['pending', 'accepted'] } } },
    { $group: { _id: { book: '$book', buyer: '$buyer' }, count: { $sum: 1 }, requestIds: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (duplicateActiveRequests.length > 0) {
    const errorMsg = `FATAL: Found ${duplicateActiveRequests.length} duplicate active request(s) by the same buyer for the same book.\n` +
      JSON.stringify(duplicateActiveRequests, null, 2);
    logger.error(`[Index Migration] ${errorMsg}`);
    throw new Error(errorMsg);
  }
  logger.log('  ✓ Buyer active request uniqueness invariant verified (0 violations).');

  // 1.4 Check for duplicate notification idempotency keys for the same recipient
  const duplicateNotifications = await Notification.aggregate([
    { $match: { idempotencyKey: { $type: 'string', $ne: '' } } },
    { $group: { _id: { recipient: '$recipient', idempotencyKey: '$idempotencyKey' }, count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (duplicateNotifications.length > 0) {
    const errorMsg = `FATAL: Found ${duplicateNotifications.length} duplicate notification idempotency key(s).\n` +
      JSON.stringify(duplicateNotifications, null, 2);
    logger.error(`[Index Migration] ${errorMsg}`);
    throw new Error(errorMsg);
  }
  logger.log('  ✓ Notification idempotency uniqueness invariant verified (0 violations).');

  if (dryRun) {
    logger.log('[Index Migration] Dry-run audit complete: All invariants hold. No indexes were created or dropped.');
    return { success: true, dryRun: true };
  }

  // ---------------------------------------------------------------------------
  // STEP 2: Safe Index Removal (Dead/Unused Indexes)
  // ---------------------------------------------------------------------------
  logger.log('[Index Migration] Step 2/3: Checking for obsolete indexes...');

  // Inspect existing Book indexes to remove dead text index if present
  try {
    const bookIndexes = await Book.collection.indexes();
    const hasTextIndex = bookIndexes.some((idx) => idx.name === 'book_text_search' || Object.values(idx.key || {}).includes('text'));
    if (hasTextIndex) {
      logger.log('  • Found obsolete text index on Book collection (unused by regex search). Dropping safely...');
      await Book.collection.dropIndex('book_text_search');
      logger.log('  ✓ Dropped obsolete index: book_text_search');
    }
  } catch (err) {
    // If collection does not exist yet or index already dropped, proceed safely
    if (!err.message.includes('ns not found') && !err.message.includes('index not found')) {
      logger.warn(`  ! Notice while checking Book indexes: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // STEP 3: Create and Synchronize Required Production Indexes
  // ---------------------------------------------------------------------------
  logger.log('[Index Migration] Step 3/3: Creating required indexes across models...');

  await Promise.all([
    User.createIndexes(),
    Book.createIndexes(),
    PurchaseRequest.createIndexes(),
    Notification.createIndexes(),
  ]);

  // ---------------------------------------------------------------------------
  // STEP 4: Verification of Actual Index Definitions in MongoDB
  // ---------------------------------------------------------------------------
  logger.log('[Index Migration] Verifying actual index definitions in MongoDB...');

  const [actualUserIndexes, actualBookIndexes, actualRequestIndexes, actualNotificationIndexes] = await Promise.all([
    User.collection.indexes(),
    Book.collection.indexes(),
    PurchaseRequest.collection.indexes(),
    Notification.collection.indexes(),
  ]);

  // Verify PurchaseRequest invariants
  const hasAcceptedUnique = actualRequestIndexes.some(
    (idx) => idx.name === 'unique_accepted_request_per_book' && idx.unique === true && idx.partialFilterExpression?.status === 'accepted'
  );
  if (!hasAcceptedUnique) {
    throw new Error('VERIFICATION FAILED: PurchaseRequest unique_accepted_request_per_book index was not found or lacks partial filter.');
  }

  const hasBuyerBookUnique = actualRequestIndexes.some(
    (idx) => idx.unique === true && idx.key?.book === 1 && idx.key?.buyer === 1
  );
  if (!hasBuyerBookUnique) {
    throw new Error('VERIFICATION FAILED: PurchaseRequest { book: 1, buyer: 1 } unique index was not found.');
  }

  // Verify Book indexes
  const textIndexStillExists = actualBookIndexes.some(
    (idx) => idx.name === 'book_text_search' || Object.values(idx.key || {}).includes('text')
  );
  if (textIndexStillExists) {
    throw new Error('VERIFICATION FAILED: Book collection still contains obsolete text index.');
  }

  // Verify User email unique index
  const hasUserEmailUnique = actualUserIndexes.some(
    (idx) => idx.unique === true && idx.key?.email === 1
  );
  if (!hasUserEmailUnique) {
    throw new Error('VERIFICATION FAILED: User email unique index was not found.');
  }

  // Verify Notification idempotency partial unique index
  const hasNotificationUnique = actualNotificationIndexes.some(
    (idx) => idx.unique === true && idx.key?.recipient === 1 && idx.key?.idempotencyKey === 1
  );
  if (!hasNotificationUnique) {
    throw new Error('VERIFICATION FAILED: Notification idempotency unique index was not found.');
  }

  const result = {
    success: true,
    verified: {
      users: actualUserIndexes.map((i) => i.name),
      books: actualBookIndexes.map((i) => i.name),
      purchaseRequests: actualRequestIndexes.map((i) => i.name),
      notifications: actualNotificationIndexes.map((i) => i.name),
    },
  };

  logger.log('\n[Index Migration] ═══════════════════════════════════════════════════════');
  logger.log('🎉 INDEX MIGRATION & VERIFICATION COMPLETED SUCCESSFULLY!');
  logger.log(`• Users verified indexes: ${result.verified.users.join(', ')}`);
  logger.log(`• Books verified indexes: ${result.verified.books.join(', ')}`);
  logger.log(`• PurchaseRequests verified indexes: ${result.verified.purchaseRequests.join(', ')}`);
  logger.log(`• Notifications verified indexes: ${result.verified.notifications.join(', ')}`);
  logger.log('[Index Migration] ═══════════════════════════════════════════════════════\n');

  return result;
};

// Direct CLI Execution handler
const isDirectCli = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('migrateIndexes.js');

if (isDirectCli) {
  const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('--audit-only');
  (async () => {
    try {
      await connectDB();
      await runIndexMigration({ dryRun: isDryRun });
      await disconnectDB();
      process.exit(0);
    } catch (err) {
      console.error('\n[FATAL INDEX MIGRATION FAILURE]', err.message);
      try {
        await disconnectDB();
      } catch {}
      process.exit(1);
    }
  })();
}

import mongoose from 'mongoose';

/**
 * Executes a callback within a MongoDB transaction if the deployment supports it
 * (e.g. MongoDB Atlas, Replica Sets). If running on standalone MongoDB where
 * replica set transactions are not supported, executes the callback without a session,
 * allowing guarded atomic conditional updates to manage concurrency safely.
 *
 * @param {Function} callback - async (session) => result
 * @returns {Promise<any>}
 */
export const runWithOptionalTransaction = async (callback) => {
  let session = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    const result = await callback(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    if (session) {
      try {
        await session.abortTransaction();
      } catch (abortErr) {
        // Ignore abort failure if already aborted
      }
    }

    // Check if error is due to standalone MongoDB not supporting transactions
    const isStandaloneError =
      err.message &&
      (err.message.includes('Transaction numbers are only allowed on a replica set member') ||
        err.message.includes('replica set') ||
        err.message.includes('Transactions are not supported'));

    if (isStandaloneError) {
      // Execute directly without transaction session, relying on atomic conditional updates
      return await callback(null);
    }

    throw err;
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};

import mongoose from 'mongoose';

let transactionsSupportedCache = null; // null = unprobed, true = replica set / transactions supported, false = standalone / unsupported

export const resetTransactionSupportCache = () => {
  transactionsSupportedCache = null;
};

export const setTransactionSupport = (supported) => {
  transactionsSupportedCache = Boolean(supported);
};

export const getTransactionSupport = () => transactionsSupportedCache;

/**
 * Authoritatively probes the active MongoDB connection to detect whether
 * transactions are supported (Replica Set or Sharded Cluster).
 *
 * @param {mongoose.Connection} connection - Mongoose connection instance
 * @returns {Promise<boolean|null>}
 */
export const detectTransactionSupport = async (connection = mongoose.connection) => {
  if (transactionsSupportedCache !== null) {
    return transactionsSupportedCache;
  }

  if (!connection || connection.readyState !== 1) {
    return null;
  }

  try {
    const adminDb = connection.db.admin();
    const helloRes = await adminDb.command({ hello: 1 }).catch(() => connection.db.command({ hello: 1 }));
    // A MongoDB deployment supports multi-document transactions if it is a replica set (setName present)
    // or a sharded cluster (msg === 'isdbgrid').
    const isReplicaSet = Boolean(helloRes.setName || helloRes.hosts || helloRes.msg === 'isdbgrid');
    transactionsSupportedCache = isReplicaSet;
    return transactionsSupportedCache;
  } catch (err) {
    // If admin command fails due to restricted permissions on Atlas, inspect topology
    try {
      const topologyType = connection.client?.topology?.description?.type;
      if (topologyType && topologyType !== 'Single' && !topologyType.includes('Unknown')) {
        transactionsSupportedCache = true;
        return true;
      }
    } catch {}
    return null;
  }
};

/**
 * Executes a callback within a MongoDB transaction if the deployment supports it
 * (e.g. MongoDB Atlas, Replica Sets). If running on standalone MongoDB where
 * replica set transactions are not supported, executes the callback without a session,
 * allowing guarded atomic conditional updates to manage concurrency safely.
 *
 * Prevents retrying outside a transaction after unrelated replica set errors.
 *
 * @param {Function} callback - async (session) => result
 * @returns {Promise<any>}
 */
export const runWithOptionalTransaction = async (callback) => {
  // If unprobed, probe connection topology first
  if (transactionsSupportedCache === null && mongoose.connection?.readyState === 1) {
    await detectTransactionSupport(mongoose.connection);
  }

  // If known standalone MongoDB, execute directly without transaction session
  if (transactionsSupportedCache === false) {
    return await callback(null);
  }

  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    let session = null;
    try {
      session = await mongoose.startSession();
      session.startTransaction();

      const result = await callback(session);

      // Commit transaction with retry on UnknownTransactionCommitResult
      let commitAttempt = 0;
      while (commitAttempt < 3) {
        commitAttempt++;
        try {
          await session.commitTransaction();
          break;
        } catch (commitErr) {
          if (
            commitAttempt < 3 &&
            commitErr.hasErrorLabel &&
            commitErr.hasErrorLabel('UnknownTransactionCommitResult')
          ) {
            continue;
          }
          throw commitErr;
        }
      }

      transactionsSupportedCache = true;
      return result;
    } catch (err) {
      if (session) {
        try {
          await session.abortTransaction();
        } catch (abortErr) {
          // Ignore abort failure if already aborted or closed
        }
      }

      // Check strictly for standalone MongoDB error (code 20 with exact message)
      // Only permit standalone fallback on the initial probe when support is not yet confirmed as true.
      // NEVER fall back to standalone execution after an unrelated replica set error!
      const isStandaloneError =
        transactionsSupportedCache !== true &&
        err.code === 20 &&
        typeof err.message === 'string' &&
        err.message.includes('Transaction numbers are only allowed on a replica set member or mongos');

      if (isStandaloneError) {
        transactionsSupportedCache = false;
        // Execute directly without transaction session, relying on atomic conditional updates
        return await callback(null);
      }

      // Retry transient transaction errors on replica sets
      if (
        attempt < maxRetries &&
        err.hasErrorLabel &&
        err.hasErrorLabel('TransientTransactionError')
      ) {
        continue;
      }

      throw err;
    } finally {
      if (session) {
        try {
          await session.endSession();
        } catch (endErr) {
          // Ignore endSession error
        }
      }
    }
  }
};

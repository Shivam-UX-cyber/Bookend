import mongoose from 'mongoose';
import { config } from './env.js';
import { detectTransactionSupport, resetTransactionSupportCache } from '../utils/transactionHelper.js';

export const connectDB = async (customUri = null) => {
  const uri = customUri || config.mongoUri;

  if (!uri) {
    const errorMsg = 'FATAL: Cannot connect to database — MONGO_URI is missing.';
    console.error('\x1b[31m%s\x1b[0m', `[Database] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  try {
    const conn = await mongoose.connect(uri, {
      autoIndex: config.nodeEnv !== 'production', // Build indexes automatically in dev/test; disable in production to prevent startup blocks
    });
    console.log('\x1b[32m%s\x1b[0m', `[Database] MongoDB Connected: ${conn.connection.host}`);
    // Probe database topology to authoritatively configure transaction support
    await detectTransactionSupport(conn.connection);
    return conn;
  } catch (error) {
    console.error('\x1b[31m%s\x1b[0m', `[Database] Connection Error: ${error.message}`);
    throw error; // Re-throw to ensure fail-fast behavior
  }
};

export const disconnectDB = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    resetTransactionSupportCache();
  }
};

mongoose.connection.on('disconnected', () => {
  console.warn('\x1b[33m%s\x1b[0m', '[Database] MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('\x1b[31m%s\x1b[0m', `[Database] MongoDB runtime error: ${err.message}`);
});

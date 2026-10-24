import mongoose from 'mongoose';
import { config } from './env.js';

export const connectDB = async (customUri = null) => {
  const uri = customUri || config.mongoUri;

  if (!uri) {
    const errorMsg = 'FATAL: Cannot connect to database — MONGO_URI is missing.';
    console.error('\x1b[31m%s\x1b[0m', `[Database] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  try {
    const conn = await mongoose.connect(uri, {
      autoIndex: true, // Build indexes on startup
    });
    console.log('\x1b[32m%s\x1b[0m', `[Database] MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error('\x1b[31m%s\x1b[0m', `[Database] Connection Error: ${error.message}`);
    throw error; // Re-throw to ensure fail-fast behavior
  }
};

export const disconnectDB = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
};

mongoose.connection.on('disconnected', () => {
  console.warn('\x1b[33m%s\x1b[0m', '[Database] MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('\x1b[31m%s\x1b[0m', `[Database] MongoDB runtime error: ${err.message}`);
});

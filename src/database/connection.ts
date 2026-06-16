// src/database/connection.ts
import mongoose from 'mongoose';

export async function connectDatabase(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('[Database] MONGODB_URI is missing!');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS:          0,
      connectTimeoutMS:         30000,
      heartbeatFrequencyMS:     10000,
      maxPoolSize:              10,
      minPoolSize:              2,
      retryWrites:              true,
      retryReads:               true,
    });
    console.log('[Database] ✅ Connected successfully to MongoDB');
  } catch (err) {
    console.error('[Database] ❌ Connection error:', err);
    process.exit(1);
  }
}

mongoose.connection.on('disconnected', () => {
  console.warn('[Database] ⚠️ Disconnected from MongoDB — reconnecting in 5s...');
  setTimeout(() => {
    mongoose.connect(process.env.MONGODB_URI!, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS:          0,
      heartbeatFrequencyMS:     10000,
      maxPoolSize:              10,
      minPoolSize:              2,
      retryWrites:              true,
      retryReads:               true,
    }).catch((err: unknown) => console.error('[Database] Reconnect failed:', err));
  }, 5000);
});

mongoose.connection.on('error', (err: unknown) => {
  console.error('[Database] MongoDB error:', err);
});

mongoose.connection.on('reconnected', () => {
  console.log('[Database] ✅ Reconnected to MongoDB');
});

export async function waitForConnection(timeoutMs = 20000): Promise<void> {
  const state = mongoose.connection.readyState;
  if (state === 1) return;
  if (state === 0 || state === 3) {
    mongoose.connect(process.env.MONGODB_URI!, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS:          0,
      heartbeatFrequencyMS:     10000,
      maxPoolSize:              10,
      minPoolSize:              2,
      retryWrites:              true,
      retryReads:               true,
    }).catch(() => {});
  }
  const start = Date.now();
  while (mongoose.connection.readyState !== 1) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('[Database] Timed out waiting for MongoDB reconnection');
    }
    await new Promise(r => setTimeout(r, 200));
  }
}

// Graceful shutdown — closes DB before process exits
export async function closeDatabaseConnection(): Promise<void> {
  await mongoose.connection.close();
  console.log('[Database] 🔒 Connection closed.');
}

// src/database/connection.ts
import mongoose from 'mongoose';

export async function connectDatabase(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('[Database] MONGODB_URI is missing!');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    console.log('[Database] ✅ Connected successfully to MongoDB');
  } catch (err) {
    console.error('[Database] ❌ Connection error:', err);
    process.exit(1);
  }
}

mongoose.connection.on('error', (err: Error) => {
  console.error('[Database] 🔴 Runtime error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('[Database] ⚠️ Disconnected from MongoDB');
});

// Graceful shutdown — closes DB before process exits
export async function closeDatabaseConnection(): Promise<void> {
  await mongoose.connection.close();
  console.log('[Database] 🔒 Connection closed.');
}

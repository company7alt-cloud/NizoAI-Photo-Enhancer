"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDatabase = connectDatabase;
exports.closeDatabaseConnection = closeDatabaseConnection;
// src/database/connection.ts
const mongoose_1 = __importDefault(require("mongoose"));
async function connectDatabase() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('[Database] MONGODB_URI is missing!');
        process.exit(1);
    }
    try {
        await mongoose_1.default.connect(uri, { serverSelectionTimeoutMS: 5000 });
        console.log('[Database] ✅ Connected successfully to MongoDB');
    }
    catch (err) {
        console.error('[Database] ❌ Connection error:', err);
        process.exit(1);
    }
}
mongoose_1.default.connection.on('error', (err) => {
    console.error('[Database] 🔴 Runtime error:', err);
});
mongoose_1.default.connection.on('disconnected', () => {
    console.warn('[Database] ⚠️ Disconnected from MongoDB');
});
// Graceful shutdown — closes DB before process exits
async function closeDatabaseConnection() {
    await mongoose_1.default.connection.close();
    console.log('[Database] 🔒 Connection closed.');
}
//# sourceMappingURL=connection.js.map
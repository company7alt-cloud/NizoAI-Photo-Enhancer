import 'dotenv/config';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { Api } from 'telegram';
import path from 'path';
import { GhostAccount, IGhostAccount } from '../database/models/GhostAccount';
import { checkAndSetGlobalLock } from './ghostResetService';

const API_ID = parseInt(process.env.TELEGRAM_API_ID || '0');
const API_HASH = process.env.TELEGRAM_API_HASH || '';

export class NoGhostAvailableError extends Error {
  constructor() {
    super('NO_GHOST_AVAILABLE');
    this.name = 'NoGhostAvailableError';
  }
}

export class GhostTimeoutError extends Error {
  constructor() {
    super('GHOST_TIMEOUT');
    this.name = 'GhostTimeoutError';
  }
}

export class DeadSessionError extends Error {
  constructor() {
    super('DEAD_SESSION');
    this.name = 'DeadSessionError';
  }
}

const humanDelay = async (minMs: number, maxMs: number): Promise<void> => {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await new Promise(resolve => setTimeout(resolve, delay));
};

const releaseGhostLock = async (
  accountId: string,
  options: {
    incrementUsage?: boolean;
    markInactive?: boolean;
    errorMessage?: string;
  } = {}
): Promise<void> => {
  const setFields: any = {
    isLocked: false,
    lockedAt: null
  };
  
  if (options.markInactive) {
    setFields.isActive = false;
    setFields.lastError = options.errorMessage || 'Session expired';
  }

  const incFields: any = {};
  if (options.incrementUsage) {
    incFields.dailyUsed = 1;
    incFields.totalProcessed = 1;
  }
  if (options.errorMessage && !options.markInactive) {
    incFields.failureCount = 1;
    setFields.lastError = options.errorMessage;
  }

  const updateQuery: any = { $set: setFields };
  if (Object.keys(incFields).length > 0) {
    updateQuery.$inc = incFields;
  }

  await GhostAccount.findByIdAndUpdate(accountId, updateQuery);
};

interface ProcessImageParams {
  imageBuffer: Buffer;
  mimeType: string;
  userId: number;
  requestId: string;
}

export interface ProcessImageResult {
  enhancedBuffer: Buffer;
  fileName: string;
}

export const processImageWithGhost = async (
  params: ProcessImageParams
): Promise<ProcessImageResult> => {
  
  const { imageBuffer, mimeType, userId, requestId } = params;
  const targetBotUsername = process.env.TARGET_ENHANCE_BOT || '';
  
  console.log(`[GHOST ENGINE] [${requestId}] Starting - User: ${userId}`);

  const account = await GhostAccount.getAvailableAccount();
  
  if (!account) {
    console.log(`[GHOST ENGINE] [${requestId}] No ghost account available`);
    await checkAndSetGlobalLock();
    throw new NoGhostAvailableError();
  }

  console.log(`[GHOST ENGINE] [${requestId}] Using account: ${account.phoneNumber}`);

  const client = new TelegramClient(
    new StringSession(account.sessionString),
    API_ID,
    API_HASH,
    {
      connectionRetries: 3,
      timeout: 30000,
      requestRetries: 2,
      autoReconnect: false,
      deviceModel: 'iPhone 14 Pro',
      systemVersion: 'iOS 16.5',
      appVersion: '9.6.3',
      langCode: 'ar',
      systemLangCode: 'ar-SA',
    }
  );

  try {
    await client.connect();
    
    const me = await client.getMe().catch(() => null);
    if (!me) {
      await client.disconnect();
      await releaseGhostLock(account._id.toString(), { markInactive: true, errorMessage: 'Session dead - getMe failed' });
      throw new DeadSessionError();
    }

    await humanDelay(2000, 5000);

    const extension = mimeType === 'image/png' ? 'png' : 
                     mimeType === 'image/webp' ? 'webp' : 'jpg';
    const tempFileName = `photo_${requestId}.${extension}`;

    // SAVE TO DISK TO FORCE CORRECT MIME TYPE
    const fs = await import('fs');
    const os = await import('os');
    const pathMod = await import('path');
    const tempFilePath = pathMod.join(os.tmpdir(), tempFileName);
    fs.writeFileSync(tempFilePath, imageBuffer);

    console.log(`[GHOST ENGINE] [${requestId}] Sending image to ${targetBotUsername}`);

    try {
      await client.sendFile(targetBotUsername, {
        file: tempFilePath,
        forceDocument: true,
        caption: ''
      });
    } finally {
      // CLEANUP TEMP FILE
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }

    console.log(`[GHOST ENGINE] [${requestId}] Image sent, waiting for enhanced result...`);

    const enhancedBuffer = await new Promise<Buffer>((resolve, reject) => {
      const TIMEOUT_MS = 180000;
      let timeoutHandle: NodeJS.Timeout;
      let resolved = false;

      const cleanup = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        try { client.removeEventHandler(handler, new NewMessage({})); } catch {}
      };

      const handler = async (event: NewMessageEvent) => {
        const message = event.message;
        
        // Verify sender is target bot
        try {
          const sender = await message.getSender();
          const senderUsername = (sender as any)?.username?.toLowerCase();
          const targetUsername = targetBotUsername.replace('@', '').toLowerCase();
          
          if (senderUsername !== targetUsername) {
            return;
          }
        } catch {
          return;
        }

        // Ignore text-only messages (queue messages, etc)
        if (!message.media) {
          console.log(`[GHOST ENGINE] [${requestId}] Text ignored: "${message.text?.substring(0, 30)}"`);
          return;
        }

        // Check if it's photo or document (accept both)
        const media = message.media;
        const isPhoto = media.className === 'MessageMediaPhoto';
        const isDocument = media.className === 'MessageMediaDocument';
        
        if (!isPhoto && !isDocument) {
          console.log(`[GHOST ENGINE] [${requestId}] Unknown media type ignored`);
          return;
        }

        // Valid media received!
        console.log(`[GHOST ENGINE] [${requestId}] Enhanced media received! Type: ${media.className}`);
        
        if (resolved) return;
        resolved = true;
        cleanup();

        try {
          await humanDelay(500, 1500);
          
          const downloadedBuffer = await client.downloadMedia(media, {}) as Buffer;
          
          if (!downloadedBuffer || downloadedBuffer.length === 0) {
            reject(new Error('Downloaded buffer is empty'));
            return;
          }
          
          resolve(downloadedBuffer);
        } catch (downloadError) {
          reject(downloadError);
        }
      };

      client.addEventHandler(handler, new NewMessage({}));

      timeoutHandle = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(new GhostTimeoutError());
      }, TIMEOUT_MS);
    });

    await client.disconnect();
    console.log(`[GHOST ENGINE] [${requestId}] Client disconnected`);

    await releaseGhostLock(account._id.toString(), { incrementUsage: true });

    const timestamp = Date.now();
    const outputFileName = `NizoAI_Enhanced_4K_${timestamp}.jpg`;

    (params as any).imageBuffer = null;
    if (global.gc) global.gc();

    console.log(`[GHOST ENGINE] [${requestId}] SUCCESS - Size: ${enhancedBuffer.length} bytes`);

    return {
      enhancedBuffer,
      fileName: outputFileName
    };

  } catch (error: any) {
    console.error(`[GHOST ENGINE] [${requestId}] ERROR:`, error.message);
    
    try { await client.disconnect(); } catch {}

    if (
      error.message?.includes('AUTH_KEY_UNREGISTERED') ||
      error.message?.includes('AUTH_KEY_INVALID') ||
      error.message?.includes('SESSION_REVOKED') ||
      error.message?.includes('USER_DEACTIVATED') ||
      error instanceof DeadSessionError
    ) {
      await releaseGhostLock(account._id.toString(), { 
        markInactive: true, 
        errorMessage: error.message 
      });
      console.log(`[GHOST ENGINE] [${requestId}] Account marked inactive: ${account.phoneNumber}`);
    } else {
      await releaseGhostLock(account._id.toString(), { 
        errorMessage: error.message 
      });
    }

    throw error;
  }
};

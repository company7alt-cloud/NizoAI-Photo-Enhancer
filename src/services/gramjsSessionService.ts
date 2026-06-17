import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram';

const API_ID = parseInt(process.env.TELEGRAM_API_ID || '0');
const API_HASH = process.env.TELEGRAM_API_HASH || '';

// ═══════════════════════════════════════════════════
// Store pending login sessions temporarily in memory
// Key: adminUserId, Value: { client, phoneCodeHash, phone }
// ═══════════════════════════════════════════════════
export interface PendingSession {
  client: TelegramClient;
  phoneCodeHash: string;
  phone: string;
  step: 'code' | 'password';
}

export const pendingSessions = new Map<number, PendingSession>();

// ═══════════════════════════════════════════════════
// STEP A: Send verification code to phone number
// Returns: phoneCodeHash needed for next step
// ═══════════════════════════════════════════════════
export const sendPhoneCode = async (
  adminId: number,
  phoneNumber: string
): Promise<void> => {
  
  // Clean up any previous pending session for this admin
  const existing = pendingSessions.get(adminId);
  if (existing) {
    try { await existing.client.disconnect(); } catch {}
    pendingSessions.delete(adminId);
  }

  const client = new TelegramClient(
    new StringSession(''), // Empty = new session
    API_ID,
    API_HASH,
    {
      connectionRetries: 3,
      timeout: 30000,
      requestRetries: 3,
      autoReconnect: false,
      // STEALTH: Mimic a real Telegram client
      deviceModel: 'Samsung Galaxy S21',
      systemVersion: 'Android 12',
      appVersion: '9.3.3',
      langCode: 'ar',
      systemLangCode: 'ar-SA',
    }
  );

  await client.connect();

  const result = await client.invoke(
    new Api.auth.SendCode({
      phoneNumber: phoneNumber,
      apiId: API_ID,
      apiHash: API_HASH,
      settings: new Api.CodeSettings({
        allowFlashcall: false,
        currentNumber: false,
        allowAppHash: false,
      }),
    })
  );

  pendingSessions.set(adminId, {
    client,
    phoneCodeHash: (result as any).phoneCodeHash,
    phone: phoneNumber,
    step: 'code'
  });
};

// ═══════════════════════════════════════════════════
// STEP B: Submit verification code
// Returns: { success: true, sessionString } or { success: false, needPassword: true }
// ═══════════════════════════════════════════════════
export const submitPhoneCode = async (
  adminId: number,
  code: string
): Promise<{ success: boolean; sessionString?: string; needPassword?: boolean }> => {
  
  const pending = pendingSessions.get(adminId);
  if (!pending) throw new Error('NO_PENDING_SESSION');

  const cleanCode = code.replace(/[^0-9]/g, '');

  try {
    await pending.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: pending.phone,
        phoneCodeHash: pending.phoneCodeHash,
        phoneCode: cleanCode,
      })
    );

    const sessionString = pending.client.session.save() as unknown as string;
    await pending.client.disconnect();
    pendingSessions.delete(adminId);
    
    return { success: true, sessionString };

  } catch (error: any) {
    if (error.message?.includes('SESSION_PASSWORD_NEEDED')) {
      pending.step = 'password';
      return { success: false, needPassword: true };
    }
    
    // Invalid code - clean up
    try { await pending.client.disconnect(); } catch {}
    pendingSessions.delete(adminId);
    throw error;
  }
};

// ═══════════════════════════════════════════════════
// STEP C: Submit 2FA password (if needed)
// ═══════════════════════════════════════════════════
export const submitPassword = async (
  adminId: number,
  password: string
): Promise<string> => {
  
  const pending = pendingSessions.get(adminId);
  if (!pending) throw new Error('NO_PENDING_SESSION');

  try {
    const passwordInfo = await pending.client.invoke(new Api.account.GetPassword());
    
    const { computeCheck } = await import('telegram/Password');
    const passwordCheck = await computeCheck(passwordInfo, password);
    
    await pending.client.invoke(new Api.auth.CheckPassword({ password: passwordCheck }));

    const sessionString = pending.client.session.save() as unknown as string;
    await pending.client.disconnect();
    pendingSessions.delete(adminId);
    
    return sessionString;

  } catch (error) {
    try { await pending.client.disconnect(); } catch {}
    pendingSessions.delete(adminId);
    throw error;
  }
};

// ═══════════════════════════════════════════════════
// Validate an existing session is still alive
// ═══════════════════════════════════════════════════
export const validateSession = async (sessionString: string): Promise<boolean> => {
  const client = new TelegramClient(
    new StringSession(sessionString),
    API_ID,
    API_HASH,
    { connectionRetries: 2, timeout: 15000 }
  );
  
  try {
    await client.connect();
    const me = await client.getMe();
    await client.disconnect();
    return !!me;
  } catch {
    try { await client.disconnect(); } catch {}
    return false;
  }
};

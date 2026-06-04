// src/index.ts
import 'dotenv/config';

// â”€â”€â”€ Environment Guards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if (!process.env.BOT_TOKEN) throw new Error('â‌Œ BOT_TOKEN is missing');
if (!process.env.DOC_BOT_TOKEN) throw new Error('â‌Œ DOC_BOT_TOKEN is missing â€” create a second bot via @BotFather and add it to .env');
if (!process.env.ADMIN_IDS) throw new Error('â‌Œ ADMIN_IDS is missing');
if (!process.env.CHANNEL_ID) throw new Error('â‌Œ CHANNEL_ID is missing');
if (!process.env.MONGODB_URI) throw new Error('â‌Œ MONGODB_URI is missing');

import http from 'http';
import path from 'path';
import OpenAI from 'openai';
import { Bot, session, NextFunction, InlineKeyboard, InputFile } from 'grammy';
import { run } from '@grammyjs/runner';
import cron from 'node-cron';

import { BotContext, isAdmin, SessionData } from './utils/validators';
import { safeReplyWithPhoto } from './utils/assetGuard';
import { connectDatabase, closeDatabaseConnection } from './database/connection';
import { Settings } from './database/models/Settings';
import { User } from './database/models/User';
// ForceSubChannel static import removed â€” clawback system disabled

import { startCommand, inviteCommand } from './bot/commands/start';
import { registerAdminCommands } from './bot/commands/admin';
import { imageHandler } from './bot/handlers/imageHandler';
import { callbackHandler } from './bot/handlers/callbackHandler';
import { forceSubMiddleware } from './bot/middlewares/forceSubMiddleware';
import { initBotTexts } from './services/botTextsService';
import { getSettings } from './services/settingsService';
import { generateAiPDF, getHtmlPageCount } from './services/aiPdfService';
import {
  analyzeAndEnhancePrompt,
  buildPageLimitGuardMessage,
  buildEnterprisePrompt,
} from './services/promptAnalyzerService';

// DocMaker modules
import { checkAndResetDailyFree } from './handlers/docmaker/freeLimit';
import { getPdfCost } from './handlers/docmaker/pricing';
import { sendTextChunksWithEditButton } from './handlers/docmaker/textOutput';
// @ts-ignore â€” handleProEditConfirm kept for backward compat
import { handleEditPdfDocCallback, handleEditPdfDocMessage, showProImageEditMenu, processAutoEditMessage, processProEditTextMessage, processProEditImageUpload, handleProEditConfirm, handleProEditConfirmV2 } from './handlers/docmaker/editWorkflow';
import { showDynamicLoading } from './utils/loading';


// â”€â”€â”€ Bot Instances â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const imageBot = new Bot<BotContext>(process.env.BOT_TOKEN!);
const docBot = new Bot<BotContext>(process.env.DOC_BOT_TOKEN!);

// â”€â”€â”€ Rate Limiting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const imageBotRateMap = new Map<number, number>();
const docBotRateMap = new Map<number, number>();

// â”€â”€â”€ Daily Cron Jobs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
cron.schedule('0 0 * * *', async () => {
  const today = new Date().toISOString().split('T')[0];
  await User.updateMany(
    { freePdfsLastResetDate: { $ne: today } },
    { $set: { freePdfsGeneratedToday: 0, freePdfsLastResetDate: today } }
  );
  console.log('[CRON] Daily free PDF counters reset.');
}, { timezone: 'Asia/Riyadh' });

function rateLimitMiddleware(limitMs: number, map: Map<number, number>) {
  return async (ctx: BotContext, next: NextFunction): Promise<void> => {
    const userId = ctx.from?.id;
    if (!userId) return next();
    if (isAdmin(userId)) return next(); // Admin always exempt
    const now = Date.now();
    if (now - (map.get(userId) ?? 0) < limitMs) {
      await ctx.reply('âڑ ï¸ڈ ط£ط±ط³ظ„ ط¨ط¨ط·ط، ظ‚ظ„ظٹظ„طŒ ظ„ط§ طھط¶ط؛ط· ط¨ط³ط±ط¹ط©!').catch(() => { });
      if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => { });
      return;
    }
    map.set(userId, now);
    return next();
  };
}

// â”€â”€â”€ OpenRouter AI Client â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const aiClient = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY ?? '',
});

async function getUserPageLimit(userId: number | string): Promise<number> {
  const user = await User.findOne({ telegramId: userId }).select('docPageLimit');
  return Number.isFinite(user?.docPageLimit) && Number(user?.docPageLimit) > 0
    ? Number(user?.docPageLimit)
    : 5;
}

// â”€â”€â”€ Shared emoji strip regex (removed as it corrupts markdown tables) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// â”€â”€â”€ AI Hallucination Guard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â”€â”€â”€ docBot Maintenance Flag â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let docBotLocked = false;
let docWelcomeLocked = false;

// â”€â”€â”€ docBot Admin Input State (in-memory, admin is one person) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
type DocAdminInputState =
  | 'awaiting_user_id'
  | 'awaiting_points'
  | 'awaiting_broadcast'
  | 'awaiting_doc_page_unlock';
const DOC_TRANSIENT_STATE_TTL_MS = 15 * 60 * 1000;
const DOC_CALLBACK_LOCK_MS = 200;
const docAdminState = new Map<number, { state: DocAdminInputState; updatedAt: number }>();
const docCallbackLocks = new Map<string, number>();
let lastDocStateCleanup = 0;

function logDocBotError(scope: string, error: unknown): void {
  console.error(scope, error);
}

function setDocAdminState(userId: number, state: DocAdminInputState): void {
  docAdminState.set(userId, { state, updatedAt: Date.now() });
}

function getDocAdminState(userId: number): DocAdminInputState | undefined {
  const entry = docAdminState.get(userId);
  if (!entry) return undefined;
  if (Date.now() - entry.updatedAt > DOC_TRANSIENT_STATE_TTL_MS) {
    docAdminState.delete(userId);
    return undefined;
  }
  return entry.state;
}

function clearDocAdminState(userId: number): void {
  docAdminState.delete(userId);
}

function cleanupDocTransientState(): void {
  const now = Date.now();
  if (now - lastDocStateCleanup < 60_000) return;
  lastDocStateCleanup = now;

  for (const [userId, entry] of docAdminState.entries()) {
    if (now - entry.updatedAt > DOC_TRANSIENT_STATE_TTL_MS) {
      docAdminState.delete(userId);
    }
  }

  for (const [key, timestamp] of docBotRateMap.entries()) {
    if (now - timestamp > DOC_TRANSIENT_STATE_TTL_MS) {
      docBotRateMap.delete(key);
    }
  }

  for (const [key, timestamp] of docCallbackLocks.entries()) {
    if (now - timestamp > DOC_TRANSIENT_STATE_TTL_MS) {
      docCallbackLocks.delete(key);
    }
  }
}

function isRapidDocCallback(ctx: BotContext, label: string): boolean {
  const userId = ctx.from?.id;
  const data = ctx.callbackQuery?.data || label;
  if (!userId) return false;

  const key = `${userId}:${data}`;
  const now = Date.now();
  const last = docCallbackLocks.get(key) ?? 0;
  if (now - last < DOC_CALLBACK_LOCK_MS) {
    return true;
  }

  docCallbackLocks.set(key, now);
  return false;
}

function withDocBotHandler(
  label: string,
  handler: (ctx: BotContext, next: NextFunction) => Promise<void>
) {
  return async (ctx: BotContext, next: NextFunction): Promise<void> => {
    try {
      await handler(ctx, next);
    } catch (error: unknown) {
      logDocBotError(`[DocBot:${label}] Handler failed:`, error);
      await ctx.reply('âڑ ï¸ڈ ط­ط¯ط« ط®ط·ط£ ط؛ظٹط± ظ…طھظˆظ‚ط¹. ظٹط±ط¬ظ‰ ط§ظ„ظ…ط­ط§ظˆظ„ط© ظ…ط±ط© ط£ط®ط±ظ‰.')
        .catch((replyError: unknown) => logDocBotError(`[DocBot:${label}] Failed to notify user:`, replyError));
    }
  };
}

function registerDocCallback(
  trigger: string | RegExp,
  label: string,
  handler: (ctx: BotContext) => Promise<void>
): void {
  docBot.callbackQuery(trigger as any, async (ctx: BotContext): Promise<void> => {
    const originalAnswerCallbackQuery = ctx.answerCallbackQuery.bind(ctx);
    let callbackAnswered = false;
    (ctx as any).answerCallbackQuery = async (...args: Parameters<typeof ctx.answerCallbackQuery>) => {
      if (callbackAnswered) return undefined;
      callbackAnswered = true;
      return originalAnswerCallbackQuery(...args).catch((answerError: unknown) => {
        logDocBotError(`[DocBot:${label}] answerCallbackQuery failed:`, answerError);
        return undefined as never;
      });
    };

    await ctx.answerCallbackQuery().catch((answerError: unknown) => {
      logDocBotError(`[DocBot:${label}] initial answerCallbackQuery failed:`, answerError);
    });

    try {
      if (!ctx.callbackQuery) {
        logDocBotError(`[DocBot:${label}] Missing callbackQuery:`, ctx.update);
        return;
      }
      if (!ctx.from) {
        logDocBotError(`[DocBot:${label}] Missing ctx.from:`, ctx.update);
        return;
      }
      if (isRapidDocCallback(ctx, label)) {
        return;
      }
      await handler(ctx);
    } catch (error: unknown) {
      logDocBotError(`[DocBot:${label}] Callback failed:`, error);
      await ctx.reply('âڑ ï¸ڈ ط­ط¯ط« ط®ط·ط£ ط£ط«ظ†ط§ط، طھظ†ظپظٹط° ط§ظ„ط²ط±. ظٹط±ط¬ظ‰ ط§ظ„ظ…ط­ط§ظˆظ„ط© ظ…ط±ط© ط£ط®ط±ظ‰.')
        .catch((replyError: unknown) => logDocBotError(`[DocBot:${label}] Failed to notify user:`, replyError));
    }
  });
}

// â”€â”€â”€ docBot Admin Panel Keyboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getDocAdminKeyboard() {
  return new InlineKeyboard()
    .text(docWelcomeLocked ? 'ًں”“ ظپطھط­ ط£ط²ط±ط§ط± ط§ظ„طھط±ط­ظٹط¨' : 'ًں”’ ظ‚ظپظ„ ط£ط²ط±ط§ط± ط§ظ„طھط±ط­ظٹط¨', 'doc_admin_toggle_welcome').row()
    .text('ًں‘¤ ط§ظ„طھط­ظƒظ… ط¨ط§ظ„ط¹ظ…ظٹظ„', 'doc_admin_users')
    .text('ًں”’ ظ‚ظپظ„/ظپطھط­ ط§ظ„ط¨ظˆطھ', 'doc_admin_lock').row()
    .text('ًں“ٹ ط§ظ„ط¥ط­طµط§ط¦ظٹط§طھ', 'doc_admin_stats')
    .text('ًں’° ط¥ط¯ط§ط±ط© ط§ظ„ظ†ظ‚ط§ط·', 'doc_admin_points').row()
    .text('ًں”“ ظپطھط­ طµظ„ط§ط­ظٹط© ط§ظ„ظ…ط³طھظ†ط¯ط§طھ', 'doc_admin_unlock_documents').row()
    .text('ًں“¢ ط¥ط´ط¹ط§ط± ط¬ظ…ط§ط¹ظٹ', 'doc_admin_broadcast');
}

// â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
// IMAGE BOT â€” MIDDLEWARE STACK
// â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ

// 1. Rate limiting â€” FIRST, admin exempt
imageBot.use(rateLimitMiddleware(1500, imageBotRateMap));

// 2. Force subscription
imageBot.use(forceSubMiddleware);

// 3. Session â€” isolated key: img_<userId>
imageBot.use(session({
  initial: (): SessionData => ({ documentLines: [] }),
  getSessionKey: (ctx) => ctx.from ? `img_${ctx.from.id}` : undefined,
}));

// 4. User-init / ban / global maintenance
imageBot.use(async (ctx: BotContext, next: NextFunction): Promise<void> => {
  const userId = ctx.from?.id;
  if (!userId) return next();
  try {
    const user = await User.findOne({ telegramId: userId });
    if (user?.isBanned) {
      const msg = 'ًںڑ« ط£ظ†طھ ظ…ط­ط¸ظˆط± ظ…ظ† ط§ط³طھط®ط¯ط§ظ… ط§ظ„ط¨ظˆطھ.';
      if (ctx.callbackQuery) { void ctx.answerCallbackQuery({ text: msg, show_alert: true }).catch(() => { }); return; }
      await ctx.reply(msg); return;
    }
    const botStatus = (await Settings.get('bot_status')) as boolean;
    if (botStatus === false && !isAdmin(userId)) {
      const msg = 'ًں”§ ط§ظ„ط¨ظˆطھ ظپظٹ ظˆط¶ط¹ ط§ظ„طµظٹط§ظ†ط© ط­ط§ظ„ظٹط§ظ‹. ط³ظ†ط¹ظˆط¯ ظ‚ط±ظٹط¨ط§ظ‹!';
      if (ctx.callbackQuery) { void ctx.answerCallbackQuery({ text: msg, show_alert: true }).catch(() => { }); return; }
      await ctx.reply(msg); return;
    }
    if (user) { user.lastSeen = new Date(); await user.save(); }
  } catch (err: unknown) { console.error('[ImageBot Auth] Middleware error:', err); }
  await next();
});

// â”€â”€ imageBot does NOT handle DocMaker â€” that belongs exclusively to docBot â”€â”€

// â”€â”€â”€ Commands â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

imageBot.command('start', startCommand);

// â”€â”€ /reset command â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
imageBot.command('reset', async (ctx) => {
  await ctx.reply(
    'âڑ ï¸ڈ طھط£ظƒظٹط¯ ط¥ط¹ط§ط¯ط© ط§ظ„طھط´ط؛ظٹظ„\n\n' +
    'ط³ظٹطھظ… ط¥ظ„ط؛ط§ط، ط£ظٹ ط¹ظ…ظ„ظٹط© ط¬ط§ط±ظٹط© (ظ…ط³طھظ†ط¯طŒ طµظˆط±ط©طŒ ط¥ط¹ط¯ط§ط¯ط§طھ) ظˆط§ظ„ط¹ظˆط¯ط© ظ„ظ„ظ‚ط§ط¦ظ…ط© ط§ظ„ط±ط¦ظٹط³ظٹط©.\n\n' +
    'âœ… ط±طµظٹط¯ظƒ ظˆظ…ط¹ظ„ظˆظ…ط§طھظƒ ظ…ط­ظپظˆط¸ط© طھظ…ط§ظ…ط§ظ‹ â€” ظ„ظ† ظٹظڈظ…ط³ ط´ظٹط، ظ…ظ†ظ‡ط§.',
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          // @ts-ignore
          [{ text: 'âœ… ظ†ط¹ظ…طŒ ط£ط¹ط¯ ط§ظ„طھط´ط؛ظٹظ„', callback_data: 'action_confirm_reset', style: 'success' as const }],
          [{ text: 'â‌Œ طھط±ط§ط¬ط¹', callback_data: 'action_cancel_reset', style: 'danger' as const }],
        ],
      },
    }
  );
});

// â”€â”€ action_confirm_reset callback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
imageBot.callbackQuery('action_confirm_reset', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.deleteMessage().catch(() => { });

  // SURGICAL WIPE â€” session operational state only
  // PRESERVE: pendingFile and all fields NOT listed here
  ctx.session.isInDocMaker = false;
  ctx.session.docState = null;
  ctx.session.documentLines = [];
  ctx.session.tempLine = null;
  ctx.session.tempFormatting = null;
  ctx.session.tempImage = undefined;
  ctx.session.rowImages = undefined;
  ctx.session.awaitingNextRowImage = false;
  ctx.session.awaitingRowCaption = undefined;
  ctx.session.tempCaptionTarget = undefined;
  ctx.session.editingLineIndex = undefined;
  ctx.session.awaitingLineEditIndex = false;
  ctx.session.awaitingLineEditText = false;
  ctx.session.previewMessageId = undefined;
  ctx.session.pendingExportCost = undefined;
  ctx.session.pendingExportPages = undefined;
  ctx.session.selectedFont = undefined;
  ctx.session.docBgColor = undefined;
  ctx.session.docTextColor = undefined;
  ctx.session.pageSize = undefined;
  ctx.session.templateId = undefined;
  ctx.session.docType = undefined;
  ctx.session.pendingFile = undefined;
  ctx.session.pendingConversionFileId = undefined;
  ctx.session.pendingConversionFormat = undefined;
  ctx.session.pendingBatchFiles = [];
  ctx.session.awaitingCustomWidth = false;
  ctx.session.awaitingCustomHeight = false;
  ctx.session.customSizeWidth = undefined;
  ctx.session.customSizeDims = undefined;

  // Re-run startCommand to show welcome screen with all buttons
  await startCommand(ctx as any);
});

// â”€â”€ action_cancel_reset callback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
imageBot.callbackQuery('action_cancel_reset', async (ctx) => {
  await ctx.answerCallbackQuery({ text: 'âœ… طھظ… ط§ظ„طھط±ط§ط¬ط¹' });
  await ctx.deleteMessage().catch(() => { });
});
registerAdminCommands(imageBot);
imageBot.command('invite', inviteCommand);

// â”€â”€â”€ ًںژ¨ ظپظ„ط§طھط± ط§ظ„طµظˆط± â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

imageBot.hears('ًںژ¨ ظپظ„ط§طھط± ط§ظ„طµظˆط±', async (ctx) => {
  const settings = await getSettings();
  const adminIds = (process.env.ADMIN_IDS || '').split(',');
  const isAdmin = adminIds.includes(ctx.from!.id.toString());

  if (settings.locks.btn_filters && !isAdmin) {
    await ctx.reply('ًں”’ ظ‚ط³ظ… ط§ظ„ظپظ„ط§طھط± ظ…ط؛ظ„ظ‚ ظ…ط¤ظ‚طھط§ظ‹. طھط§ط¨ط¹ظ†ط§ ظ„ظ„طھط­ط¯ظٹط«ط§طھ ');
    return;
  }

  await ctx.reply(
    'ًںژ¨ <b>ظپظ„ط§طھط± ظˆظ…ط¹ط§ظ„ط¬ط© ط§ظ„طµظˆط± ط§ظ„ط§ط­طھط±ط§ظپظٹط©</b>\n\n' +
    'ط§ط®طھط± ط§ظ„ظپظ„طھط± ط§ظ„ط°ظٹ طھط±ظٹط¯ طھط·ط¨ظٹظ‚ظ‡ ط¹ظ„ظ‰ طµظˆط±طھظƒ:\n\n' +
    'ًں‘¤ <b>طھطµظپظٹط© ط§ظ„ظˆط¬ظ‡</b> â€” ظٹط­ط³ظ† ط§ظ„ظ…ظ„ط§ظ…ط­ ظˆظٹط²ظٹظ„ ط§ظ„طھط´ظˆظٹط´\n' +
    'ًںژ¨ <b>طھظ„ظˆظٹظ† ط§ظ„طµظˆط± ط§ظ„ظ‚ط¯ظٹظ…ط©</b> â€” ظٹظ„ظˆظ† ط§ظ„ط£ط¨ظٹط¶ ظˆط§ظ„ط£ط³ظˆط¯\n' +
    'ًںŒ¸ <b>طھط­ظˆظٹظ„ ط¥ظ„ظ‰ ط£ظ†ظ…ظٹ</b> â€” ظٹط­ظˆظ„ طµظˆط±طھظƒ ظ„ط£ظ†ظ…ظٹ ط§ط­طھط±ط§ظپظٹ\n' +
    ' <b>طھط£ط«ظٹط± ط¬ظٹط¨ظ„ظٹ ظپظ†ظٹ</b> â€” ظپظ† ط±ظ‚ظ…ظٹ ط³ط§ط­ط±',
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            // @ts-ignore
            { text: 'ًں‘¤ طھطµظپظٹط© ط§ظ„ظˆط¬ظ‡', callback_data: 'filter_face', style: 'primary' },
            // @ts-ignore
            { text: 'ًںژ¨ طھظ„ظˆظٹظ† ط§ظ„طµظˆط±', callback_data: 'filter_color', style: 'primary' }
          ],
          [
            // @ts-ignore
            { text: 'ًںŒ¸ طھط­ظˆظٹظ„ ط£ظ†ظ…ظٹ', callback_data: 'filter_anime', style: 'primary' },
            // @ts-ignore
            { text: ' طھط£ط«ظٹط± ط¬ظٹط¨ظ„ظٹ', callback_data: 'filter_ghibli', style: 'primary' }
          ],
          [
            // @ts-ignore
            { text: 'â‌Œ ط¥ظ„ط؛ط§ط،', callback_data: 'cancel_filter', style: 'danger' }
          ]
        ]
      }
    }
  );
});

// â”€â”€â”€ /endchat â€” Admin closes the active support session â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

imageBot.command('endchat', async (ctx) => {
  const telegramId = ctx.from?.id.toString();
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
  if (!adminIds.includes(telegramId || '')) return; // admins only

  const activeUser = await User.findOne({
    supportSessionActive: true,
    supportSessionAdminId: telegramId,
  });

  if (activeUser) {
    await User.findOneAndUpdate(
      { telegramId: activeUser.telegramId },
      { $set: { supportSessionActive: false, supportSessionAdminId: null } }
    );
    // Notify user
    await ctx.api.sendMessage(
      activeUser.telegramId,
      `âœ… <b>طھظ… ط¥ط؛ظ„ط§ظ‚ ط¬ظ„ط³ط© ط§ظ„ط¯ط¹ظ…</b>\n\nط´ظƒط±ط§ظ‹ ظ„طھظˆط§طµظ„ظƒ ظ…ط¹ظ†ط§ ًںŒ¹\nظ†طھظ…ظ†ظ‰ ظ„ظƒ ظٹظˆظ…ط§ظ‹ ط·ظٹط¨ط§ظ‹ ًںکٹ`,
      { parse_mode: 'HTML' }
    ).catch(() => { });
  }

  await ctx.reply(
    `ًں›‘ <b>طھظ… ط¥ظ†ظ‡ط§ط، ط§ظ„ظ…ط­ط§ط¯ط«ط© ط§ظ„ظ…ط¨ط§ط´ط±ط© ظ…ط¹ ط§ظ„ط¹ظ…ظٹظ„.</b>`,
    { parse_mode: 'HTML' }
  );
});

// â”€â”€â”€ imageBot: message handlers (admin input, support, etc.) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

imageBot.on('message', async (_ctx: BotContext, next: NextFunction): Promise<void> => {
  await next();
});

imageBot.on('message:text', async (ctx, next) => {
  const telegramId = ctx.from?.id.toString();
  const user = await User.findOne({ telegramId });
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
  const isAdm = adminIds.includes(telegramId || '');
  const messageText = ctx.message?.text || '';

  // 0. VIP Size Bypass Command (Admin Only)
  if (isAdm && messageText.startsWith('/vip')) {
    const parts = messageText.split(' ');
    const targetId = parts[1];

    if (!targetId) {
      await ctx.reply('â‌Œ <b>ط®ط·ط£ ظپظٹ ط§ظ„طµظٹط؛ط©</b>\nط§ظ„ط§ط³طھط®ط¯ط§ظ… ط§ظ„طµط­ظٹط­: <code>/vip 123456789</code>', { parse_mode: 'HTML' });
      return;
    }

    const targetUser = await User.findOne({ telegramId: targetId });
    if (!targetUser) {
      await ctx.reply('â‌Œ ظ„ظ… ظٹطھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ظ…ط³طھط®ط¯ظ… ط¨ظ‡ط°ط§ ط§ظ„ظ€ ID.');
      return;
    }

    await User.findOneAndUpdate({ telegramId: targetId }, { $set: { vipSizeBypass: true } });
    await ctx.reply(`âœ… <b>طھظ… طھظپط¹ظٹظ„ VIP!</b>\nط§ظ„ظ…ط³طھط®ط¯ظ… (<code>${targetId}</code>) ظٹظ…ظƒظ†ظ‡ ط§ظ„ط¢ظ† ط±ظپط¹ طµظˆط± ط¨ط­ط¬ظ… 15 ظ…ظٹط¬ط§ط¨ط§ظٹطھ.`, { parse_mode: 'HTML' });

    try {
      await ctx.api.sendMessage(targetId, 'ًںŒں <b>طھظ… طھط±ظ‚ظٹط© ط­ط³ط§ط¨ظƒ (VIP)</b>\n\nط¨ظ†ط§ط،ظ‹ ط¹ظ„ظ‰ ط·ظ„ط¨ظƒطŒ طھظ… ظپطھط­ ط§ظ„ط­ط¯ ط§ظ„ط£ظ‚طµظ‰ ظ„ظ„ظ…ظ…ط­ط§ط© ط§ظ„ط³ط­ط±ظٹط©. ظٹظ…ظƒظ†ظƒ ط§ظ„ط¢ظ† ط¥ط±ط³ط§ظ„ طµظˆط± ط¨ط­ط¬ظ… ظٹطµظ„ ط¥ظ„ظ‰ <b>15 ظ…ظٹط¬ط§ط¨ط§ظٹطھ</b>! ًںکژ', { parse_mode: 'HTML' });
    } catch (e) { }

    return;
  }

  // 1. Admin Commands (Priority 1)
  if (isAdm && (messageText === '/endchat' || messageText === 'ظ‚ظپظ„ ط§ظ„ظ…ط­ط§ط¯ط«ط©' || messageText === 'ط§ط؛ظ„ظ‚ ط§ظ„ظ…ط­ط§ط¯ط«ط©')) {
    const activeUser = await User.findOne({
      supportSessionActive: true,
      supportSessionAdminId: telegramId
    });

    if (activeUser) {
      await User.findOneAndUpdate(
        { telegramId: activeUser.telegramId },
        { $set: { supportSessionActive: false, supportSessionAdminId: null } }
      );
      await ctx.reply(`âœ… <b>طھظ… ط¥ظ†ظ‡ط§ط، ط§ظ„ظ…ط­ط§ط¯ط«ط© ط§ظ„ظ…ط¨ط§ط´ط±ط© ظ…ط¹ ط§ظ„ط¹ظ…ظٹظ„.</b>`, { parse_mode: 'HTML' });
      try {
        await ctx.api.sendMessage(activeUser.telegramId, 'ًں”” طھظ… ط¥ط؛ظ„ط§ظ‚ ط¬ظ„ط³ط© ط§ظ„ط¯ط¹ظ…. ط´ظƒط±ط§ظ‹ ظ„طھظˆط§طµظ„ظƒ ظ…ط¹ظ†ط§ ًں’™');
      } catch (e) { }
    } else {
      await ctx.reply('â‌Œ ظ„ط§ طھظˆط¬ط¯ ظ…ط­ط§ط¯ط«ط© ظ†ط´ط·ط© ط­ط§ظ„ظٹط§ظ‹ ظ„ط¥ط؛ظ„ط§ظ‚ظ‡ط§.');
    }
    return;
  }

  const adminInputUser = await User.findOne({ telegramId: ctx.from?.id.toString() });
  const adminInput = adminInputUser?.adminAwaitingInput;
  const text = ctx.message?.text?.trim() || '';
  const isAdminMsg = isAdm;

  // â”€â”€ attempts_add_all: waiting for number â”€â”€
  if (adminInput === 'attempts_add_all' && isAdminMsg) {
    const amount = parseInt(text);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('â‌Œ ط£ط±ط³ظ„ ط±ظ‚ظ…ط§ظ‹ طµط­ظٹط­ط§ظ‹ ط£ظƒط¨ط± ظ…ظ† طµظپط±.');
      return;
    }
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: null } }
    );
    const result = await User.updateMany({}, { $inc: { dailyQuota: amount } });

    // Notify users safely
    const allUsers = await User.find({}).select('telegramId').lean();
    let notified = 0;
    for (const u of allUsers) {
      try {
        await ctx.api.sendMessage(
          u.telegramId,
          `ًںژپ <b>ظ‡ط¯ظٹط© ظ…ظ† ط§ظ„ظ…ط·ظˆط±!</b>\n\nطھظ… ط¥ط¶ط§ظپط© <b>${amount}</b> ظ…ط­ط§ظˆظ„ط§طھ ظ…ط¬ط§ظ†ظٹط© ظ„ط±طµظٹط¯ظƒ ًںڑ€\nظ†طھظ…ظ†ظ‰ ظ„ظƒ طھط¬ط±ط¨ط© ظ…ظ…طھط¹ط© ظˆظ…ظ…ظٹط²ط© ًں’ژ`,
          { parse_mode: 'HTML' }
        );
        notified++;
      } catch (e) { }
      if (notified % 25 === 0) await new Promise(r => setTimeout(r, 1000));
    }
    await ctx.reply(`âœ… طھظ…طھ ط¥ط¶ط§ظپط© ${amount} ظ…ط­ط§ظˆظ„ط§طھ ظ„ظ€ ${result.modifiedCount} ظ…ط³طھط®ط¯ظ…\nًں“¢ طھظ… ط¥ط´ط¹ط§ط± ${notified} ظ…ط³طھط®ط¯ظ…`);
    return;
  }

  // â”€â”€ attempts_add_one_id: waiting for user ID â”€â”€
  if (adminInput === 'attempts_add_one_id' && isAdminMsg) {
    const targetUser = await User.findOne({ telegramId: text });
    if (!targetUser) {
      await ctx.reply('â‌Œ ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯. طھط£ظƒط¯ ظ…ظ† ط§ظ„ظ€ ID ظˆط£ط¹ط¯ ط§ظ„ط¥ط±ط³ط§ظ„.');
      return;
    }
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'attempts_add_one_amount', adminTargetUserId: text } }
    );
    await ctx.reply(`âœ… طھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ط§ظ„ظ…ط³طھط®ط¯ظ…: <code>${text}</code>\n\nط£ط±ط³ظ„ ط¹ط¯ط¯ ط§ظ„ظ…ط­ط§ظˆظ„ط§طھ ط§ظ„طھظٹ طھط±ظٹط¯ ط¥ط¶ط§ظپطھظ‡ط§:`, { parse_mode: 'HTML' });
    return;
  }

  // â”€â”€ attempts_add_one_amount: waiting for amount â”€â”€
  if (adminInput === 'attempts_add_one_amount' && isAdminMsg) {
    const amount = parseInt(text);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('â‌Œ ط£ط±ط³ظ„ ط±ظ‚ظ…ط§ظ‹ طµط­ظٹط­ط§ظ‹ ط£ظƒط¨ط± ظ…ظ† طµظپط±.');
      return;
    }
    const targetId = adminInputUser?.adminTargetUserId;
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: null, adminTargetUserId: null } }
    );
    await User.findOneAndUpdate({ telegramId: targetId }, { $inc: { dailyQuota: amount } });
    try {
      await ctx.api.sendMessage(
        targetId!,
        `ًںژپ <b>ظ…ظپط§ط¬ط£ط© ظ…ظ† ط§ظ„ظ…ط·ظˆط±!</b>\n\nطھظ… ط¥ط¶ط§ظپط© <b>${amount}</b> ظ…ط­ط§ظˆظ„ط§طھ ظ…ط¬ط§ظ†ظٹط© ظ„ط±طµظٹط¯ظƒ ط§ظ„ط´ط®طµظٹ ًںŒں\nظ‡ط°ظ‡ ظ…ظƒط§ظپط£ط© ط®ط§طµط© ظ„ظƒ طھظ‚ط¯ظٹط±ط§ظ‹ ظ„ط­ط³ظ† طھط¹ط§ظ…ظ„ظƒ ظ…ط¹ ط§ظ„ط¨ظˆطھ ًں’™`,
        { parse_mode: 'HTML' }
      );
    } catch (e) { }
    await ctx.reply(`âœ… طھظ…طھ ط¥ط¶ط§ظپط© ${amount} ظ…ط­ط§ظˆظ„ط§طھ ظ„ظ„ظ…ط³طھط®ط¯ظ… <code>${targetId}</code> ظˆطھظ… ط¥ط´ط¹ط§ط±ظ‡`, { parse_mode: 'HTML' });
    return;
  }

  // â”€â”€ attempts_remove_one_id: waiting for user ID â”€â”€
  if (adminInput === 'attempts_remove_one_id' && isAdminMsg) {
    const targetUser = await User.findOne({ telegramId: text });
    if (!targetUser) {
      await ctx.reply('â‌Œ ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯.');
      return;
    }
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'attempts_remove_one_amount', adminTargetUserId: text } }
    );
    await ctx.reply(`âœ… طھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ط§ظ„ظ…ط³طھط®ط¯ظ…: <code>${text}</code>\n\nط£ط±ط³ظ„ ط¹ط¯ط¯ ط§ظ„ظ…ط­ط§ظˆظ„ط§طھ ط§ظ„طھظٹ طھط±ظٹط¯ ط®طµظ…ظ‡ط§:`, { parse_mode: 'HTML' });
    return;
  }

  // â”€â”€ attempts_remove_one_amount: waiting for amount â”€â”€
  if (adminInput === 'attempts_remove_one_amount' && isAdminMsg) {
    const amount = parseInt(text);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('â‌Œ ط£ط±ط³ظ„ ط±ظ‚ظ…ط§ظ‹ طµط­ظٹط­ط§ظ‹ ط£ظƒط¨ط± ظ…ظ† طµظپط±.');
      return;
    }
    const targetId = adminInputUser?.adminTargetUserId;
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: null, adminTargetUserId: null } }
    );

    // Smart subtraction pipeline: prevents negative quota
    await User.findOneAndUpdate(
      { telegramId: targetId },
      [{ $set: { dailyQuota: { $max: [0, { $subtract: ["$dailyQuota", amount] }] } } }]
    );
    await ctx.reply(`âœ… طھظ… ط®طµظ… ${amount} ظ…ط­ط§ظˆظ„ط§طھ ظ…ظ† ط§ظ„ظ…ط³طھط®ط¯ظ… <code>${targetId}</code> (ط§ظ„ط±طµظٹط¯ ظ„ط§ ظٹظ†ط²ظ„ طھط­طھ ط§ظ„طµظپط±)`, { parse_mode: 'HTML' });
    return;
  }

  // â”€â”€ attempts_reset_one_id: waiting for user ID â”€â”€
  if (adminInput === 'attempts_reset_one_id' && isAdminMsg) {
    const targetUser = await User.findOne({ telegramId: text });
    if (!targetUser) {
      await ctx.reply('â‌Œ ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯.');
      return;
    }
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: null, adminTargetUserId: null } }
    );
    await User.findOneAndUpdate({ telegramId: text }, { $set: { dailyQuota: 0 } });
    await ctx.reply(`âœ… طھظ… طھطµظپظٹط± ظ…ط­ط§ظˆظ„ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ… <code>${text}</code>`, { parse_mode: 'HTML' });
    return;
  }

  // â”€â”€ magic_link_reward: waiting for reward amount â”€â”€
  if (adminInput === 'magic_link_reward' && isAdminMsg) {
    const reward = parseInt(text);
    if (isNaN(reward) || reward <= 0) {
      await ctx.reply('â‌Œ ط£ط±ط³ظ„ ط±ظ‚ظ…ط§ظ‹ طµط­ظٹط­ط§ظ‹ ط£ظƒط¨ط± ظ…ظ† طµظپط±.');
      return;
    }
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'magic_link_maxuses', adminTargetUserId: reward.toString() } }
    );
    await ctx.reply(`âœ… ط§ظ„ظ…ظƒط§ظپط£ط©: <b>${reward}</b> ظ…ط­ط§ظˆظ„ط§طھ\n\nط§ظ„ط¢ظ† ط£ط±ط³ظ„ ط§ظ„ط­ط¯ ط§ظ„ط£ظ‚طµظ‰ ظ„ط¹ط¯ط¯ ط§ظ„ط£ط´ط®ط§طµ ط§ظ„ظ…ط³ظ…ظˆط­ ظ„ظ‡ظ… ط¨ط§ط³طھط®ط¯ط§ظ… ط§ظ„ط±ط§ط¨ط·:`, { parse_mode: 'HTML' });
    return;
  }

  // â”€â”€ magic_link_maxuses: waiting for max uses â”€â”€
  if (adminInput === 'magic_link_maxuses' && isAdminMsg) {
    const maxUses = parseInt(text);
    if (isNaN(maxUses) || maxUses <= 0) {
      await ctx.reply('â‌Œ ط£ط±ط³ظ„ ط±ظ‚ظ…ط§ظ‹ طµط­ظٹط­ط§ظ‹ ط£ظƒط¨ط± ظ…ظ† طµظپط±.');
      return;
    }
    const reward = parseInt(adminInputUser?.adminTargetUserId || '0');

    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: null, adminTargetUserId: null } }
    );

    // Generate unique code & Expiration Date (24 Hours)
    const { v4: uuidv4 } = await import('uuid');
    const code = uuidv4().substring(0, 8).toUpperCase();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const { MagicLink } = await import('./database/models/MagicLink');
    await MagicLink.create({ code, reward, maxUses, currentUses: 0, usedBy: [], isActive: true, expiresAt });

    const botUsername = (await ctx.api.getMe()).username;
    const magicLinkUrl = `https://t.me/${botUsername}?start=magic_${code}`;

    await ctx.reply(
      `âœ… <b>طھظ… ط¥ظ†ط´ط§ط، ط±ط§ط¨ط· ط§ظ„ظ…ظƒط§ظپط£ط© ط¨ظ†ط¬ط§ط­!</b>\n\n` +
      `ًں”— <b>ط§ظ„ط±ط§ط¨ط·:</b>\n<code>${magicLinkUrl}</code>\n\n` +
      `ًںژپ <b>ط§ظ„ظ…ظƒط§ظپط£ط©:</b> ${reward} ظ…ط­ط§ظˆظ„ط§طھ ظ„ظƒظ„ ط´ط®طµ\n` +
      `ًں‘¥ <b>ط§ظ„ط­ط¯ ط§ظ„ط£ظ‚طµظ‰:</b> ${maxUses} ط´ط®طµ\n` +
      `âڈ³ <b>ط§ظ„طµظ„ط§ط­ظٹط©:</b> 24 ط³ط§ط¹ط© ظپظ‚ط·\n` +
      `ًں“ٹ <b>ط§ظ„ظƒظˆط¯:</b> <code>${code}</code>\n\n` +
      `âڑ ï¸ڈ ط§ظ„ط±ط§ط¨ط· ط³ظٹطھظˆظ‚ظپ طھظ„ظ‚ط§ط¦ظٹط§ظ‹ ط¨ط¹ط¯ ط§ط³طھط®ط¯ط§ظ…ظ‡ ${maxUses} ظ…ط±ط© ط£ظˆ ط¨ط¹ط¯ ظ…ط±ظˆط± 24 ط³ط§ط¹ط©.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // â”€â”€ add_fsub_input: waiting for channel data (CHANNEL_ID | URL | NAME) â”€â”€
  if (adminInput === 'add_fsub_input' && isAdminMsg) {
    const parts = text.split('|').map((s) => s.trim());

    if (parts.length !== 3) {
      await ctx.reply(
        'â‌Œ طµظٹط؛ط© ط®ط§ط·ط¦ط©. ط£ط±ط³ظ„ ظ‡ظƒط°ط§:\n' +
        '<code>CHANNEL_ID | CHANNEL_URL | CHANNEL_NAME</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }

    const [channelId, channelUrl, channelName] = parts;

    // Verify bot is admin in the channel before accepting
    try {
      const botInfo = await ctx.api.getMe();
      const botMember = await ctx.api.getChatMember(channelId, botInfo.id);

      if (!['administrator', 'creator'].includes(botMember.status)) {
        await ctx.reply(
          'â‌Œ ط§ظ„ط¨ظˆطھ ظ„ظٹط³ ظ…ط´ط±ظپط§ظ‹ ظپظٹ ظ‡ط°ظ‡ ط§ظ„ظ‚ظ†ط§ط©.\n' +
          'ط£ط¶ظپظ‡ ظƒظ…ط´ط±ظپ ط£ظˆظ„ط§ظ‹ ط«ظ… ط£ط±ط³ظ„ ط§ظ„ط¨ظٹط§ظ†ط§طھ ظ…ط¬ط¯ط¯ط§ظ‹.'
        );
        return;
      }
    } catch {
      await ctx.reply(
        'â‌Œ طھط¹ط°ط± ط§ظ„ظˆطµظˆظ„ ظ„ظ„ظ‚ظ†ط§ط©. طھط£ظƒط¯ ظ…ظ†:\n' +
        '1. طµط­ط© ط§ظ„ظ€ ID (ظٹط¨ط¯ط£ ط¨ظ€ -100...)\n' +
        '2. ط£ظ† ط§ظ„ط¨ظˆطھ ظ…ط´ط±ظپ ظپظٹظ‡ط§'
      );
      return;
    }

    const { ForceSubChannel } = await import('./database/models/ForceSubChannel');
    const count = await ForceSubChannel.countDocuments();

    if (count >= 10) {
      await ctx.reply('â‌Œ ظˆطµظ„طھ ظ„ظ„ط­ط¯ ط§ظ„ط£ظ‚طµظ‰ (10 ظ‚ظ†ظˆط§طھ).');
      await User.findOneAndUpdate(
        { telegramId: telegramId },
        { $set: { adminAwaitingInput: null } }
      );
      return;
    }

    const existing = await ForceSubChannel.findOne({ channelId });
    if (existing) {
      await ctx.reply('â‌Œ ظ‡ط°ظ‡ ط§ظ„ظ‚ظ†ط§ط© ظ…ط¶ط§ظپط© ظ…ط³ط¨ظ‚ط§ظ‹.');
      await User.findOneAndUpdate(
        { telegramId: telegramId },
        { $set: { adminAwaitingInput: null } }
      );
      return;
    }

    await ForceSubChannel.create({
      channelId,
      channelUrl,
      channelName,
      order: count,
    });

    await User.findOneAndUpdate(
      { telegramId: telegramId },
      { $set: { adminAwaitingInput: null } }
    );

    await ctx.reply(
      `âœ… طھظ… ط¥ط¶ط§ظپط© ط§ظ„ظ‚ظ†ط§ط© ط¨ظ†ط¬ط§ط­!\n\n` +
      `ًں“¢ ${channelName}\n` +
      `ًں†” ${channelId}\n\n` +
      'ط³طھط¸ظ‡ط± ط§ظ„ط¢ظ† ظ„ظ„ط¹ظ…ظ„ط§ط، ط¶ظ…ظ† ط´ط±ط· ط§ظ„ط§ط´طھط±ط§ظƒ ط§ظ„ط¥ط¬ط¨ط§ط±ظٹ.'
    );
    return;
  }

  // 2. Admin Awaiting Input Logic (Priority 2 - Kept exactly as original)
  if (isAdm && user?.adminAwaitingInput) {
    const inputType = user.adminAwaitingInput;
    const inputText = messageText;

    await User.findOneAndUpdate({ telegramId: telegramId }, { $set: { adminAwaitingInput: null } });

    if (inputType.startsWith('txtedit:')) {
      const key = inputType.replace('txtedit:', '');
      const newValue = inputText.trim();

      if (!newValue || newValue === '/cancel') {
        await ctx.reply('â‌Œ طھظ… ط§ظ„ط¥ظ„ط؛ط§ط،.');
        return;
      }

      const { updateText, getText } = await import('./services/botTextsService');
      const oldValue = await getText(key);
      const success = await updateText(key, newValue);

      if (success) {
        await ctx.reply(
          `âœ… <b>طھظ… ط§ظ„طھط­ط¯ظٹط« ط¨ظ†ط¬ط§ط­!</b>\n\n` +
          `ًں”‘ ط§ظ„ظ…ظپطھط§ط­: <code>${key}</code>\n\n` +
          `ًں“‌ <b>ط§ظ„ظ†طµ ط§ظ„ظ‚ط¯ظٹظ…:</b>\n<code>${oldValue.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>\n\n` +
          ` <b>ط§ظ„ظ†طµ ط§ظ„ط¬ط¯ظٹط¯:</b>\n<code>${newValue.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`,
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.reply(
          'â‌Œ ظپط´ظ„ ط§ظ„طھط­ط¯ظٹط«.\n' +
          `ط§ظ„ظ…ظپطھط§ط­ <code>${key}</code> ط؛ظٹط± ظ…ظˆط¬ظˆط¯ ظپظٹ ظ‚ط§ط¹ط¯ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ.`,
          { parse_mode: 'HTML' }
        );
      }
      return;
    }

    if (inputType === 'welcome_message') {
      const { BotSettings } = await import('./database/models/BotSettings');
      await BotSettings.findOneAndUpdate({ key: 'welcome_message' }, { value: inputText }, { upsert: true });
      await ctx.reply('âœ… طھظ… طھط­ط¯ظٹط« ط±ط³ط§ظ„ط© ط§ظ„طھط±ط­ظٹط¨ ط¨ظ†ط¬ط§ط­!');
      return;
    }

    if (inputType === 'convert_button_message') {
      const { BotSettings } = await import('./database/models/BotSettings');
      await BotSettings.findOneAndUpdate(
        { key: 'convert_button_message' },
        { value: inputText },
        { upsert: true }
      );
      await ctx.reply('âœ… طھظ… طھط­ط¯ظٹط« ط±ط³ط§ظ„ط© ط²ط± طھط­ظˆظٹظ„ ط§ظ„طµظٹط؛ط©!');
      return;
    }

    if (inputType === 'daily_reward_amount') {
      const { BotSettings } = await import('./database/models/BotSettings');
      const num = parseInt(inputText);
      if (isNaN(num) || num < 1) { await ctx.reply('â‌Œ ط£ط±ط³ظ„ ط±ظ‚ظ…ط§ظ‹ طµط­ظٹط­ط§ظ‹ ط£ظƒط¨ط± ظ…ظ† طµظپط±'); return; }
      await BotSettings.findOneAndUpdate({ key: 'daily_reward_amount' }, { value: inputText }, { upsert: true });
      await ctx.reply(`âœ… طھظ… طھط­ط¯ظٹط« ط§ظ„ظ…ط­ط§ظˆظ„ط§طھ ط§ظ„ظٹظˆظ…ظٹط© ط¥ظ„ظ‰ ${num} ظ…ط­ط§ظˆظ„ط§طھ`);
      return;
    }

    if (inputType === 'low_attempts_warning') {
      const { BotSettings } = await import('./database/models/BotSettings');
      await BotSettings.findOneAndUpdate({ key: 'low_attempts_warning' }, { value: inputText }, { upsert: true });
      await ctx.reply('âœ… طھظ… طھط­ط¯ظٹط« ط±ط³ط§ظ„ط© ط§ظ†طھظ‡ط§ط، ط§ظ„ظ…ط­ط§ظˆظ„ط§طھ');
      return;
    }

    if (inputType === 'broadcast') {
      const allUsers = await User.find({ isBanned: { $ne: true } });
      let successCount = 0; let failCount = 0;
      for (const u of allUsers) {
        try { await ctx.api.sendMessage(u.telegramId, inputText); successCount++; } catch { failCount++; }
      }
      await ctx.reply(`ًں“¢ <b>طھظ… ط¥ط±ط³ط§ظ„ ط§ظ„ط¥ط´ط¹ط§ط±</b>\nâœ… ظ†ط¬ط­: ${successCount}\nâ‌Œ ظپط´ظ„: ${failCount}`, { parse_mode: 'HTML' });
      return;
    }

    if (inputType === 'search_user') {
      const query = inputText.startsWith('@') ? { username: inputText.replace('@', '') } : { telegramId: inputText };
      const foundUser = await User.findOne(query);
      if (!foundUser) { await ctx.reply('â‌Œ ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯'); return; }
      await ctx.reply(
        `ًں”چ <b>ظ…ط¹ظ„ظˆظ…ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ…</b>\n\nًں†” ID: <code>${foundUser.telegramId}</code>\nًں‘¤ Username: @${foundUser.username || 'ط؛ظٹط± ظ…ط­ط¯ط¯'}\nâڑ، ط§ظ„ظ…ط­ط§ظˆظ„ط§طھ: ${foundUser.dailyQuota}\nًںڑ« ظ…ط­ط¸ظˆط±: ${foundUser.isBanned ? 'ظ†ط¹ظ…' : 'ظ„ط§'}`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              // @ts-ignore
              [{ text: 'ًںڑ« ط­ط¸ط±', callback_data: `admin_ban_${foundUser.telegramId}`, style: 'primary' as const }],
              [{ text: 'ًں”“ ط±ظپط¹ ط§ظ„ط­ط¸ط±', callback_data: `admin_unban_${foundUser.telegramId}`, style: 'primary' as const }],
              // @ts-ignore
              [{ text: 'â‍• ط¥ط¶ط§ظپط© ظ…ط­ط§ظˆظ„ط§طھ', callback_data: `admin_addattempts_${foundUser.telegramId}`, style: 'primary' as const }],
            ],
          },
        }
      );
      return;
    }
    if (inputType === 'grant_vip_id') {
      const targetUser = await User.findOne({ telegramId: inputText.trim() });
      if (!targetUser) {
        await ctx.reply('â‌Œ ظ„ظ… ظٹطھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ظ…ط³طھط®ط¯ظ… ط¨ظ‡ط°ط§ ط§ظ„ظ€ ID.');
        return;
      }
      await User.findOneAndUpdate({ telegramId: targetUser.telegramId }, { $set: { canBypassLocks: true } });
      await ctx.reply(`âœ… <b>طھظ… ط§ظ„طھظپط¹ظٹظ„!</b>\nط§ظ„ظ…ط³طھط®ط¯ظ… (<code>${targetUser.telegramId}</code>) ظٹط³طھط·ظٹط¹ ط§ظ„ط¢ظ† ط§ط³طھط®ط¯ط§ظ… ط¬ظ…ظٹط¹ ط§ظ„ظ…ظٹط²ط§طھ ط§ظ„ظ…ظ‚ظپظ„ط© ًںŒں`, { parse_mode: 'HTML' });
      try {
        await ctx.api.sendMessage(targetUser.telegramId, 'ًںŒں <b>طھظ… طھط±ظ‚ظٹط© ط­ط³ط§ط¨ظƒ (VIP)</b>\n\nطھظ… ظپطھط­ ط¬ظ…ظٹط¹ ط§ظ„ظ…ظٹط²ط§طھ ط§ظ„ظ…ظ‚ظپظ„ط© ظ„ظƒ! ًںکژ', { parse_mode: 'HTML' });
      } catch (e) { }
      return;
    }

    if (inputType === 'vip_size_bypass') {
      const targetUser = await User.findOne({ telegramId: inputText.trim() });
      if (!targetUser) {
        await ctx.reply('â‌Œ ظ„ظ… ظٹطھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ظ…ط³طھط®ط¯ظ… ط¨ظ‡ط°ط§ ط§ظ„ظ€ ID.');
        return;
      }
      await User.findOneAndUpdate({ telegramId: targetUser.telegramId }, { $set: { vipSizeBypass: true } });
      await ctx.reply(`âœ… <b>طھظ… ط§ظ„طھظپط¹ظٹظ„!</b>\nط§ظ„ظ…ط³طھط®ط¯ظ… (<code>${targetUser.telegramId}</code>) ظٹط³طھط·ظٹط¹ ط§ظ„ط¢ظ† ط¥ط±ط³ط§ظ„ طµظˆط± ط¨ط­ط¬ظ… ظٹطµظ„ ط¥ظ„ظ‰ 15 ظ…ظٹط¬ط§ط¨ط§ظٹطھ ًںŒں`, { parse_mode: 'HTML' });
      try {
        await ctx.api.sendMessage(targetUser.telegramId, 'ًںŒں <b>طھظ… طھط±ظ‚ظٹط© ط­ط³ط§ط¨ظƒ (VIP)</b>\n\nط¨ظ†ط§ط،ظ‹ ط¹ظ„ظ‰ ط·ظ„ط¨ظƒطŒ طھظ… ظپطھط­ ط§ظ„ط­ط¯ ط§ظ„ط£ظ‚طµظ‰ ظ„ظ„ظ…ظ…ط­ط§ط© ط§ظ„ط³ط­ط±ظٹط©. ظٹظ…ظƒظ†ظƒ ط§ظ„ط¢ظ† ط¥ط±ط³ط§ظ„ طµظˆط± ط¨ط­ط¬ظ… ظٹطµظ„ ط¥ظ„ظ‰ <b>15 ظ…ظٹط¬ط§ط¨ط§ظٹطھ</b>! ًںکژ', { parse_mode: 'HTML' });
      } catch (e) { }
      return;
    }
  }

  // â”€â”€ GIVEAWAY SETUP FLOW (admin only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (isAdm) {
    const adminUser2 = await User.findOne({ telegramId: telegramId });
    const gwSetup = (adminUser2 as any)?.giveawaySetup;
    const gwStep: string | null = gwSetup?.step ?? null;

    if (gwStep === 'gw_winners') {
      const count = parseInt(messageText.trim());
      if (isNaN(count) || count < 1) {
        await ctx.reply('âڑ ï¸ڈ ظٹط±ط¬ظ‰ ط¥ط±ط³ط§ظ„ ط±ظ‚ظ… طµط­ظٹط­ ط£ظƒط¨ط± ظ…ظ† طµظپط±.');
        return;
      }
      await User.updateOne(
        { telegramId },
        { $set: { 'giveawaySetup.maxWinners': count, 'giveawaySetup.step': 'gw_min_reward' } }
      );
      await ctx.reply(
        `âœ… ط¹ط¯ط¯ ط§ظ„ظپط§ط¦ط²ظٹظ†: <b>${count}</b>\n\n` +
        `â”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پ\n` +
        `ًںژپ <b>ط§ظ„ط®ط·ظˆط© 2/3</b>\n` +
        `ط£ط±ط³ظ„ <b>ط§ظ„ط­ط¯ ط§ظ„ط£ط¯ظ†ظ‰ ظ„ظ„ط¬ط§ط¦ط²ط©</b> (ط¨ط§ظ„ظ…ط­ط§ظˆظ„ط§طھ)\n` +
        `<i>ظ…ط«ط§ظ„: 1</i>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    if (gwStep === 'gw_min_reward') {
      const min = parseInt(messageText.trim());
      if (isNaN(min) || min < 1) {
        await ctx.reply('âڑ ï¸ڈ ظٹط±ط¬ظ‰ ط¥ط±ط³ط§ظ„ ط±ظ‚ظ… طµط­ظٹط­ ط£ظƒط¨ط± ظ…ظ† طµظپط±.');
        return;
      }
      await User.updateOne(
        { telegramId },
        { $set: { 'giveawaySetup.minReward': min, 'giveawaySetup.step': 'gw_max_reward' } }
      );
      await ctx.reply(
        `âœ… ط§ظ„ط­ط¯ ط§ظ„ط£ط¯ظ†ظ‰ ظ„ظ„ط¬ط§ط¦ط²ط©: <b>${min} ظ…ط­ط§ظˆظ„ط§طھ</b>\n\n` +
        `â”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پ\n` +
        `ًں’° ط£ط±ط³ظ„ <b>ط§ظ„ط­ط¯ ط§ظ„ط£ظ‚طµظ‰ ظ„ظ„ط¬ط§ط¦ط²ط©</b>\n` +
        `<i>ظ…ط«ط§ظ„: 10 (ط³ظٹظˆط²ط¹ ط¹ط´ظˆط§ط¦ظٹط§ظ‹ ظ…ظ† ${min} ط¥ظ„ظ‰ 10)</i>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    if (gwStep === 'gw_max_reward') {
      const max = parseInt(messageText.trim());
      const min = gwSetup?.minReward ?? 1;
      if (isNaN(max) || max < min) {
        await ctx.reply(`âڑ ï¸ڈ ظٹط¬ط¨ ط£ظ† ظٹظƒظˆظ† ط§ظ„ط­ط¯ ط§ظ„ط£ظ‚طµظ‰ ط£ظƒط¨ط± ظ…ظ† ط£ظˆ ظٹط³ط§ظˆظٹ ${min}.`);
        return;
      }
      await User.updateOne(
        { telegramId },
        { $set: { 'giveawaySetup.maxReward': max, 'giveawaySetup.step': 'gw_channel' } }
      );
      await ctx.reply(
        `âœ… ظ†ط·ط§ظ‚ ط§ظ„ط¬ط§ط¦ط²ط©: <b>${min} â€” ${max} ظ…ط­ط§ظˆظ„ط§طھ</b>\n\n` +
        `â”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پ\n` +
        `ًں“¢ <b>ط§ظ„ط®ط·ظˆط© 3/3</b>\n` +
        `ط£ط±ط³ظ„ <b>ظ…ط¹ط±ظپ ط§ظ„ظ‚ظ†ط§ط©</b> ط£ظˆ ID ط§ظ„ظ‚ظ†ط§ط© ظ„ظ†ط´ط± ط§ظ„طھظˆط²ظٹط¹ط©\n` +
        `<i>ظ…ط«ط§ظ„: @MyChannel ط£ظˆ -1001234567890</i>\n\n` +
        `âڑ ï¸ڈ طھط£ظƒط¯ ط£ظ† ط§ظ„ط¨ظˆطھ ظ…ط´ط±ظپ ظپظٹ ط§ظ„ظ‚ظ†ط§ط©`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    if (gwStep === 'gw_channel') {
      const channelId = messageText.trim();
      if (!gwSetup?.maxWinners) {
        await ctx.reply('â‌Œ ط­ط¯ط« ط®ط·ط£ ظپظٹ ط§ظ„ط¥ط¹ط¯ط§ط¯. ط§ط¨ط¯ط£ ظ…ظ† ط¬ط¯ظٹط¯.');
        await User.updateOne({ telegramId }, { $set: { 'giveawaySetup.step': null } });
        return;
      }
      const { Giveaway } = await import('./database/models/Giveaway');
      try {
        const giveawayText =
          `ًںژ‰ <b>طھظˆط²ظٹط¹ط§طھ NizoAI Bot</b> ًںژپ\n\n` +
          `â”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پ\n` +
          `ًںڈ† <b>ظپط±طµط© ط°ظ‡ط¨ظٹط© ظ„ط±ط¨ط­ ظ…ط­ط§ظˆظ„ط§طھ ظ…ط¬ط§ظ†ظٹط©!</b>\n` +
          `â”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پ\n\n` +
          `ًں’ژ <b>ط§ظ„ط¬ط§ط¦ط²ط©:</b> ظ…ظ† ${gwSetup.minReward} ط¥ظ„ظ‰ ${gwSetup.maxReward} ظ…ط­ط§ظˆظ„ط§طھ ط¹ط´ظˆط§ط¦ظٹط§ظ‹\n` +
          `ًں‘¥ <b>ط¹ط¯ط¯ ط§ظ„ظپط§ط¦ط²ظٹظ†:</b> ${gwSetup.maxWinners} ط´ط®طµ ظ…ط­ط¸ظˆط¸\n\n` +
          `âڑ، ط§ظ„ظ…ط³طھط®ط¯ظ…ظˆظ† ط§ظ„ظ†ط´ط·ظˆظ† ظ„ط¯ظٹظ‡ظ… ظپط±طµ ط£ط¹ظ„ظ‰ ظ„ظ„ظپظˆط²!\n\n` +
          `ًں‘‡ <b>ط§ط¶ط؛ط· ط§ظ„ط²ط± ظˆط§ظƒطھط´ظپ ط­ط¸ظƒ ط§ظ„ط¢ظ†!</b>`;

        const msg = await ctx.api.sendMessage(
          channelId,
          giveawayText,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                // @ts-ignore
                { text: 'ًںچ€ ط¬ط±ط¨ ط­ط¸ظƒ ط§ظ„ط¢ظ† ًںں¢', callback_data: 'gw_roll_init', style: 'primary' as const } as any
              ]]
            }
          }
        );

        await Giveaway.create({
          channelId,
          messageId: msg.message_id,
          maxWinners: gwSetup.maxWinners,
          minReward: gwSetup.minReward,
          maxReward: gwSetup.maxReward,
        });

        await User.updateOne({ telegramId }, { $set: { 'giveawaySetup.step': null } });

        const safeChannel = channelId.replace('@', '');
        await ctx.reply(
          `âœ… <b>طھظ… ظ†ط´ط± ط§ظ„طھظˆط²ظٹط¹ط© ط¨ظ†ط¬ط§ط­!</b> ًںژ‰\n\n` +
          `ًں“¢ ط§ظ„ظ‚ظ†ط§ط©: <code>${channelId}</code>\n` +
          `ًں‘¥ ط§ظ„ظپط§ط¦ط²ظˆظ†: ${gwSetup.maxWinners}\n` +
          `ًںژپ ط§ظ„ط¬ظˆط§ط¦ط²: ${gwSetup.minReward}â€“${gwSetup.maxReward} ظ…ط­ط§ظˆظ„ط§طھ\n\n` +
          `ًں’، ظٹظ…ظƒظ†ظƒ ط¥ط¹ط§ط¯ط© ظ†ط´ط± ط±ط³ط§ظ„ط© ط§ظ„طھظˆط²ظٹط¹ط© ظپظٹ ط£ظٹ ظˆظ‚طھ`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                { text: 'ًں“¤ ط¹ط±ط¶ ط±ط³ط§ظ„ط© ط§ظ„طھظˆط²ظٹط¹ط©', url: `https://t.me/${safeChannel}/${msg.message_id}`, style: 'primary' as const }
              ]]
            }
          }
        );
      } catch (err: any) {
        await ctx.reply(
          `â‌Œ <b>ظپط´ظ„ ط§ظ„ظ†ط´ط±!</b>\n\n` +
          `طھط£ظƒط¯ ط£ظ† ط§ظ„ط¨ظˆطھ ظ…ط´ط±ظپ ظپظٹ ط§ظ„ظ‚ظ†ط§ط© ظˆط£ظ† ط§ظ„ظ…ط¹ط±ظپ طµط­ظٹط­.\n` +
          `<code>${err.message}</code>`,
          { parse_mode: 'HTML' }
        );
        await User.updateOne({ telegramId }, { $set: { 'giveawaySetup.step': null } });
      }
      return;
    }
  }


  // 3. Fund Campaign Logic (Priority 3 - Kept exactly as original)
  const { isFundCampaignPending, handleFundCampaignInput, broadcastFundCampaign } = await import('./services/channelFundService');
  if (isAdm && isFundCampaignPending(ctx.from!.id)) {
    const result = await handleFundCampaignInput(ctx.from!.id, ctx.message!.text || '', ctx.api);
    if (result.status === 'ask_target') {
      // @ts-ignore
      await ctx.reply(`âœ… طھظ… ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† طµظ„ط§ط­ظٹط§طھ ط§ظ„ط¨ظˆطھ.\n\nظƒظ… ط¹ط¯ط¯ ط§ظ„ط£ط¹ط¶ط§ط، ط§ظ„ظ…ط·ظ„ظˆط¨طں`, { reply_markup: { inline_keyboard: [[{ text: 'â†©ï¸ڈ ط±ط¬ظˆط¹', callback_data: 'cancel_fund_campaign', style: 'danger' as const }]] } });
    } else if (result.status === 'not_admin_in_channel') {
      await ctx.reply('â‌Œ ط§ظ„ط¨ظˆطھ ظ„ظٹط³ ظ…ط´ط±ظپط§ظ‹ ظپظٹ ظ‡ط°ظ‡ ط§ظ„ظ‚ظ†ط§ط©. ط£ط¶ظپظ‡ ظƒظ…ط´ط±ظپ ط£ظˆظ„ط§ظ‹ ط«ظ… ط£ط¹ط¯ ط§ظ„ظ…ط­ط§ظˆظ„ط©.');
    } else if (result.status === 'done' && 'campaign' in result) {
      const campaign = result.campaign;
      await ctx.reply(`âœ… طھظ… ط¥ظ†ط´ط§ط، ط§ظ„ط­ظ…ظ„ط© ط¨ظ†ط¬ط§ط­!\n\nًں“¢ ط§ظ„ظ‚ظ†ط§ط©: ${campaign.channelLink}\nًںژ¯ ط§ظ„ظ‡ط¯ظپ: ${campaign.targetMembers} ط¹ط¶ظˆ\n\nâڈ³ ط¬ط§ط±ظٹ ط§ظ„ط¥ط°ط§ط¹ط©...`);
      const { sent, failed } = await broadcastFundCampaign(ctx.api, campaign);
      const { InlineKeyboard } = await import('grammy');
      const deleteBroadcastKeyboard = new InlineKeyboard().text('ًں—‘ ط­ط°ظپ ط§ظ„ط¥ط°ط§ط¹ط©', `delete_broadcast_${campaign._id}`);
      await ctx.reply(`ًں“¢ ط§ظƒطھظ…ظ„طھ ط§ظ„ط¥ط°ط§ط¹ط©!\nâœ… ظ†ط¬ط­: ${sent}\nâ‌Œ ظپط´ظ„: ${failed}`, { reply_markup: deleteBroadcastKeyboard });
    } else if (result.status === 'invalid_target') {
      await ctx.reply('â‌Œ ط¹ط¯ط¯ ط؛ظٹط± طµط­ظٹط­.');
    }
    return;
  }

  // 3b. Admin User Control â€” waiting for target User ID (adminActionState)
  const adminUser = await User.findOne({ telegramId: telegramId });
  if (adminUser && adminUser.adminActionState && adminUser.adminActionState.startsWith('auc_')) {
    const targetId = ctx.message?.text?.trim();

    if (!targetId) {
      await ctx.reply('â‌Œ ط£ط±ط³ظ„ ID ط§ظ„ظ…ط³طھط®ط¯ظ… ظƒط±ظ‚ظ… ظپظ‚ط·.');
      return;
    }

    const actionState = adminUser.adminActionState; // e.g. "auc_ban"
    const action = actionState.replace('auc_', ''); // "ban" | "restrict" | "unban" | "unrestrict" | "info"

    const actionLabelMap: Record<string, string> = {
      ban: 'ط­ط¸ط±', restrict: 'طھظ‚ظٹظٹط¯',
      unban: 'ظپظƒ ط­ط¸ط±', unrestrict: 'ظپظƒ طھظ‚ظٹظٹط¯', info: 'ط§ط³طھط¹ظ„ط§ظ… ط¹ظ†'
    };

    if (action === 'info') {
      const targetUser = await User.findOne({ telegramId: targetId });
      if (!targetUser) {
        await ctx.reply('â‌Œ ظ„ظ… ظٹطھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ظ…ط³طھط®ط¯ظ… ط¨ظ‡ط°ط§ ط§ظ„ظ€ ID.');
      } else {
        await ctx.reply(
          `â„¹ï¸ڈ <b>ظ…ط¹ظ„ظˆظ…ط§طھ ط§ظ„ط¹ظ…ظٹظ„</b>\n\n` +
          `ًں†” ID: <code>${targetUser.telegramId}</code>\n` +
          `ًں‘¤ Username: @${targetUser.username || 'ط؛ظٹط± ظ…ط­ط¯ط¯'}\n` +
          `âڑ، ط§ظ„ظ…ط­ط§ظˆظ„ط§طھ: ${targetUser.dailyQuota}\n` +
          `ًںڑ« ظ…ط­ط¸ظˆط±: ${targetUser.isBanned ? 'ظ†ط¹ظ…' : 'ظ„ط§'}\n` +
          `âڑ ï¸ڈ ظ…ظ‚ظٹط¯: ${(targetUser as any).isRestricted ? 'ظ†ط¹ظ…' : 'ظ„ط§'}`,
          { parse_mode: 'HTML' }
        );
      }
      await User.updateOne({ telegramId: telegramId }, { $set: { adminActionState: '' } });
      return;
    }

    const labelMap = actionLabelMap[action] || action;
    await ctx.reply(
      `âڑ ï¸ڈ <b>طھط£ظƒظٹط¯ ط§ظ„ط¥ط¬ط±ط§ط،</b>\n\n` +
      `ط§ظ„ط¥ط¬ط±ط§ط،: <b>${labelMap}</b>\n` +
      `ط§ظ„ط¹ظ…ظٹظ„: <code>${targetId}</code>\n\n` +
      `ظ‡ظ„ ط£ظ†طھ ظ…طھط£ظƒط¯طں`,
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text(`âœ… ظ†ط¹ظ…طŒ ${labelMap}`, `auc_confirm_${action}_${targetId}`)
          .text('â‌Œ ط¥ظ„ط؛ط§ط،', 'admin_cancel_action')
      }
    );

    await User.updateOne({ telegramId: telegramId }, { $set: { adminActionState: '' } });
    return;
  }

  // 4. Strict Admin -> User Support Routing (Admin is sending a message during an active session)
  if (isAdm) {
    const activeUser = await User.findOne({
      supportSessionActive: true,
      supportSessionAdminId: telegramId
    });

    if (activeUser) {
      // Admin is in a session, intercept this message and ask for confirmation.
      await ctx.reply(
        `ًں“¤ <b>ظ‡ظ„ ط£ظ†طھ ظ…طھط£ظƒط¯ ظ…ظ† ط¥ط±ط³ط§ظ„ ظ‡ط°ط§ ط§ظ„ط±ط¯ ظ„ظ„ط¹ظ…ظٹظ„طں</b>\n\n` +
        `ًں‘¤ <b>ظ…ط¹ط±ظپ ط§ظ„ط¹ظ…ظٹظ„:</b> <code>${activeUser.telegramId}</code>\n` +
        `âڑ ï¸ڈ <i>ط¥ط°ط§ ظ„ظ… طھظ‚طµط¯ ط§ظ„ط±ط¯ ط¹ظ„ظٹظ‡طŒ ظ‚ظ… ط¨ظ‚ظپظ„ ط§ظ„ظ…ط­ط§ط¯ط«ط© ط£ظˆظ„ط§ظ‹ (ط£ط±ط³ظ„: ظ‚ظپظ„ ط§ظ„ظ…ط­ط§ط¯ط«ط©)</i>`,
        {
          parse_mode: 'HTML',
          reply_parameters: { message_id: ctx.message!.message_id },
          reply_markup: {
            inline_keyboard: [[
              // @ts-ignore
              { text: 'âœ… ظ†ط¹ظ…طŒ ط£ط±ط³ظ„ ظ„ظ„ط¹ظ…ظٹظ„', callback_data: `confirm_support_send_${activeUser.telegramId}`, style: 'success' as const },
              { text: 'â‌Œ ظ„ط§طŒ ط¥ظ„ط؛ط§ط، ط§ظ„ط¥ط±ط³ط§ظ„', callback_data: 'cancel_support_send', style: 'danger' as const }
            ]]
          }
        }
      );
      return; // Do not process further
    }
  }

  // 5. Strict User -> Admin Support Routing (User is sending a message during an active session)
  if (user?.supportSessionActive && user.supportSessionAdminId) {
    await ctx.api.sendMessage(
      user.supportSessionAdminId,
      `ًں’¬ <b>ط±ط¯ ظ…ظ† ط§ظ„ط¹ظ…ظٹظ„ (${ctx.from?.first_name || 'ظ…ط¬ظ‡ظˆظ„'} | <code>${telegramId}</code>):</b>\n\n${messageText}`,
      { parse_mode: 'HTML' }
    );
    return; // Stop â€” don't process as standard message
  }

  // â”€â”€ [INTERNET FETCHER v10.0] Zero-disk in-memory pipeline â”€â”€
  if ((ctx.session as any)?.awaitingInternetLink) {
    (ctx.session as any).awaitingInternetLink = false;

    let link: string = ctx.message?.text?.trim() ?? '';
    if (!link.startsWith('http')) {
      await ctx.reply('â‌Œ ظٹط±ط¬ظ‰ ط¥ط±ط³ط§ظ„ ط±ط§ط¨ط· طµط­ظٹط­ ظٹط¨ط¯ط£ ط¨ظ€ http');
      return;
    }

    // â”€â”€ Guard B: Kill-Switch â”€â”€
    const { isInternetFetcherEnabled: _ifeB } = await import('./utils/internetFetcherSettings');
    const fetcherAdminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const isFetcherAdmin = fetcherAdminIds.includes(ctx.from?.id?.toString() || '');

    // Allow passing if the feature is enabled OR if the user is an Admin
    if (!_ifeB() && !isFetcherAdmin) {
      await ctx.reply(
        `ًں”§ *طھط­ظ…ظٹظ„ ط§ظ„طµظˆط± ظ…ظ† ط§ظ„ط¥ظ†طھط±ظ†طھ*\n\n` +
        `âœ¨ ظ‡ط°ظ‡ ط§ظ„ظ…ظٹط²ط© طھط­طھ ط§ظ„طµظٹط§ظ†ط© ط­ط§ظ„ظٹط§ظ‹ ظ„طھظ‚ط¯ظٹظ… طھط¬ط±ط¨ط© ط£ظپط¶ظ„ ظ„ظƒ!\n\n` +
        `ًںڑ€ ط³ظٹطھظ… ط¥ط¹ط§ط¯ط© طھظپط¹ظٹظ„ظ‡ط§ ظ‚ط±ظٹط¨ط§ظ‹ ط¥ظ† ط´ط§ط، ط§ظ„ظ„ظ‡ ًںŒں\n` +
        `ًں’™ ظ†ط¹طھط°ط± ط¹ظ† ط§ظ„ط¥ط²ط¹ط§ط¬ ظˆظ†ظ‚ط¯ظ‘ط± طµط¨ط±ظƒ ط§ظ„ط¬ظ…ظٹظ„`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    // â”€â”€ Smart CDN Resolver â”€â”€
    const { resolveCdnToPageUrl } = await import('./services/imageFetcherService');
    const resolvedLink: string = resolveCdnToPageUrl(link);

    if (resolvedLink !== link) {
      const cdnMsg = await ctx.reply(
        'ًں”„ <b>طھظ… ط§ظƒطھط´ط§ظپ ط±ط§ط¨ط· CDN ظ…ط¨ط§ط´ط±!</b>\n\n' +
        'ًں§  ط¬ط§ط±ظٹ ط§ظ„طھط­ظˆظٹظ„ ط§ظ„طھظ„ظ‚ط§ط¦ظٹ ط¥ظ„ظ‰ ط±ط§ط¨ط· ط§ظ„طµظپط­ط© ط§ظ„ط£طµظ„ظٹط©...',
        { parse_mode: 'HTML' },
      );
      link = resolvedLink;
      await new Promise(r => setTimeout(r, 1_500));
      await ctx.api.deleteMessage(cdnMsg.chat.id, cdnMsg.message_id).catch(() => {});
    } else if (
      /istockphoto\.com\/.*\.(jpg|jpeg|png)/i.test(link) ||
      /shutterstock\.com\/.*\.(jpg|jpeg|png)/i.test(link)
    ) {
      await ctx.reply(
        'âڑ ï¸ڈ <b>ط±ط§ط¨ط· طµظˆط±ط© ظ…طµط؛ط±ط© ط¨ط¹ظ„ط§ظ…ط© ظ…ط§ط¦ظٹط©!</b>\n\n' +
        'ظ‡ط°ط§ ط§ظ„ط±ط§ط¨ط· ظٹط´ظٹط± ط¥ظ„ظ‰ ظ†ط³ط®ط© ظ…طµط؛ط±ط© طھط­طھظˆظٹ ط¹ظ„ظ‰ ط¹ظ„ط§ظ…ط© ظ…ط§ط¦ظٹط© ظ…ط¯ظ…ط¬ط©.\n\n' +
        'ًں’، <b>ط§ظ„ط­ظ„:</b> ط£ط±ط³ظ„ <b>ط±ط§ط¨ط· طµظپط­ط© ط§ظ„ظ…ظˆظ‚ط¹</b> ظˆط³ط£ط³ط­ط¨ ط§ظ„طµظˆط±ط© ط§ظ„ط£طµظ„ظٹط© ط¨ط¯ظˆظ† ط¹ظ„ط§ظ…ط© ظ…ط§ط¦ظٹط© ًں§‍\n\n' +
        'ًں“Œ <b>ظ…ط«ط§ظ„:</b>\n<code>https://www.istockphoto.com/photo/...</code>',
        { parse_mode: 'HTML' },
      );
      return;
    }

    // â”€â”€ Quota check â”€â”€
    const { User } = await import('./database/models/User');
    const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
    if (!user || user.dailyQuota < 2) {
      await ctx.reply(
        'â‌Œ <b>ط±طµظٹط¯ظƒ ط؛ظٹط± ظƒط§ظپظچ!</b>\n\n' +
        'طھط­طھط§ط¬ ط¥ظ„ظ‰ ظ…ط­ط§ظˆظ„طھظٹظ† (2) ط¹ظ„ظ‰ ط§ظ„ط£ظ‚ظ„ ظ„ظ‡ط°ظ‡ ط§ظ„ظ…ظٹط²ط© ًں§‍',
        { parse_mode: 'HTML' },
      );
      return;
    }

    const domainMatch = link.match(/^https?:\/\/(?:www\.)?([^/?#]+)/i);
    const domain = domainMatch?.[1] ?? 'ط§ظ„ظ…ظˆظ‚ط¹ ط§ظ„ظ…ط·ظ„ظˆط¨';

    const processingMsg = await ctx.reply(
      '🌐 <b>جاري معالجة الرابط...</b>\n\n' +
      '⚙️ يتم الآن تحليل البيانات واستخراج الصورة بأعلى جودة متاحة\n' +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      '⏱ قد تستغرق العملية 30-60 ثانية...',
      { parse_mode: 'HTML' }
    );

    const waitMessages = [
      `ًں”چ <b>ط¬ط§ط±ظٹ ظپط­طµ ط§ظ„ط±ط§ط¨ط· ظˆط§ظ„ط¨ط­ط« ط¹ظ† ط§ظ„طµظˆط±ط©...</b>`,
      `ًںژ‰ <b>ظˆط¬ط¯ظ†ط§ ط§ظ„طµظˆط±ط© ظپظٹ ظ…ظˆظ‚ط¹ ${domain}!</b>`,
      `ًں“¥ <b>ط¬ط§ط±ظٹ ط§ظ„ط³ط­ط¨ ظˆط§ظ„ط¥ط±ط³ط§ظ„... ط´ط§ظƒط±ظٹظ† طµط¨ط±ظƒ âڈ³</b>`,
    ];
    let msgIndex = 0;
    const fetchInterval = setInterval(() => {
      msgIndex = (msgIndex + 1) % waitMessages.length;
      ctx.api.editMessageText(
        processingMsg.chat.id,
        processingMsg.message_id,
        waitMessages[msgIndex],
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }, 3500);

    try {
      const { fetchHighResImage } = await import('./services/imageFetcherService');
      const imageBuffer: Buffer = await fetchHighResImage(link);

      // --- PHANTOM VALIDATOR: Ensure it's a real image, not HTML ---
      const head = imageBuffer.toString('utf8', 0, 50).toLowerCase();
      if (head.includes('<html') || head.includes('<!doctype') || head.includes('<body')) {
        throw new Error('CORRUPTED_HTML_RECEIVED');
      }

      try {
        const sharp = (await import('sharp')).default;
        await sharp(imageBuffer).metadata();
      } catch (e) {
        throw new Error('CORRUPTED_INVALID_IMAGE');
      }
      // --------------------------------------------------------------

      clearInterval(fetchInterval);

      user.dailyQuota        -= 2;
      user.totalEnhancements  = (user.totalEnhancements ?? 0) + 1;
      await user.save();

      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => {});

      try {
        const { incrementGlobalCounter } = await import('./services/statsService');
        await incrementGlobalCounter();
      } catch { /* non-critical */ }

      const { InputFile } = await import('grammy');
      const fileName       = `Nizo_HighRes_${Date.now()}.jpg`;

      // â”€â”€ Format conversion buttons â”€â”€
      const formatKeyboard = {
        inline_keyboard: [
          [
            { text: 'ًں–¼ï¸ڈ JPG',  callback_data: 'magic_fmt_jpg',  style: 'primary' as const },
            { text: 'ًں–¼ï¸ڈ PNG',  callback_data: 'magic_fmt_png',  style: 'primary' as const },
            { text: 'ًں–¼ï¸ڈ WEBP', callback_data: 'magic_fmt_webp', style: 'primary' as const },
          ],
          [
            { text: 'ًں–¼ï¸ڈ AVIF', callback_data: 'magic_fmt_avif', style: 'primary' as const },
            { text: 'ًں–¼ï¸ڈ TIFF', callback_data: 'magic_fmt_tiff', style: 'primary' as const },
          ],
        ],
      };

      await ctx.replyWithDocument(new InputFile(imageBuffer, fileName), {
        caption:
          '✅ <b>تم استخراج الصورة بنجاح!</b>\n\n' +
          '💎 الجودة: أعلى دقة أصلية متاحة\n' +
          '📁 تم الإرسال كملف للحفاظ على الجودة الكاملة',
        parse_mode:   'HTML',
        reply_markup: formatKeyboard,
      });

      await User.findOneAndUpdate(
        { telegramId: ctx.from!.id.toString() },
        { $set: { lastMagicEnhanceBuffer: imageBuffer.toString('base64') } },
      );

      const ARCHIVE_ID: string = process.env.ARCHIVE_GROUP_ID ?? process.env.CHANNEL_ID ?? '';

      if (ARCHIVE_ID) {
        const userTag: string = ctx.from!.username ? `@${ctx.from!.username}` : ctx.from!.first_name ?? 'ظ…ط¬ظ‡ظˆظ„';
        const domainMatch       = link.match(/^https?:\/\/(?:www\.)?([^/?#]+)/i);
        const domain: string    = domainMatch?.[1] ?? 'ط؛ظٹط± ظ…ط¹ط±ظˆظپ';
        const shortLink: string = link.length > 60 ? `${link.substring(0, 60)}...` : link;

        ctx.api.sendDocument(ARCHIVE_ID, new InputFile(imageBuffer, fileName), {
          caption:
            `ًں“¦ <b>ط£ط±ط´ظٹظپ â€” طھط­ظ…ظٹظ„ ظ…ظ† ط§ظ„ط¥ظ†طھط±ظ†طھ</b>\n` +
            `â”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پ\n` +
            `ًں†” ID: <code>${ctx.from!.id}</code>\n` +
            `ًں‘¤ User: ${userTag}\n` +
            `ًںŒگ ط§ظ„ظ…ظˆظ‚ط¹: <b>${domain}</b>\n` +
            `ًں”— ط§ظ„ط±ط§ط¨ط·: ${shortLink}\n` +
            `ًں“ڈ ط§ظ„ط­ط¬ظ…: ${(imageBuffer.length / 1024).toFixed(1)}KB\n` +
            `ًں“… ط§ظ„ظˆظ‚طھ: ${new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })}\n` +
            `â”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پâ”پ`,
          parse_mode: 'HTML', disable_notification: true,
        }).catch(() => {});
      }

    } catch (err: any) {
      const errMsg: string = (err?.message ?? '').toUpperCase();

      clearInterval(fetchInterval);
      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => {});
      console.error('[ImageFetcher-v10]', (err as Error).message);

      if (
        errMsg.includes('VIP_PROXIES_EXHAUSTED') ||
        errMsg.includes('CORRUPTED')             ||
        errMsg.includes('HTML')
      ) {
        await ctx.reply(
          '❌ <b>تعذّر استخراج الصورة من هذا الرابط.</b>\n\n' +
          'قد تكون الصورة محمية بقيود الوصول، أو أن الرابط غير مدعوم حالياً.\n' +
          'يرجى تجربة رابط مختلف أو رفع الصورة مباشرة 🔗',
          { parse_mode: 'HTML' }
        );
      } else if (
        errMsg.includes('TIMEOUT') ||
        errMsg.includes('TIME_OUT')
      ) {
        await ctx.reply(
          '⏳ <b>انتهت مهلة الاتصال بالخادم.</b>\n\n' +
          'المصدر لا يستجيب حالياً أو أن حجم الملف كبير جداً.\n' +
          'يرجى المحاولة مجدداً بعد قليل ⚡',
          { parse_mode: 'HTML' }
        );
      } else if (errMsg.includes('ALL_LAYERS_EXHAUSTED')) {
        await ctx.reply(
          '⚠️ <b>لم يتمكن النظام من استخراج الصورة.</b>\n\n' +
          'هذا الرابط لا يدعم الاستخراج المباشر.\n' +
          'يرجى رفع الصورة يدوياً أو تجربة رابط آخر 📎',
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.reply(
          '⚠️ <b>حدث خطأ أثناء معالجة الرابط.</b>\n\n' +
          'يرجى التأكد من صحة الرابط والمحاولة مرة أخرى 🔄',
          { parse_mode: 'HTML' }
        );
      }
    }
    return;
  }
  // â”€â”€ [END INTERNET FETCHER v10.0] â”€â”€

  // â”€â”€ Report interceptor for text messages â”€â”€
  if (user?.awaitingReport) {
    await User.findOneAndUpdate({ telegramId }, { $set: { awaitingReport: false } });

    const messageId = ctx.message?.message_id;
    const chatId = ctx.chat?.id;

    if (messageId && chatId) {
      await ctx.reply(
        'ًں“¤ <b>ظ‡ظ„ طھط±ظٹط¯ ظ…ط´ط§ط±ظƒط© ظ‡ط°ط§ ط§ظ„ط¨ظ„ط§ط؛ ظ…ط¹ ظ…ط·ظˆط± ط§ظ„ط¨ظˆطھطں</b>\n\n' +
        'ط³ظٹطھظ… ط¥ط±ط³ط§ظ„ ط±ط³ط§ظ„طھظƒ ظ„ظ„ظ…ط·ظˆط± ظ…ط¨ط§ط´ط±ط© ظˆط³ظٹطھظ… ط§ظ„ط±ط¯ ط¹ظ„ظٹظƒ ظپظٹ ط£ظ‚ط±ط¨ ظˆظ‚طھ ًں’™',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                // @ts-ignore
                { text: 'âœ… ظ†ط¹ظ…طŒ ط£ط±ط³ظ„ ط§ظ„ط¨ظ„ط§ط؛', callback_data: `confirm_report_${chatId}_${messageId}`, style: 'success' as const },
                { text: 'â‌Œ ظ„ط§طŒ ط¥ظ„ط؛ط§ط،', callback_data: 'cancel_report_confirm', style: 'danger' as const },
              ],
            ],
          },
        }
      );
    }
    return;
  }

  await next();
});

// â”€â”€â”€ Support Session Media Tunnel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Intercepts photos & documents when either side is in an active support
// session â€” must be registered BEFORE the imageHandler so these messages
// are never fed into the enhancement pipeline.

imageBot.on([':photo', ':document'], async (ctx, next) => {
  const telegramId = ctx.from?.id.toString();
  const user = await User.findOne({ telegramId });
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
  const isAdm = adminIds.includes(telegramId || '');
  // â”€â”€ PHOTO GUARD â”€â”€
  if (!isAdm && !user?.supportSessionActive) {
    const dbUser = await User.findOne({ telegramId: ctx.from?.id.toString() });
    const hasActiveFlow =
      ctx.session?.awaitingFilterAction ||
      ctx.session?.pendingFile ||
      ctx.session?.pendingConversionFileId ||
      ctx.session?.awaitingCustomWidth ||
      ctx.session?.awaitingCustomHeight ||
      dbUser?.awaitingFilterImage ||
      dbUser?.awaitingNanoBananaImage ||
      dbUser?.awaitingAutoEraserImage ||
      dbUser?.awaitingCustomEraserImage ||
      dbUser?.awaitingFormatConversion ||
      (dbUser?.proEnhanceSettings as any)?.isAwaitingImage;

    if (!hasActiveFlow) {
      await ctx.reply(
        'âڑ ï¸ڈ <b>ظٹط±ط¬ظ‰ ط§ط®طھظٹط§ط± ط§ظ„ط®ط¯ظ…ط© ط£ظˆظ„ط§ظ‹!</b>\n\n' +
        'ظ„ط§ ظٹظ…ظƒظ† ط¥ط±ط³ط§ظ„ ط§ظ„طµظˆط± ظ…ط¨ط§ط´ط±ط©.\n' +
        'ط§ط®طھط± ط¥ط­ط¯ظ‰ ط§ظ„ط®ط¯ظ…ط§طھ ظ…ظ† ط§ظ„ظ‚ط§ط¦ظ…ط© ط§ظ„ط±ط¦ظٹط³ظٹط© ط£ظˆظ„ط§ظ‹ ًں‘†',
        { parse_mode: 'HTML' }
      );
      return;
    }
  }
  // â”€â”€ END GUARD â”€â”€



  // 1. Admin -> User (Confirm media sending)
  if (isAdm) {
    const activeUser = await User.findOne({
      supportSessionActive: true,
      supportSessionAdminId: telegramId
    });

    if (activeUser) {
      await ctx.reply(
        `ًں“¤ <b>ظ‡ظ„ طھط±ظٹط¯ ط¥ط±ط³ط§ظ„ ظ‡ط°ط§ ط§ظ„ظ…ظ„ظپ/ط§ظ„طµظˆط±ط© ظ„ظ„ط¹ظ…ظٹظ„طں</b>\n\n` +
        `ًں‘¤ <b>ظ…ط¹ط±ظپ ط§ظ„ط¹ظ…ظٹظ„:</b> <code>${activeUser.telegramId}</code>`,
        {
          parse_mode: 'HTML',
          reply_parameters: { message_id: ctx.message!.message_id },
          reply_markup: {
            inline_keyboard: [[
              // @ts-ignore
              { text: 'âœ… ظ†ط¹ظ…طŒ ط£ط±ط³ظ„ ط§ظ„ظ…ظ„ظپ', callback_data: `confirm_support_send_${activeUser.telegramId}`, style: 'success' as const },
              { text: 'â‌Œ ظ„ط§طŒ ط¥ظ„ط؛ط§ط،', callback_data: 'cancel_support_send', style: 'danger' as const }
            ]]
          }
        }
      );
      return; // Stop processing, do not send to imageHandler
    }
  }

  // â”€â”€ Report interceptor for photos and documents â”€â”€
  if (user?.awaitingReport) {
    await User.findOneAndUpdate({ telegramId }, { $set: { awaitingReport: false } });

    const messageId = ctx.message?.message_id;
    const chatId = ctx.chat?.id;

    if (messageId && chatId) {
      await ctx.reply(
        'ًں“¤ <b>ظ‡ظ„ طھط±ظٹط¯ ظ…ط´ط§ط±ظƒط© ظ‡ط°ط§ ط§ظ„ط¨ظ„ط§ط؛ ظ…ط¹ ظ…ط·ظˆط± ط§ظ„ط¨ظˆطھطں</b>\n\n' +
        'ط³ظٹطھظ… ط¥ط±ط³ط§ظ„ ط±ط³ط§ظ„طھظƒ ظ„ظ„ظ…ط·ظˆط± ظ…ط¨ط§ط´ط±ط© ظˆط³ظٹطھظ… ط§ظ„ط±ط¯ ط¹ظ„ظٹظƒ ظپظٹ ط£ظ‚ط±ط¨ ظˆظ‚طھ ًں’™',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                // @ts-ignore
                { text: 'âœ… ظ†ط¹ظ…طŒ ط£ط±ط³ظ„ ط§ظ„ط¨ظ„ط§ط؛', callback_data: `confirm_report_${chatId}_${messageId}`, style: 'success' as const },
                { text: 'â‌Œ ظ„ط§طŒ ط¥ظ„ط؛ط§ط،', callback_data: 'cancel_report_confirm', style: 'danger' as const },
              ],
            ],
          },
        }
      );
      return; // STOP â€” do not pass to imageHandler
    }
  }

  // 2. User -> Admin (Direct forward)
  if (user?.supportSessionActive && user.supportSessionAdminId) {
    try {
      const firstName = ctx.from?.first_name || 'ظ…ط¬ظ‡ظˆظ„';
      await ctx.api.sendMessage(
        user.supportSessionAdminId,
        `ًں’¬ <b>ظ…ظ„ظپ ظ…ظ† ط§ظ„ط¹ظ…ظٹظ„ (${firstName} | <code>${telegramId}</code>):</b>`,
        { parse_mode: 'HTML' }
      );
      await ctx.forwardMessage(user.supportSessionAdminId);
    } catch (e) {
      console.error('[SupportTunnel] Userâ†’Admin media error:', e);
    }
    return; // Stop processing, do not send to imageHandler
  }

  // If no support session is active, pass media to the image processing AI
  return next();
});

// â”€â”€â”€ Image & Callback Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

imageBot.on([':photo', ':document'], imageHandler);
// â”€â”€â”€ Filter button callbacks (TASK 2) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

imageBot.callbackQuery('filter_face', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.activeFilter = 'face';
  await ctx.reply(
    'ًں‘¤ <b>ظپظ„طھط± طھطµظپظٹط© ط§ظ„ظˆط¬ظ‡</b>\n\nط£ط±ط³ظ„ ط§ظ„طµظˆط±ط© ط§ظ„ط¢ظ† ظˆط³ظٹطھظ… طھط­ط³ظٹظ† ط§ظ„ظ…ظ„ط§ظ…ط­ طھظ„ظ‚ط§ط¦ظٹط§ظ‹:',
    { parse_mode: 'HTML' }
  );
});

imageBot.callbackQuery('filter_color', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.activeFilter = 'color';
  await ctx.reply(
    'ًںژ¨ <b>ظپظ„طھط± طھظ„ظˆظٹظ† ط§ظ„طµظˆط± ط§ظ„ظ‚ط¯ظٹظ…ط©</b>\n\nط£ط±ط³ظ„ طµظˆط±طھظƒ ط§ظ„ط£ط¨ظٹط¶ ظˆط§ظ„ط£ط³ظˆط¯ ظˆط³ظٹطھظ… طھظ„ظˆظٹظ†ظ‡ط§:',
    { parse_mode: 'HTML' }
  );
});

imageBot.callbackQuery('filter_anime', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.activeFilter = 'anime';
  await ctx.reply(
    'ًںŒ¸ <b>ظپظ„طھط± طھط­ظˆظٹظ„ ط£ظ†ظ…ظٹ</b>\n\nط£ط±ط³ظ„ طµظˆط±طھظƒ ظˆط³ظٹطھظ… طھط­ظˆظٹظ„ظ‡ط§ ظ„ط£ظ†ظ…ظٹ ط§ط­طھط±ط§ظپظٹ:',
    { parse_mode: 'HTML' }
  );
});

imageBot.callbackQuery('filter_ghibli', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.activeFilter = 'ghibli';
  await ctx.reply(
    'ًںژ­ <b>ظپظ„طھط± طھط£ط«ظٹط± ط¬ظٹط¨ظ„ظٹ</b>\n\nط£ط±ط³ظ„ طµظˆط±طھظƒ ظˆط³ظٹطھظ… طھط·ط¨ظٹظ‚ طھط£ط«ظٹط± ط¬ظٹط¨ظ„ظٹ ط§ظ„ظپظ†ظٹ:',
    { parse_mode: 'HTML' }
  );
});

imageBot.callbackQuery('cancel_filter', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.activeFilter = undefined;
  await ctx.deleteMessage().catch(() => { });
});

imageBot.callbackQuery(/.*/, callbackHandler);

// â”€â”€â”€ chat_member: Leave / Kick Penalty + Force-Sub Clawback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

imageBot.on('chat_member', async (ctx) => {
  const update = ctx.update.chat_member;
  if (!update) return;

  const newStatus = update.new_chat_member.status;
  const oldStatus = update.old_chat_member.status;
  const userId = update.new_chat_member.user.id;
  const channelId = String(update.chat.id);

  // â”€â”€ Existing fund-campaign penalty â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const wasActive = ['member', 'administrator', 'creator'].includes(oldStatus);
  const hasLeft = ['left', 'kicked', 'restricted'].includes(newStatus);

  if (wasActive && hasLeft) {
    const { handleMemberLeft } = await import('./services/channelFundService');
    await handleMemberLeft(userId, channelId, ctx.api);
  }

  // â”€â”€ Referral Clawback: DISABLED â€” users no longer lose points when referred friends leave â”€â”€
  // try {
  //   if (newStatus !== 'left' && newStatus !== 'kicked') return;
  //
  //   const isForceSubChannel = await ForceSubChannel.findOne({ channelId });
  //   if (!isForceSubChannel) return;
  //
  //   const fleeingUser = await User.findOne({ telegramId: userId });
  //
  //   if (fleeingUser?.referredBy != null && fleeingUser.referralRewardClaimed === true) {
  //     const REFERRAL_REWARD = 5;
  //     await User.findOneAndUpdate({ telegramId: fleeingUser.referredBy }, { $inc: { dailyQuota: -REFERRAL_REWARD } });
  //     await User.findOneAndUpdate({ telegramId: userId }, { $set: { referralRewardClaimed: false } });
  //     // penalty sendMessage suppressed
  //   }
  // } catch (err) {
  //   console.error('[Clawback chat_member]', err);
  // }
});

// â”€â”€â”€ my_chat_member: Referral Clawback â€” DISABLED â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Referrers will NOT lose points when an invited user blocks the bot.
// The positive referral reward (+5 pts in start.ts) remains fully active.
imageBot.on('my_chat_member', async (_ctx) => {
  // Clawback disabled â€” no action taken.
});

// â”€â”€â”€ imageBot Error Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

imageBot.catch((err) => {
  const ctx = err.ctx;
  console.error(`[ImageBot Error] Update ${ctx.update.update_id}:`, err.error);
});

// â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
// DOC BOT â€” MIDDLEWARE STACK
// â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ

// 1. Rate limiting
docBot.use(rateLimitMiddleware(2000, docBotRateMap));

// 2. Session â€” isolated key: doc_<userId>
docBot.use(session({
  initial: (): SessionData => ({ documentLines: [] }),
  getSessionKey: (ctx) => ctx.from ? `doc_${ctx.from.id}` : undefined,
}));

// 3. Maintenance / ban middleware
docBot.use(async (ctx: BotContext, next: NextFunction): Promise<void> => {
  cleanupDocTransientState();
  const userId = ctx.from?.id;
  if (!userId) return next();
  try {
    const user = await User.findOne({ telegramId: userId });
    if (user?.isBanned) {
      const msg = 'ًںڑ« ط£ظ†طھ ظ…ط­ط¸ظˆط± ظ…ظ† ط§ط³طھط®ط¯ط§ظ… ط§ظ„ط¨ظˆطھ.';
      if (ctx.callbackQuery) { void ctx.answerCallbackQuery({ text: msg, show_alert: true }).catch(() => { }); return; }
      await ctx.reply(msg); return;
    }
    if (docBotLocked && !isAdmin(userId)) {
      const msg = 'ًں”§ ط¨ظˆطھ طµط§ظ†ط¹ ط§ظ„ظ…ط³طھظ†ط¯ط§طھ طھط­طھ ط§ظ„طµظٹط§ظ†ط© ط­ط§ظ„ظٹط§ظ‹. ط³ظ†ط¹ظˆط¯ ظ‚ط±ظٹط¨ط§ظ‹!';
      if (ctx.callbackQuery) { void ctx.answerCallbackQuery({ text: msg, show_alert: true }).catch(() => { }); return; }
      await ctx.reply(msg); return;
    }
    if (user) {
      await User.updateOne({ telegramId: userId }, { $set: { lastSeen: new Date() } });
    }
  } catch (err: unknown) { console.error('[DocBot Auth] Middleware error:', err); }
  await next();
});

// â”€â”€â”€ docBot: /start command â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

docBot.command('start', withDocBotHandler('start_command', async (ctx) => {
  if (!ctx.from) return;
  const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
  const points = user?.dailyQuota ?? 0;
  const firstName = ctx.from?.first_name ?? 'ظ…ط³طھط®ط¯ظ…';

  const welcomeCaption = `ظ…ط±ط­ط¨ط§ظ‹ ${firstName}! ًں‘‹\n\nط£ظ†ط§ ط¨ظˆطھ طµط§ظ†ط¹ ط§ظ„ظ…ط³طھظ†ط¯ط§طھ ط§ظ„ط§ط­طھط±ط§ظپظٹ ًں“‌\nظٹظ…ظƒظ†ظƒ ط¥ظ†ط´ط§ط، ظ…ط³طھظ†ط¯ط§طھ PDF ط§ط­طھط±ط§ظپظٹط© ط¨ط³ظ‡ظˆظ„ط© طھط§ظ…ط©.\n\nًں’° ط±طµظٹط¯ظƒ ط§ظ„ط­ط§ظ„ظٹ: ${points} ظ†ظ‚ط·ط©\n\nط§ط¶ط؛ط· ط§ظ„ط²ط± ط¨ط§ظ„ط£ط³ظپظ„ ظ„ظ„ط¨ط¯ط،:`;
  const welcomeReplyMarkup = {
    inline_keyboard: [
      [
        {
          text: 'ًں“‌ ط§ظ„ط¯ط®ظˆظ„ ظ„طµط§ظ†ط¹ ط§ظ„ظ…ط³طھظ†ط¯ط§طھ',
          callback_data: 'start_doc_maker',
          // @ts-ignore
          style: 'primary' as const
        }
      ],
      [
        {
          text: 'ًں¤– NizoAI PDF',
          callback_data: 'start_premium_ai',
          // @ts-ignore
          style: 'primary' as const
        },
        {
          text: 'ًں†“ Ai Free PDF',
          callback_data: 'start_free_ai',
          // @ts-ignore
          style: 'primary' as const
        }
      ],
      [
        {
          text: 'ًں“‘ PRO ًں‘‘',
          callback_data: 'start_template_pdf',
          // @ts-ignore
          style: 'primary' as const
        }
      ],
      [
        {
          text: 'ًںڑ¨ ط¥ط¨ظ„ط§ط؛ ط§ظ„ظ…ط·ظˆط±',
          callback_data: 'doc_report_dev',
          // @ts-ignore
          style: 'danger' as const
        }
      ]
    ]
  } as any;

  const welcomeImagePath = path.join(process.cwd(), 'assets', 'welcome.jpg');
  await safeReplyWithPhoto(ctx, welcomeImagePath, {
    caption: welcomeCaption,
    parse_mode: 'HTML',
    reply_markup: welcomeReplyMarkup as any
  });
}));

const handleDocReportDev = async (ctx: BotContext): Promise<void> => {
  if (ctx.session) ctx.session.docAwaitingReport = true;
  await ctx.reply("ًںڑ¨ <b>ط¥ط¨ظ„ط§ط؛ ط§ظ„ظ…ط·ظˆط±:</b>\n\nط£ط±ط³ظ„ ط±ط³ط§ظ„طھظƒطŒ ظ…ط´ظƒظ„طھظƒطŒ ط£ظˆ ط§ظ‚طھط±ط§ط­ظƒ ط§ظ„ط¢ظ† ظپظٹ ط±ط³ط§ظ„ط© ظˆط§ط­ط¯ط©طŒ ظˆط³ظٹطھظ… ط¥ظٹطµط§ظ„ظ‡ط§ ظ„ظ„ظ…ط·ظˆط± ظ…ط¨ط§ط´ط±ط©.", { parse_mode: 'HTML' });
};
registerDocCallback('doc_report_dev', 'doc_report_dev', handleDocReportDev);
registerDocCallback('report_to_dev', 'report_to_dev', handleDocReportDev);

docBot.command('admin', withDocBotHandler('admin_command', async (ctx) => {
  if (!ctx.from) return;
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
  if (!adminIds.includes(ctx.from.id.toString())) return;

  await ctx.reply(
    `ًں”§ <b>ظ„ظˆط­ط© طھط­ظƒظ… ط§ظ„ظ…ط´ط±ظپ</b>\n\nط­ط§ظ„ط© ط§ظ„ط¨ظˆطھ: ${docBotLocked ? 'ًں”’ ظ…ظ‚ظپظˆظ„' : 'ًں”“ ظ…ظپطھظˆط­'}`,
    {
      parse_mode: 'HTML',
      reply_markup: getDocAdminKeyboard()
    }
  );
}));

// â”€â”€â”€ docBot: Admin panel callbacks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

registerDocCallback('doc_admin_toggle_welcome', 'doc_admin_toggle_welcome', async (ctx) => {
  if (ctx.from?.id !== Number(process.env.ADMIN_ID)) return;
  docWelcomeLocked = !docWelcomeLocked;
  await ctx.answerCallbackQuery(docWelcomeLocked ? 'ًں”’ طھظ… ظ‚ظپظ„ ط§ظ„ط£ط²ط±ط§ط±' : 'ًں”“ طھظ… ظپطھط­ ط§ظ„ط£ط²ط±ط§ط±');
  await ctx.editMessageText(
    `ًں”§ <b>ظ„ظˆط­ط© طھط­ظƒظ… ط§ظ„ظ…ط´ط±ظپ</b>\n\nط­ط§ظ„ط© ط§ظ„ط¨ظˆطھ: ${docBotLocked ? 'ًں”’ ظ…ظ‚ظپظˆظ„' : 'ًں”“ ظ…ظپطھظˆط­'}`,
    { parse_mode: 'HTML', reply_markup: getDocAdminKeyboard() }
  ).catch((error: unknown) => logDocBotError('[DocBot:doc_admin_toggle_welcome] editMessageText failed:', error));
});

registerDocCallback('doc_admin_lock', 'doc_admin_lock', async (ctx) => {
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  docBotLocked = !docBotLocked;
  await ctx.editMessageText(
    `ًں”§ <b>ظ„ظˆط­ط© طھط­ظƒظ… ط§ظ„ظ…ط´ط±ظپ</b>\n\nط­ط§ظ„ط© ط§ظ„ط¨ظˆطھ: ${docBotLocked ? 'ًں”’ ظ…ظ‚ظپظˆظ„' : 'ًں”“ ظ…ظپطھظˆط­'}`,
    { parse_mode: 'HTML', reply_markup: getDocAdminKeyboard() }
  ).catch((error: unknown) => logDocBotError('[DocBot:doc_admin_lock] editMessageText failed:', error));
});

registerDocCallback('doc_admin_stats', 'doc_admin_stats', async (ctx) => {
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  const totalUsers = await User.countDocuments();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const activeToday = await User.countDocuments({ lastSeen: { $gte: today } });
  await ctx.reply(
    `ًں“ٹ <b>ط¥ط­طµط§ط¦ظٹط§طھ ط¨ظˆطھ طµط§ظ†ط¹ ط§ظ„ظ…ط³طھظ†ط¯ط§طھ</b>\n\n` +
    `ًں‘¥ ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…ط³طھط®ط¯ظ…ظٹظ†: <b>${totalUsers}</b>\n` +
    `âڑ، ظ†ط´ط·ظˆظ† ط§ظ„ظٹظˆظ…: <b>${activeToday}</b>\n` +
    `ًں”’ ط­ط§ظ„ط© ط§ظ„ط¨ظˆطھ: ${docBotLocked ? 'ظ…ظ‚ظپظˆظ„' : 'ظ…ظپطھظˆط­'}`,
    { parse_mode: 'HTML' }
  );
});

registerDocCallback('doc_admin_users', 'doc_admin_users', async (ctx) => {
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  setDocAdminState(ctx.from.id, 'awaiting_user_id');
  await ctx.reply('ًں‘¤ ط£ط±ط³ظ„ ظ…ط¹ط±ظپ ط§ظ„ط¹ظ…ظٹظ„ (Telegram ID):');
});

registerDocCallback('doc_admin_points', 'doc_admin_points', async (ctx) => {
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  setDocAdminState(ctx.from.id, 'awaiting_points');
  await ctx.reply('ًں’° ط£ط±ط³ظ„ [ظ…ط¹ط±ظپ ط§ظ„ط¹ظ…ظٹظ„] [ط¹ط¯ط¯ ط§ظ„ظ†ظ‚ط§ط·] (ظ…ط«ط§ظ„: 123456789 10):');
});

registerDocCallback('doc_admin_unlock_documents', 'doc_admin_unlock_documents', async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => { });
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  setDocAdminState(ctx.from.id, 'awaiting_doc_page_unlock');
  await ctx.reply('ط£ط±ط³ظ„ userId ط§ظ„ط®ط§طµ ط¨ط§ظ„ظ…ط³طھط®ط¯ظ…');
});

registerDocCallback('doc_admin_broadcast', 'doc_admin_broadcast', async (ctx) => {
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  setDocAdminState(ctx.from.id, 'awaiting_broadcast');
  await ctx.reply('ًں“¢ ط£ط±ط³ظ„ ظ†طµ ط§ظ„ط¥ط´ط¹ط§ط± ط§ظ„ط¬ظ…ط§ط¹ظٹ:');
});

// â”€â”€â”€ docBot: Welcome Buttons Interceptor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

docBot.callbackQuery('start_doc_maker', async (ctx, next) => {
  const adminId = Number(process.env.ADMIN_ID);
  if (docWelcomeLocked && ctx.from?.id !== adminId) {
    await ctx.answerCallbackQuery({ text: 'ًں› ï¸ڈ ظ‡ط°ظ‡ ط§ظ„ط®ط¯ظ…ط© ظ…ط؛ظ„ظ‚ط© ظ…ط¤ظ‚طھط§ظ‹ ظ„ظ„طµظٹط§ظ†ط©', show_alert: true });
    return;
  }
  return next();
});

// â”€â”€â”€ docBot: Edit Workflow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
registerDocCallback('edit_pdf_doc', 'edit_pdf_doc', handleEditPdfDocCallback);

// â”€â”€â”€ docBot: Copy Generated Text â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
registerDocCallback('copy_generated_text', 'copy_generated_text', async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => {});
  const text = ctx.session?.lastAiGeneratedText || ctx.session?.lastGeneratedDoc?.text;
  if (!text) {
    await ctx.reply('â‌Œ ط§ظ„ظ†طµ ط؛ظٹط± ظ…طھط§ط­طŒ ظٹط±ط¬ظ‰ ط¥ط¹ط§ط¯ط© ط¥ظ†ط´ط§ط، ط§ظ„ظ…ط³طھظ†ط¯.');
    return;
  }
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  await ctx.reply(`<pre>${escaped}</pre>`, { parse_mode: 'HTML' });
});

// â”€â”€â”€ docBot: Free AI Flow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

registerDocCallback('start_free_ai', 'start_free_ai', async (ctx) => {
  const adminId = Number(process.env.ADMIN_ID);
  if (docWelcomeLocked && ctx.from?.id !== adminId) {
    await ctx.answerCallbackQuery({ text: 'ًں› ï¸ڈ ظ‡ط°ظ‡ ط§ظ„ط®ط¯ظ…ط© ظ…ط؛ظ„ظ‚ط© ظ…ط¤ظ‚طھط§ظ‹ ظ„ظ„طµظٹط§ظ†ط©', show_alert: true });
    return;
  }

  // TASK 3: Show mode selection before existing flow
  await ctx.answerCallbackQuery().catch(() => { });
  await ctx.reply(
    'ًں†“ Ai Free PDF â€” ط§ط®طھط± ط§ظ„ظ†ظˆط¹:\n\n' +
    '1ï¸ڈâƒ£ طھظ„ظ‚ط§ط¦ظٹ â€” ط§ظ„ط¨ظˆطھ ظٹظˆظ„ظ‘ط¯ ط§ظ„ظ…ط³طھظ†ط¯ ظپظˆط±ط§ظ‹ ط¨ط¯ظˆظ† طµظˆط± ظ…ط®طµطµط©\n' +
    '2ï¸ڈâƒ£ ط§ط­طھط±ط§ظپظٹ âœ¨ â€” ط£ظ†طھ طھط±ظپط¹ طµظˆط±ظƒ ظˆطھطھط­ظƒظ… ط¨ظƒظ„ طµظپط­ط©\n' +
    '(ط§ظ„ظ†ط³ط®ط© ط§ظ„ط§ط­طھط±ط§ظپظٹط© ظ…طھط§ط­ط© ظ…ط±ط© ظˆط§ط­ط¯ط© ظپظ‚ط· ظ…ط¬ط§ظ†ط§ظ‹)',
    {
      reply_markup: {
        inline_keyboard: [
          // @ts-ignore
          [{ text: 'âœڈï¸ڈ طھظ„ظ‚ط§ط¦ظٹ', callback_data: 'free_pdf_auto', style: 'primary' }],
          // @ts-ignore
          [{ text: 'ًں–¼âœڈï¸ڈ ط§ط­طھط±ط§ظپظٹ', callback_data: 'free_pdf_pro', style: 'primary' }],
          // @ts-ignore
          [{ text: 'ط¥ظ„ط؛ط§ط، â‌Œ', callback_data: 'cancel', style: 'danger' }],
        ],
      },
    }
  );
});

// أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬ free_pdf_auto: run EXISTING free PDF flow unchanged أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬

registerDocCallback('free_pdf_auto', 'free_pdf_auto', async (ctx) => {
  const adminId = Number(process.env.ADMIN_ID);
  if (docWelcomeLocked && ctx.from?.id !== adminId) {
    await ctx.answerCallbackQuery({ text: 'ًں› ï¸ڈ ظ‡ط°ظ‡ ط§ظ„ط®ط¯ظ…ط© ظ…ط؛ظ„ظ‚ط© ظ…ط¤ظ‚طھط§ظ‹ ظ„ظ„طµظٹط§ظ†ط©', show_alert: true });
    return;
  }

  const userId = ctx.from?.id;
  if (!userId) return;
  const user = await User.findOne({ telegramId: userId });
  if (!user) return;

  await checkAndResetDailyFree(user);
  if (user.freePdfsGeneratedToday >= 2) {
    await ctx.answerCallbackQuery({
      text: "ط§ط³طھظ†ظپط¯طھ ظ…ط­ط§ظˆظ„ط§طھظƒ ط§ظ„ظ…ط¬ط§ظ†ظٹط© (2) ط§ظ„ظٹظˆظ…! ًںڑ«\nط§ط³طھط®ط¯ظ… ط²ط± [ NizoAI PDF ] ط§ظ„ظ…ط¬ط§ظˆط± ط¨ط£ط³ط¹ط§ط± ط±ظ…ط²ظٹط© ًںڑ€",
      show_alert: true
    });
    return;
  }

  ctx.session.awaitingFreeAiTopic = true;
  await ctx.reply('ًں†“ ط£ط±ط³ظ„ ظ„ظٹ ط§ظ„ظ…ظˆط¶ظˆط¹ ط§ظ„ط°ظٹ طھط±ظٹط¯ ظƒطھط§ط¨طھظ‡ ظˆط³ط£ظ†ط´ط¦ ظ„ظƒ ظ…ط³طھظ†ط¯ط§ظ‹ ظ…ط¬ط§ظ†ط§ظ‹:', {
    reply_markup: {
      inline_keyboard: [[
        // @ts-ignore
        { text: 'â‌Œ ط¥ظ„ط؛ط§ط،', callback_data: 'cancel', style: 'danger' as const }
      ]]
    }
  });
});

// â”€â”€â”€ docBot: Image-to-Styled-PDF Workflow (New) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// â”€â”€â”€ docBot: Template-Style PDF Workflow (New Enterprise) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= maxRetries) throw err;
      await wait(1000 * Math.pow(2, attempt)); // Exponential backoff: 2s, 4s, etc.
    }
  }
  throw new Error('Max retries reached');
}

// FIX 4: PRO ًں‘‘ â€” Admin-only gate for the template workflow
registerDocCallback('start_template_pdf', 'start_template_pdf', async (ctx) => {
  const adminId = Number(process.env.ADMIN_ID);
  if (docWelcomeLocked && ctx.from?.id !== adminId) {
    await ctx.answerCallbackQuery({ text: 'ًں› ï¸ڈ ظ‡ط°ظ‡ ط§ظ„ط®ط¯ظ…ط© ظ…ط؛ظ„ظ‚ط© ظ…ط¤ظ‚طھط§ظ‹ ظ„ظ„طµظٹط§ظ†ط©', show_alert: true });
    return;
  }

  const adminEnvId = process.env.ADMIN_TELEGRAM_ID || process.env.ADMIN_IDS?.split(',')[0]?.trim();
  if (String(ctx.from?.id) !== String(adminEnvId)) {
    await ctx.reply('ًں”’ ط¹ط°ط±ط§ظ‹طŒ ظ‡ط°ط§ ط§ظ„ظ‚ط³ظ… ظ…ط®طµطµ ظ„ظ„ط¥ط¯ط§ط±ط© ظپظ‚ط·.');
    return;
  }
  // Admin-only: show PRO style picker
  await ctx.reply(
    `ًں‘‘ <b>PRO â€” ط§ط®طھط± ظ‚ط§ظ„ط¨ ط§ظ„طھطµظ…ظٹظ…:</b>`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            // @ts-ignore
            { text: 'ط¬ط¯ط§ظˆظ„ ظˆط¨ظٹط§ظ†ط§طھ', callback_data: 'tpl_select_tables', style: 'primary' as const },
            // @ts-ignore
            { text: 'طھظ‚ط±ظٹط± ط§ط­طھط±ط§ظپظٹ', callback_data: 'tpl_select_report', style: 'primary' as const }
          ],
          [
            // @ts-ignore
            { text: 'ط®ط·ط§ط¨ ط±ط³ظ…ظٹ', callback_data: 'tpl_select_formal', style: 'primary' as const },
            // @ts-ignore
            { text: 'طھطµظ…ظٹظ… ط¥ط¨ط¯ط§ط¹ظٹ', callback_data: 'tpl_select_creative', style: 'primary' as const }
          ],
          [
            // @ts-ignore
            { text: 'ط¨ط³ظٹط· ظˆط£ظ†ظٹظ‚', callback_data: 'tpl_select_minimal', style: 'primary' as const },
            // @ts-ignore
            { text: 'ظ‚ط§ظ„ط¨ ط£ظƒط§ط¯ظٹظ…ظٹ', callback_data: 'tpl_select_academic', style: 'primary' as const }
          ],
          [
            // @ts-ignore
            { text: 'ط¥ظ„ط؛ط§ط، â‌Œ', callback_data: 'tpl_cancel', style: 'danger' as const }
          ]
        ]
      }
    }
  );
});

// FIX 3: NizoAI PDF â†’ shows style selection first, THEN feeds into existing pages_ + points system

const TPL_STYLES = ['tables', 'report', 'formal', 'creative', 'minimal'];

TPL_STYLES.forEach(style => {
  registerDocCallback(`tpl_select_${style}`, `tpl_select_${style}`, async (ctx) => {
    ctx.session.templateWorkflowState = 'collecting_text';
    ctx.session.selectedStyle = style as any;
    ctx.session.textBuffer = [];
    ctx.session.combinedText = '';
    ctx.session.isGenerating = false;
    ctx.session.startedAt = Date.now();
    ctx.session.lastActivityAt = Date.now();

    await ctx.editMessageText(
      `âœ… طھظ… ط§ط®طھظٹط§ط± ط§ظ„ظ‚ط§ظ„ط¨: <b>${style.toUpperCase()}</b>\n\n` +
      `ًں“‌ ط§ظ„ط¢ظ†طŒ ظ‚ظ… ط¨ط¥ط±ط³ط§ظ„ ط§ظ„ظ…ط­طھظˆظ‰ ط§ظ„ظ†طµظٹ ط§ظ„ط®ط§طµ ط¨ظƒ (ظٹظ…ظƒظ†ظƒ ط¥ط±ط³ط§ظ„ظ‡ ط¹ظ„ظ‰ ط´ظƒظ„ ط±ط³ط§ط¦ظ„ ظ…طھط¹ط¯ط¯ط©).\n\n` +
      `âڑ ï¸ڈ <b>ظ…ظ„ط§ط­ط¸ط§طھ ظ‡ط§ظ…ط©:</b>\n` +
      `- ط£ظ‚طµظ‰ ط¹ط¯ط¯ ظ„ظ„ط±ط³ط§ط¦ظ„: 50\n` +
      `- ط£ظ‚طµظ‰ ط¹ط¯ط¯ ظ„ظ„ط£ط­ط±ظپ: 120,000\n` +
      `- ط³ظٹطھظ… ط±ظپط¶ ط£ظٹ طµظˆط± ط£ظˆ ظ…ظ„طµظ‚ط§طھ ط£ظˆ ظˆط³ط§ط¦ط· ط£ط®ط±ظ‰.\n\n` +
      `ط¹ظ†ط¯ظ…ط§ طھظ†طھظ‡ظٹ ظ…ظ† ط¥ط±ط³ط§ظ„ ط§ظ„ظ†طµطŒ ط§ط¶ط؛ط· ط¹ظ„ظ‰ ط²ط± "âœ… Done" ط¨ط§ظ„ط£ط³ظپظ„.`,
      { parse_mode: 'HTML' }
    );
  });
});

docBot.on('message', withDocBotHandler('template_workflow_collection', async (ctx, next) => {
  if (ctx.session.templateWorkflowState === 'collecting_text') {
    ctx.session.lastActivityAt = Date.now();

    // Non-text media protection
    if (!ctx.message?.text) {
      await ctx.reply('âڑ ï¸ڈ ط¹ط°ط±ط§ظ‹طŒ ظ„ط§ ظٹظ…ظƒظ† ط§ط³طھظ‚ط¨ط§ظ„ ط§ظ„طµظˆط± ط£ظˆ ط§ظ„ظ…ظ„طµظ‚ط§طھ ط£ظˆ ط§ظ„ظˆط³ط§ط¦ط· ظپظٹ ظ‡ط°ظ‡ ط§ظ„ظ…ط±ط­ظ„ط©. ط£ط±ط³ظ„ ظ†طµظˆطµط§ظ‹ ظپظ‚ط·.', {
        reply_markup: { inline_keyboard: [[{ text: 'ط¥ظ„ط؛ط§ط، â‌Œ', callback_data: 'tpl_cancel', style: 'danger' as const }]] }
      });
      return;
    }

    const text = ctx.message.text.trim();
    if (!text) return;

    // Buffer limit checks
    const buffer = ctx.session.textBuffer || [];
    const startedAt = ctx.session.startedAt || Date.now();
    const timeElapsedMins = (Date.now() - startedAt) / (1000 * 60);
    const totalChars = buffer.reduce((acc, str) => acc + str.length, 0) + text.length;

    if (buffer.length >= 50 || totalChars >= 120000 || timeElapsedMins >= 20) {
      ctx.session.templateWorkflowState = 'idle';
      ctx.session.textBuffer = [];
      await ctx.reply('â‌Œ طھظ… طھط¬ط§ظˆط² ط§ظ„ط­ط¯ ط§ظ„ظ…ط³ظ…ظˆط­ ط¨ظ‡ (50 ط±ط³ط§ظ„ط© ط£ظˆ 120,000 ط­ط±ظپ ط£ظˆ 20 ط¯ظ‚ظٹظ‚ط©). طھظ… ط¥ظ„ط؛ط§ط، ط§ظ„ط¹ظ…ظ„ظٹط© ظ„ط­ظ…ط§ظٹط© ط§ظ„ظ†ط¸ط§ظ….');
      return;
    }

    buffer.push(text);
    ctx.session.textBuffer = buffer;

    await ctx.reply(
      `âœ… طھظ… ط­ظپط¸ ط§ظ„ط±ط³ط§ظ„ط© (${buffer.length}/50)\n` +
      `ط£ط±ط³ظ„ ط§ظ„ظ…ط²ظٹط¯ ط£ظˆ ط§ط¶ط؛ط· Done ظ„ظ„ط¥ظ†ظ‡ط§ط،.`,
      {
        reply_markup: new InlineKeyboard()
          .text('âœ… Done â€” Finish & Generate', 'tpl_finish_collection')
      }
    );
    return;
  }
  return next();
}));

registerDocCallback('tpl_finish_collection', 'tpl_finish_collection', async (ctx) => {
  if (ctx.session.templateWorkflowState !== 'collecting_text') {
    await ctx.answerCallbackQuery({ text: 'âڑ ï¸ڈ ط§ظ„ط¬ظ„ط³ط© ظ…ظ†طھظ‡ظٹط© ط£ظˆ ط؛ظٹط± طµط§ظ„ط­ط©.' });
    return;
  }

  if (ctx.session.isGenerating) {
    await ctx.answerCallbackQuery({ text: 'âڈ³ ظٹط±ط¬ظ‰ ط§ظ„ط§ظ†طھط¸ط§ط±طŒ ط¬ط§ط±ظٹ ط§ظ„ظ…ط¹ط§ظ„ط¬ط© ط¨ط§ظ„ظپط¹ظ„...' });
    return;
  }

  ctx.session.isGenerating = true;
  ctx.session.combinedText = (ctx.session.textBuffer || []).join('\n\n');

  if (!ctx.session.combinedText.trim()) {
    ctx.session.isGenerating = false;
    await ctx.answerCallbackQuery({ text: 'âڑ ï¸ڈ ظ„ظ… طھظ‚ظ… ط¨ط¥ط±ط³ط§ظ„ ط£ظٹ ظ†طµ!', show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();
  ctx.session.templateWorkflowState = 'waiting_for_pages';

  // Using the same layout estimation from the previous logic to ask for pages
  const totalWords = ctx.session.combinedText.split(/\s+/).length;
  const estimatedPages = Math.ceil(totalWords / 250);

  await ctx.editMessageText(
    `âœ… طھظ… ط§ط³طھظ„ط§ظ… ط¬ظ…ظٹط¹ ط§ظ„ظ†طµظˆطµ ط¨ظ†ط¬ط§ط­.\n\n` +
    `ًں“‌ ط¹ط¯ط¯ ط§ظ„ظƒظ„ظ…ط§طھ: ${totalWords}\n` +
    `ًں“„ ط¹ط¯ط¯ ط§ظ„طµظپط­ط§طھ ط§ظ„ظ…طھظˆظ‚ط¹: ${estimatedPages}\n\n` +
    `ط§ط®طھط± ط¹ط¯ط¯ ط§ظ„طµظپط­ط§طھ ط§ظ„ظ…ط³طھظ‡ط¯ظپ:`,
    {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard()
        .text('ًں“„ طµظپط­ط© 1', 'tpl_pages_1').row()
        .text('ًں“„ طµظپط­طھظٹظ†', 'tpl_pages_2').row()
        .text('ًں“„ 3 طµظپط­ط§طھ', 'tpl_pages_3').row()
        .text('ًں“„ 4 طµظپط­ط§طھ', 'tpl_pages_4').row()
        .text('ًں¤– طھط­ط¯ظٹط¯ طھظ„ظ‚ط§ط¦ظٹ', 'tpl_pages_auto')
    }
  );
});

registerDocCallback(/^tpl_pages_(.*)$/, 'tpl_pages_select', async (ctx) => {
  const data = ctx.callbackQuery?.data || '';
  if (ctx.session.templateWorkflowState !== 'waiting_for_pages') return;

  const pageChoice = data.replace('tpl_pages_', '');
  await ctx.editMessageText('âڈ³ ط¬ط§ط±ظٹ ط¨ظ†ط§ط، ط§ظ„ظ…ط³طھظ†ط¯ ط§ظ„ط§ط­طھط±ط§ظپظٹ ط¨ط§ط³طھط®ط¯ط§ظ… ط§ظ„ط°ظƒط§ط، ط§ظ„ط§طµط·ظ†ط§ط¹ظٹ (ظ‚ط¯ ظٹط³طھط؛ط±ظ‚ ط¨ط¹ط¶ ط§ظ„ظˆظ‚طھ)...');

  ctx.session.templateWorkflowState = 'generating';

  try {
    const stylePrompts: Record<string, string> = {
      tables: "STYLE: TABLES - highly structured layout, dark table headers, alternating row colors, black body text, strict grid alignment, professional data-report appearance.",
      report: "STYLE: REPORT - clean corporate report, strong heading hierarchy, subtle quote blocks, elegant spacing, modern sans-serif typography.",
      formal: "STYLE: FORMAL - monochrome official style, serif typography, strict margins, signature section, formal government/business appearance.",
      creative: "STYLE: CREATIVE - modern visual accents, section dividers, dynamic typography, elegant color highlights, stylish layouts.",
      minimal: "STYLE: MINIMAL - whitespace-focused, ultra-clean typography, minimal decoration, elegant readability, simplified visual flow."
    };

    const selectedPages = pageChoice === 'auto'
      ? Math.ceil((ctx.session.combinedText?.split(/\s+/).length || 500) / 250)
      : parseInt(pageChoice, 10);
    const pages = Math.max(1, Number.isFinite(selectedPages) ? selectedPages : 2);

    const pageConstraint = [
      `CRITICAL SYSTEM CONSTRAINT:`,
      `The user has paid for EXACTLY ${pages} A4 page(s).`,
      `You MUST compress or expand your content to fill EXACTLY ${pages} page(s).`,
      `- For 1 page:  write ~400-500 words maximum.`,
      `- For 2 pages: write ~800-1000 words maximum.`,
      `- For 3 pages: write ~1200-1500 words maximum.`,
      `- For 4 pages: write ~1600-2000 words maximum.`,
      `- For 5 pages: write ~2000-2500 words maximum.`,
      `NEVER generate content that spills into page ${pages + 1}.`,
      `Adjust table rows and paragraph length to perfectly match the limit.`,
    ].join('\n');

    const masterPrompt = `${pageConstraint}

You are a master document generator. Your task is to generate ONLY valid Markdown (with semantic HTML/CSS if needed for layout).
OUTPUT CONTRACT: Return ONLY the final formatted Markdown document.
NEVER explain anything, NO code fences, NO backticks, NO commentary, NO fake PDFs, NO base64.
NEUTRALIZE unsafe HTML, avoid script tags, avoid external assets.

${stylePrompts[ctx.session.selectedStyle || 'minimal']}

USER CONTENT:
${ctx.session.combinedText}`;

    // Async lock & Retry logic
    const finalResponse = await Promise.race([
      withRetry(() => aiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: 'system', content: masterPrompt }],
        temperature: 0.2
      })),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Master Prompt Timeout')), 60000))
    ]) as any;

    const finalMarkdown = finalResponse.choices[0]?.message?.content ?? '';
    if (!finalMarkdown.trim()) throw new Error('AI returned empty content.');

    // Remove markdown code fences if AI disobeyed
    const cleanMarkdown = finalMarkdown.replace(/^```[a-z]*\n?/gm, '').replace(/```$/gm, '');

    const pdfPath = await generateAiPDF(cleanMarkdown);

    if (ctx.callbackQuery?.message?.message_id) {
      await ctx.api.deleteMessage(ctx.chat!.id, ctx.callbackQuery.message.message_id).catch(() => { });
    }
    await ctx.replyWithDocument(
      new InputFile(pdfPath, `Template_Doc_${Date.now()}.pdf`),
      { caption: `âœ… <b>طھظ… طھطµظ…ظٹظ… ظ…ط³طھظ†ط¯ظƒ ط¨ظ†ط¬ط§ط­!</b>\n\nط§ظ„ظ‚ط§ظ„ط¨: ${ctx.session.selectedStyle?.toUpperCase()}`, parse_mode: 'HTML' }
    );

  } catch (err: any) {
    console.error('[Template-Style PDF Error]', err);
    if (ctx.callbackQuery?.message?.message_id) {
      await ctx.api.deleteMessage(ctx.chat!.id, ctx.callbackQuery.message.message_id).catch(() => { });
    }
    await ctx.reply(`â‌Œ ظپط´ظ„ ط¥ظ†ط´ط§ط، ط§ظ„ظ…ط³طھظ†ط¯: ${err.message || 'ط®ط·ط£ ط؛ظٹط± ظ…ط¹ط±ظˆظپ'}\nظٹط±ط¬ظ‰ ط§ظ„ظ…ط­ط§ظˆظ„ط© ظ…ط±ط© ط£ط®ط±ظ‰.`);
  } finally {
    // Cleanup rules
    ctx.session.textBuffer = [];
    ctx.session.combinedText = '';
    ctx.session.selectedStyle = null;
    ctx.session.templateWorkflowState = 'idle';
    ctx.session.isGenerating = false;
  }
});

// â”€â”€â”€ docBot: Premium AI Flow â€” Stage 1 (entry) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

registerDocCallback('start_premium_ai', 'start_premium_ai', async (ctx) => {
  const adminId = Number(process.env.ADMIN_ID);
  if (docWelcomeLocked && ctx.from?.id !== adminId) {
    await ctx.answerCallbackQuery({ text: 'ًں› ï¸ڈ ظ‡ط°ظ‡ ط§ظ„ط®ط¯ظ…ط© ظ…ط؛ظ„ظ‚ط© ظ…ط¤ظ‚طھط§ظ‹ ظ„ظ„طµظٹط§ظ†ط©', show_alert: true });
    return;
  }

  // TASK 3: Show mode selection before existing flow
  await ctx.answerCallbackQuery().catch(() => { });
  await ctx.reply(
    'ًں¤– NizoAI PDF â€” ط§ط®طھط± ط§ظ„ظ†ظˆط¹:\n\n' +
    '1ï¸ڈâƒ£ طھظ„ظ‚ط§ط¦ظٹ â€” ط§ظ„ط¨ظˆطھ ظٹظˆظ„ظ‘ط¯ ط§ظ„ظ…ط³طھظ†ط¯ ظپظˆط±ط§ظ‹ ط¨ط¯ظˆظ† طµظˆط± ظ…ط®طµطµط©\n' +
    '2ï¸ڈâƒ£ ط§ط­طھط±ط§ظپظٹ âœ¨ â€” ط£ظ†طھ طھط±ظپط¹ طµظˆط±ظƒ ظˆطھطھط­ظƒظ… ط¨ظƒظ„ طµظپط­ط©\n' +
    '(ط§ظ„ظ†ط³ط®ط© ط§ظ„ط§ط­طھط±ط§ظپظٹط© ظ…طھط§ط­ط© ظ…ط±ط© ظˆط§ط­ط¯ط© ظپظ‚ط· ظ…ط¬ط§ظ†ط§ظ‹)',
    {
      reply_markup: {
        inline_keyboard: [
          // @ts-ignore
          [{ text: 'âœڈï¸ڈ طھظ„ظ‚ط§ط¦ظٹ', callback_data: 'nizo_pdf_auto', style: 'primary' }],
          // @ts-ignore
          [{ text: 'ًں–¼âœڈï¸ڈ ط§ط­طھط±ط§ظپظٹ', callback_data: 'nizo_pdf_pro', style: 'primary' }],
          // @ts-ignore
          [{ text: 'ط¥ظ„ط؛ط§ط، â‌Œ', callback_data: 'cancel', style: 'danger' }],
        ],
      },
    }
  );
});

// â”€â”€â”€ nizo_pdf_auto: run EXISTING NizoAI PDF flow unchanged â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

registerDocCallback('nizo_pdf_auto', 'nizo_pdf_auto', async (ctx) => {
  const adminId = Number(process.env.ADMIN_ID);
  if (docWelcomeLocked && ctx.from?.id !== adminId) {
    await ctx.answerCallbackQuery({ text: 'ًں› ï¸ڈ ظ‡ط°ظ‡ ط§ظ„ط®ط¯ظ…ط© ظ…ط؛ظ„ظ‚ط© ظ…ط¤ظ‚طھط§ظ‹ ظ„ظ„طµظٹط§ظ†ط©', show_alert: true });
    return;
  }

  // Reset all related state
  ctx.session.awaitingPremiumImage = false;
  ctx.session.awaitingMoreText = false;
  ctx.session.awaitingPremiumText = false;
  ctx.session.awaitingStyleSelect = false;
  ctx.session.pendingPremiumImage = undefined;
  ctx.session.pendingPremiumPrompt = undefined;
  ctx.session.pendingPremiumPages = undefined;
  ctx.session.pendingPremiumCost = undefined;
  ctx.session.referenceImageBuffer = undefined;
  ctx.session.collectedText = '';
  ctx.session.totalWords = 0;
  ctx.session.estimatedPages = 0;
  ctx.session.aiDocStyle = undefined;

  await ctx.reply(
    `ًں¤– <b>NizoAI PDF</b> â€” ط§ط®طھط± ط·ط±ط§ط² ط§ظ„ظ…ط³طھظ†ط¯:`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            // @ts-ignore
            { text: 'ط¬ط¯ط§ظˆظ„ ظˆط¨ظٹط§ظ†ط§طھ', callback_data: 'nizopdf_style_tables', style: 'primary' as const },
            // @ts-ignore
            { text: 'طھظ‚ط±ظٹط± ط§ط­طھط±ط§ظپظٹ', callback_data: 'nizopdf_style_report', style: 'primary' as const }
          ],
          [
            // @ts-ignore
            { text: 'ط®ط·ط§ط¨ ط±ط³ظ…ظٹ', callback_data: 'nizopdf_style_formal', style: 'primary' as const },
            // @ts-ignore
            { text: 'طھطµظ…ظٹظ… ط¥ط¨ط¯ط§ط¹ظٹ', callback_data: 'nizopdf_style_creative', style: 'primary' as const }
          ],
          [
            // @ts-ignore
            { text: 'ط¨ط³ظٹط· ظˆط£ظ†ظٹظ‚', callback_data: 'nizopdf_style_minimal', style: 'primary' as const },
            // @ts-ignore
            { text: 'ظ‚ط§ظ„ط¨ ط£ظƒط§ط¯ظٹظ…ظٹ', callback_data: 'nizopdf_style_academic', style: 'primary' as const }
          ],
          [
            // @ts-ignore
            { text: 'â‌Œ ط¥ظ„ط؛ط§ط،', callback_data: 'premium_cancel_flow', style: 'danger' as const }
          ]
        ]
      }
    }
  );
});

// Cancel handler for NizoAI PDF flow
registerDocCallback('premium_cancel_flow', 'premium_cancel_flow', async (ctx) => {
  ctx.session.awaitingMoreText = false;
  ctx.session.awaitingStyleSelect = false;
  ctx.session.aiDocStyle = undefined;
  ctx.session.collectedText = '';
  ctx.session.totalWords = 0;
  await ctx.editMessageText('âœ… طھظ… ط¥ظ„ط؛ط§ط، ط§ظ„ط¹ظ…ظ„ظٹط©.').catch(() => { });
});

registerDocCallback('premium_use_default', 'premium_use_default', async (ctx) => {
  if (ctx.session.awaitingPremiumImage) {
    ctx.session.referenceImageBuffer = undefined;
    ctx.session.awaitingPremiumImage = false;
    ctx.session.awaitingPremiumText = false;
    ctx.session.awaitingMoreText = true;
    ctx.session.collectedText = '';
    ctx.session.totalWords = 0;
    ctx.session.estimatedPages = 0;
    await ctx.editMessageText(
      `âœ… طھظ… ط­ظپط¸ ط§ظ„ظ†ظ…ظˆط°ط¬. ط§ظ„ط¢ظ† ط£ط±ط³ظ„ ط§ظ„ظ…ط­طھظˆظ‰ ط§ظ„ظ†طµظٹ ط±ط³ط§ظ„ط© ط±ط³ط§ظ„ط©.\n` +
      `ظپظٹ ظƒظ„ ط±ط³ط§ظ„ط© ط³ط£ط­ط³ط¨ ظ„ظƒ ط¹ط¯ط¯ ط§ظ„ظƒظ„ظ…ط§طھ ظˆط§ظ„طµظپط­ط§طھ ط§ظ„ظ…طھظˆظ‚ط¹ط©.\n` +
      `ط¹ظ†ط¯ظ…ط§ طھظ†طھظ‡ظٹ ط£ط±ط³ظ„ ظƒظ„ظ…ط©: طھظ…`,
      { parse_mode: 'HTML' }
    );
  }
});

registerDocCallback(/^pages_(.*)$/, 'pages', async (ctx) => {
  const data = ctx.callbackQuery?.data || '';
  if (data.startsWith('pages_')) {
    const pageChoice = data.replace('pages_', '');
    const totalWords = ctx.session.totalWords || 0;
    const estimatedPages = Math.ceil(totalWords / 250);

    const user = await User.findOne({ telegramId: ctx.from!.id });
    if (!user) return;

    const template = ctx.session.aiDocStyle || 'default';
    const collectedText = ctx.session.collectedText || '';
    const imageBase64 = ctx.session.referenceImageBuffer;

    let targetPages = 2;
    let manualCost = 0;
    const isAuto = pageChoice === 'auto';

    if (isAuto) {
      if (user.dailyQuota < 2) {
        await ctx.answerCallbackQuery({ text: "ط±طµظٹط¯ظƒ ظ„ط§ ظٹظƒظپظٹ ط­طھظ‰ ظ„ظ„ط­ط¯ ط§ظ„ط£ط¯ظ†ظ‰ (2 ظ†ظ‚ط§ط·).", show_alert: true });
        return;
      }
      targetPages = Math.max(1, estimatedPages);
    } else {
      targetPages = parseInt(pageChoice, 10);
      manualCost = getPdfCost(targetPages);
      if (user.dailyQuota < manualCost) {
        await ctx.answerCallbackQuery({
          text: `ط±طµظٹط¯ظƒ (${user.dailyQuota}) ط؛ظٹط± ظƒط§ظپظچ. طھط­طھط§ط¬ ${manualCost} ظ†ظ‚ط§ط· ظ„ظ€ ${targetPages} طµظپط­ط§طھ.`,
          show_alert: true
        });
        return;
      }
      await User.updateOne({ _id: user._id }, { $inc: { dailyQuota: -manualCost } });
    }

    const pageLimit = await getUserPageLimit(ctx.from!.id);
    if (targetPages > pageLimit) {
      if (!isAuto) await User.updateOne({ _id: user._id }, { $inc: { dailyQuota: manualCost } }); // refund
      const _plg1 = buildPageLimitGuardMessage(pageLimit);
      await ctx.reply(_plg1.text, { reply_markup: _plg1.reply_markup as any });
      return;
    }

    await ctx.answerCallbackQuery();
    const loadingState = await showDynamicLoading(ctx, 'âڈ³ ط¬ط§ط±ظٹ ط¥ظ†ط´ط§ط، ظ…ط³طھظ†ط¯ظƒ ط¨ط§ظ„ط°ظƒط§ط، ط§ظ„ط§طµط·ظ†ط§ط¹ظٹ');

    try {
      const { systemPrompt, userContent } = buildEnterprisePrompt(collectedText, targetPages, template, imageBase64);

      const response = await withRetry(() => aiClient.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_tokens: 4000,
        temperature: 0.2,
      }));

      const aiResponse = response.choices[0]?.message?.content ?? '';
      if (!aiResponse.trim()) throw new Error('AI returned empty content');

      const cleanMarkdown = aiResponse.replace(/^```[a-z]*\n?/gm, '').replace(/^```$/gm, '');

      let finalCost = manualCost;
      let finalPages = targetPages;

      if (isAuto) {
        const actualWords = cleanMarkdown.split(/\s+/).filter(Boolean).length;
        finalPages = Math.max(1, Math.round(actualWords / 250));
        finalCost = getPdfCost(finalPages);

        if (user.dailyQuota < finalCost) {
          await ctx.reply(`ط±طµظٹط¯ظƒ ط؛ظٹط± ظƒط§ظپظچ ظ„ظ„طµظپط­ط§طھ ط§ظ„ظ…ظˆظ„ظˆط¯ط©. ظٹط±ط¬ظ‰ ط¥ط¶ط§ظپط© ط±طµظٹط¯.`);
          throw new Error('Insufficient balance for auto mode'); // discard
        }
        await User.updateOne({ _id: user._id }, { $inc: { dailyQuota: -finalCost } });
      }

      ctx.session.isAutoMode = isAuto;
      const pdfPath = await generateAiPDF(cleanMarkdown, template, isAuto);
      await loadingState.stop();

      const actualPageCount = getHtmlPageCount(cleanMarkdown);
      ctx.session.lastPageCount = actualPageCount;

      await ctx.replyWithDocument(
        new InputFile(pdfPath, `NizoAI_Doc_${Date.now()}.pdf`),
        {
          caption:
            `âœ… <b>طھظ… ط¥ظ†ط´ط§ط، ظ…ط³طھظ†ط¯ظƒ ط§ظ„ط§ط­طھط±ط§ظپظٹ!</b>\n` +
            `ًںژ¨ ط§ظ„ظ‚ط§ظ„ط¨: ${template.toUpperCase()}\n` +
            `ًں’³ ط§ظ„طھظƒظ„ظپط©: ${finalCost} ظ†ظ‚ط§ط·\n` +
            `ًں“„ ط§ظ„طµظپط­ط§طھ ط§ظ„ظپط¹ظ‘ط§ظ„ط©: ${ctx.session.lastPageCount}`,
          parse_mode: 'HTML'
        }
      );

      ctx.session.lastGeneratedDoc = {
        text: cleanMarkdown,
        pageCount: ctx.session.lastPageCount,
        originalCost: finalCost
      };
      ctx.session.lastAiGeneratedText = cleanMarkdown;
      ctx.session.lastAiDocPages = ctx.session.lastPageCount;
      // Task 4: Store generation context for edit routing
      ctx.session.lastOriginalPrompt = systemPrompt + '\n\n' + collectedText;
      ctx.session.lastGeneratedTopic = collectedText;
      ctx.session.lastPdfMode = 'nizo_auto';
      ctx.session.editCount = 0;
      ctx.session.lastImageCount = (cleanMarkdown.match(/\[IMAGE:/g) ?? []).length;
      ctx.session.lastImageCountPerPage = parseImageSections(cleanMarkdown);
      await sendTextChunksWithEditButton(ctx, cleanMarkdown);

      ctx.session.collectedText = '';
      ctx.session.referenceImageBuffer = '';
      ctx.session.totalWords = 0;
      ctx.session.awaitingMoreText = false;
      ctx.session.awaitingStyleSelect = false;
      ctx.session.aiDocStyle = undefined;
      ctx.session.isGenerating = false;

    } catch (err: any) {
      await loadingState.stop();
      if (!isAuto && err.message !== 'Insufficient balance for auto mode') {
        await User.updateOne({ _id: user._id }, { $inc: { dailyQuota: manualCost } }); // refund
      }
      console.error('[Paid PDF] Error:', err);
      if (err.message !== 'Insufficient balance for auto mode') {
        await ctx.reply(`â‌Œ <b>ظپط´ظ„ ط¥ظ†ط´ط§ط، ط§ظ„ظ…ط³طھظ†ط¯.</b>\n<code>${err?.message}</code>`, { parse_mode: 'HTML' });
      }
      ctx.session.awaitingStyleSelect = false;
      ctx.session.isGenerating = false;
    }
    return;
  }
});

registerDocCallback('cancel_premium_ai', 'cancel_premium_ai', async (ctx) => {
  await ctx.editMessageText('â‌Œ طھظ… ط¥ظ„ط؛ط§ط، ط§ظ„ط·ظ„ط¨.')
    .catch((error: unknown) => logDocBotError('[DocBot:cancel_premium_ai] editMessageText failed:', error));
  ctx.session.awaitingPremiumImage = false;
  ctx.session.awaitingMoreText = false;
  ctx.session.awaitingPremiumText = false;
  ctx.session.awaitingCustomPages = false;
  ctx.session.awaitingStyleSelect = false;   // V4
  ctx.session.aiDocStyle = undefined; // V4
  ctx.session.pendingPremiumImage = undefined;
  ctx.session.pendingPremiumPrompt = undefined;
  ctx.session.pendingPremiumPages = undefined;
  ctx.session.pendingPremiumCost = undefined;
  ctx.session.referenceImageBuffer = undefined;
  ctx.session.collectedText = '';
  ctx.session.totalWords = 0;
  ctx.session.estimatedPages = 0;
  ctx.session.isGenerating = false;
});

// â”€â”€â”€ V4: Style selection callbacks for NizoAI PDF â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const NIZOPDF_STYLES = ['tables', 'report', 'formal', 'creative', 'minimal', 'academic'];
NIZOPDF_STYLES.forEach(style => {
  registerDocCallback(`nizopdf_style_${style}`, `nizopdf_style_${style}`, async (ctx) => {
    // Store selected style, then route into the EXISTING awaitingMoreText flow
    // so points deduction and page selection remain fully intact
    ctx.session.aiDocStyle = style;
    ctx.session.awaitingStyleSelect = false;
    ctx.session.awaitingMoreText = true;
    ctx.session.collectedText = '';
    ctx.session.totalWords = 0;
    ctx.session.estimatedPages = 0;

    await ctx.editMessageText(
      `âœ… <b>ط§ظ„ط·ط±ط§ط²: ${style.toUpperCase()}</b>\n\n` +
      `ًں“‌ ط£ط±ط³ظ„ ط§ظ„ظ…ط­طھظˆظ‰ ط±ط³ط§ظ„ط© ط±ط³ط§ظ„ط©. ط¹ظ†ط¯ ط§ظ„ط§ظ†طھظ‡ط§ط، ط£ط±ط³ظ„ \u202a<b>طھظ…</b>\u202c ط£ظˆ ط§ط¶ط؛ط· ط¥ظ„ط؛ط§ط،.`,
      { parse_mode: 'HTML' }
    ).catch(() => { });
  });
});

// Cancel handler for TPL workflow (PRO ًں‘‘)
registerDocCallback('tpl_cancel', 'tpl_cancel', async (ctx) => {
  ctx.session.templateWorkflowState = 'idle';
  ctx.session.textBuffer = [];
  ctx.session.combinedText = '';
  ctx.session.selectedStyle = null;
  ctx.session.isGenerating = false;
  await ctx.editMessageText('âœ… طھظ… ط¥ظ„ط؛ط§ط، ط§ظ„ط¹ظ…ظ„ظٹط©.').catch(() => { });
});

// Cancel handler for text-collection phase (PRO ًں‘‘)
registerDocCallback('tpl_cancel_collect', 'tpl_cancel_collect', async (ctx) => {
  ctx.session.templateWorkflowState = 'idle';
  ctx.session.textBuffer = [];
  ctx.session.combinedText = '';
  ctx.session.selectedStyle = null;
  ctx.session.isGenerating = false;
  await ctx.reply('âœ… طھظ… ط¥ظ„ط؛ط§ط، ط§ظ„ط¹ظ…ظ„ظٹط©.').catch(() => { });
});



// أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯
// TASK 4 أ¢â‚¬â€‌ Professional Image Collection Flow
// أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯

// أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬ cancel: simple cancel handler for pro mode menu أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
// â”€â”€ pages_locked: locked page button handler â”€â”€
registerDocCallback('pages_locked', 'pages_locked', async (ctx) => {
  await ctx.answerCallbackQuery({
    text: 'ًں”’ ظ‡ط°ط§ ط§ظ„ط²ط± ظ…ظ‚ظپظ„ ظ…ظ† ظ‚ط¨ظ„ ط§ظ„ط§ط¯ظ…ظ† â€” ط§ط®طھط± ط²ط± طھظ„ظ‚ط§ط¦ظٹ',
    show_alert: true
  }).catch(() => {});
});

registerDocCallback('cancel', 'cancel', async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => { });
  await ctx.editMessageText('â‌Œ طھظ… ط§ظ„ط¥ظ„ط؛ط§ط،.').catch(() => { });
  // Clear any pro session state
  ctx.session.proImageMode = false;
  ctx.session.proImageData = [];
  ctx.session.proImageCurrentPage = null;
  ctx.session.proOriginalTopic = undefined;
  ctx.session.proModeType = undefined;
});

// أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬ Helper: build page-selection keyboard أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
function buildProPageKeyboard(completedPages: number[] = []): any {
  const activeRow = [1, 2, 3, 4, 5].map(n => ({
    text: completedPages.includes(n) ? `âœ… ${n}` : `${n}`,
    callback_data: `pro_page_${n}`
  }));
  const lockedRow = [6, 7, 8, 9, 10].map(n => ({
    text: `ًں”’ ${n}`,
    callback_data: 'pro_page_locked'
  }));
  return {
    inline_keyboard: [
      activeRow,
      lockedRow,
      [
        // @ts-ignore
        { text: 'âœ… ظ…ظˆط§ظپظ‚', callback_data: 'pro_confirm', style: 'success' as const },
        // @ts-ignore
        { text: 'â‌Œ ط¥ظ„ط؛ط§ط،', callback_data: 'cancel', style: 'danger' as const }
      ]
    ]
  };
}

// أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬ free_pdf_pro: entry point for Free PDF Professional Mode أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
registerDocCallback('free_pdf_pro', 'free_pdf_pro', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  // STEP A: Check usage limit
  const user = await User.findOne({ telegramId: userId });
  if (user?.usedProMode) {
    await ctx.answerCallbackQuery().catch(() => { });
    await ctx.reply(
      'âڑ ï¸ڈ ظ„ظ‚ط¯ ط§ط³طھط®ط¯ظ…طھ ط§ظ„ظ†ط³ط®ط© ط§ظ„ط§ط­طھط±ط§ظپظٹط© ظ…ط±ط© ظˆط§ط­ط¯ط© ط¨ط§ظ„ظپط¹ظ„.\n' +
      'ظ„ظ„ط§ط³طھط®ط¯ط§ظ… ط؛ظٹط± ط§ظ„ظ…ط­ط¯ظˆط¯طŒ طھظˆط§طµظ„ ظ…ط¹ ط§ظ„ظ…ط·ظˆط±.'
    );
    return;
  }

  await ctx.answerCallbackQuery().catch(() => { });

  // STEP B: Ask for topic
  ctx.session.proImageMode = true;
  ctx.session.proImageData = [];
  ctx.session.proImageCurrentPage = null;
  ctx.session.proOriginalTopic = undefined;
  ctx.session.proModeType = 'free';
  ctx.session.awaitingFreeAiTopic = true; // reuse existing topic interceptor flag

  await ctx.reply('âœچï¸ڈ ط£ط±ط³ظ„ ظ„ظٹ ظ…ظˆط¶ظˆط¹ ط§ظ„ظ…ط³طھظ†ط¯ ط§ظ„ط°ظٹ طھط±ظٹط¯ظ‡:', {
    reply_markup: {
      inline_keyboard: [[
        // @ts-ignore
        { text: 'â‌Œ ط¥ظ„ط؛ط§ط،', callback_data: 'cancel', style: 'danger' as const }
      ]]
    }
  });
});

// أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬ nizo_pdf_pro: entry point for NizoAI PDF Professional Mode أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
registerDocCallback('nizo_pdf_pro', 'nizo_pdf_pro', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  // STEP A: Check usage limit
  const user = await User.findOne({ telegramId: userId });
  if (user?.usedProMode) {
    await ctx.answerCallbackQuery().catch(() => { });
    await ctx.reply(
      'âڑ ï¸ڈ ظ„ظ‚ط¯ ط§ط³طھط®ط¯ظ…طھ ط§ظ„ظ†ط³ط®ط© ط§ظ„ط§ط­طھط±ط§ظپظٹط© ظ…ط±ط© ظˆط§ط­ط¯ط© ط¨ط§ظ„ظپط¹ظ„.\n' +
      'ظ„ظ„ط§ط³طھط®ط¯ط§ظ… ط؛ظٹط± ط§ظ„ظ…ط­ط¯ظˆط¯طŒ طھظˆط§طµظ„ ظ…ط¹ ط§ظ„ظ…ط·ظˆط±.'
    );
    return;
  }

  await ctx.answerCallbackQuery().catch(() => { });

  // STEP B: Ask for topic
  ctx.session.proImageMode = true;
  ctx.session.proImageData = [];
  ctx.session.proImageCurrentPage = null;
  ctx.session.proOriginalTopic = undefined;
  ctx.session.proModeType = 'nizo';
  ctx.session.awaitingFreeAiTopic = true; // reuse existing interceptor for topic

  await ctx.reply('âœچï¸ڈ ط£ط±ط³ظ„ ظ„ظٹ ظ…ظˆط¶ظˆط¹ ط§ظ„ظ…ط³طھظ†ط¯ ط§ظ„ط°ظٹ طھط±ظٹط¯ظ‡:');
});

// أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬ pro_page_locked: locked page pressed أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
registerDocCallback('pro_page_locked', 'pro_page_locked', async (ctx) => {
  await ctx.answerCallbackQuery({
    text: 'ًں”’ ظ‡ط°ظ‡ ط§ظ„ظ…ظٹط²ط© ظ„ظ„ظ…ط´طھط±ظƒظٹظ† ط§ظ„ظ…ظ…ظٹط²ظٹظ†. طھظˆط§طµظ„ ظ…ط¹ ط§ظ„ظ…ط·ظˆط± ظ„ظ„طھظپط¹ظٹظ„.',
    show_alert: true
  }).catch(() => { });
  // Do NOT send a new message.
});

// أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬ pro_page_1..5: active page pressed أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
for (let pageN = 1; pageN <= 5; pageN++) {
  const N = pageN;
  registerDocCallback(`pro_page_${N}`, `pro_page_${N}`, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => { });
    ctx.session.proImageCurrentPage = N;

    await ctx.reply(
      `ًں“¸ ط§ظ„طµظپط­ط© ${N}\n` +
      `ط£ط±ط³ظ„ طµظˆط±ط© ط£ظˆ ط£ظƒط«ط± (ط§ظ„ط­ط¯ ط§ظ„ط£ظ‚طµظ‰ 5 طµظˆط±)\n` +
      `âœڈï¸ڈ ظٹظ…ظƒظ†ظƒ ط¥ط±ط³ط§ظ„ طھط¹ظ„ظٹظ‚ ظ…ط¹ ط§ظ„طµظˆط±ط© ظ„ظٹط¸ظ‡ط± طھط­طھظ‡ط§ ظپظٹ ط§ظ„ظ…ط³طھظ†ط¯\n` +
      `âœ… ط¹ظ†ط¯ ط§ظ„ط§ظ†طھظ‡ط§ط، ط§ط¶ط؛ط· ط§ظ„ط²ط± ط£ط¯ظ†ط§ظ‡`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: `âœ… طھظ… ط§ظ„طµظپط­ط© ${N}`, callback_data: `pro_page_done_${N}` }],
            [{ text: 'â†©ï¸ڈ طھط±ط§ط¬ط¹', callback_data: 'pro_page_back' }],
          ],
        },
      }
    );
  });
}

// أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬ pro_page_done_1..5: page done pressed أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
for (let pageN = 1; pageN <= 5; pageN++) {
  const N = pageN;
  registerDocCallback(`pro_page_done_${N}`, `pro_page_done_${N}`, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => { });

    // FIX: State Trap أ¢â‚¬â€‌ clear page lock immediately
    ctx.session.proImageCurrentPage = null;

    // Mark this page as completed in the data array
    if (!ctx.session.proImageData) ctx.session.proImageData = [];
    const existingPage = ctx.session.proImageData.find((p: any) => p.page === N);
    if (!existingPage) {
      ctx.session.proImageData.push({ page: N, photos: [] });
    }

    // Compute completed pages for keyboard update
    const completedPages = (ctx.session.proImageData || [])
      .filter((p: any) => p.photos && p.photos.length > 0)
      .map((p: any) => p.page);

    // Edit page-selection message if we have its ID
    if (ctx.session.proImageMessageId && ctx.chat?.id) {
      await ctx.api.editMessageReplyMarkup(
        ctx.chat.id,
        ctx.session.proImageMessageId,
        { reply_markup: buildProPageKeyboard(completedPages) }
      ).catch(() => { });
    }

    await ctx.reply(`âœ… طھظ… ط­ظپط¸ طµظˆط± ط§ظ„طµظپط­ط© ${N}! ط§ط®طھط± طµظپط­ط© ط£ط®ط±ظ‰ ط£ظˆ ط§ط¶ط؛ط· ظ…ظˆط§ظپظ‚.`);
  });
}

// أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬ pro_page_back: go back to page selection أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
registerDocCallback('pro_page_back', 'pro_page_back', async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => { });
  ctx.session.proImageCurrentPage = null;
  await ctx.reply('â†©ï¸ڈ طھظ… ط§ظ„ط±ط¬ظˆط¹. ط§ط®طھط± طµظپط­ط© ظ…ظ† ط§ظ„ظ‚ط§ط¦ظ…ط© ط£ط¹ظ„ط§ظ‡.');
});

// أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬ pro_confirm: user finished uploading, generate PDF أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
registerDocCallback('pro_confirm', 'pro_confirm', async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => { });

  const proData = ctx.session.proImageData || [];
  const pagesWithPhotos = proData.filter((p: any) => p.photos && p.photos.length > 0);

  if (pagesWithPhotos.length === 0) {
    await ctx.reply('âڑ ï¸ڈ ظ„ظ… طھط±ظپط¹ ط£ظٹ طµظˆط± ط¨ط¹ط¯! ط§ط±ظپط¹ طµظˆط±ط© ظˆط§ط­ط¯ط© ط¹ظ„ظ‰ ط§ظ„ط£ظ‚ظ„.');
    return;
  }

  const topic = ctx.session.proOriginalTopic || 'ظ…ط³طھظ†ط¯ ط§ط­طھط±ط§ظپظٹ';
  const userId = ctx.from?.id;
  if (!userId) return;

  await ctx.reply('âڈ³ ط¬ط§ط±ظٹ ط¥ظ†ط´ط§ط، ظ…ط³طھظ†ط¯ظƒ ط§ظ„ط§ط­طھط±ط§ظپظٹ... ظٹط±ط¬ظ‰ ط§ظ„ط§ظ†طھط¸ط§ط±');

  try {
    const { generateProImagePDF } = await import('./services/aiPdfService');

    const pdfPath = await generateProImagePDF({
      topic,
      images: proData,
      botToken: process.env.DOC_BOT_TOKEN || process.env.BOT_TOKEN || '',
    });

    await ctx.replyWithDocument(
      new InputFile(pdfPath, `ProDoc_${Date.now()}.pdf`),
      { caption: 'âœ… ظ…ط³طھظ†ط¯ظƒ ط§ظ„ط§ط­طھط±ط§ظپظٹ ط¬ط§ظ‡ط²! ًں“„âœ¨' }
    );

    // Mark pro mode as used
    await User.findOneAndUpdate(
      { telegramId: userId },
      { usedProMode: true }
    );

    // Clear all pro session fields
    ctx.session.proImageMode = false;
    ctx.session.proImageData = [];
    ctx.session.proImageCurrentPage = null;
    ctx.session.proOriginalTopic = undefined;
    ctx.session.proImageMessageId = undefined;
    ctx.session.proModeType = undefined;
    ctx.session.proModeUsed = true;

  } catch (err: any) {
    console.error('[ProMode PDF Error]', err);
    await ctx.reply(`â‌Œ ظپط´ظ„ ط¥ظ†ط´ط§ط، ط§ظ„ظ…ط³طھظ†ط¯: ${err?.message || 'ط®ط·ط£ ط؛ظٹط± ظ…ط¹ط±ظˆظپ'}`);
  }
});

// â”€â”€ Task 8: Pro Edit Callbacks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
registerDocCallback('pro_edit_text', 'pro_edit_text', async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => { });
  ctx.session.awaitingProEditText = true;
  await ctx.reply('âœڈï¸ڈ ط£ط±ط³ظ„ ط§ظ„طھط¹ط¯ظٹظ„ط§طھ ط§ظ„ظ†طµظٹط© ط§ظ„ظ…ط·ظ„ظˆط¨ط©:');
});

registerDocCallback('pro_edit_skip_text', 'pro_edit_skip_text', async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => { });
  ctx.session.awaitingProEditText = false;
  await showProImageEditMenu(ctx);
});

registerDocCallback(/^pro_edit_img_(\d+)$/, 'pro_edit_img', async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => { });
  const match = ctx.callbackQuery?.data?.match(/^pro_edit_img_(\d+)$/);
  if (!match) return;
  const page = parseInt(match[1]);
  ctx.session.proEditCurrentImgPage = page;
  await ctx.reply(`ًں“¸ ط£ط±ط³ظ„ ط§ظ„طµظˆط±ط© ط§ظ„ط¨ط¯ظٹظ„ط© ظ„ط±ظ‚ظ… ${page}:`);
});

registerDocCallback('pro_edit_confirm', 'pro_edit_confirm', async (ctx) => {
  await handleProEditConfirmV2(ctx);
});
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬ Pro Mode: photo handler (STEP F) أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
docBot.on(['message:photo', 'message:document'], withDocBotHandler('pro_image_collector', async (ctx, next) => {
  // Task 8: Pro Edit Image Interceptor
  if (ctx.session.proEditCurrentImgPage != null) {
    const handled = await processProEditImageUpload(ctx);
    if (handled) return;
  }
  // Only handle if in pro mode AND a page is selected
  if (!ctx.session.proImageMode) return next();

  const pageN = ctx.session.proImageCurrentPage;

  // FIX: State Trap أ¢â‚¬â€‌ ignore photos if no page is selected
  if (pageN === null || pageN === undefined) {
    return next();
  }

  let fileId: string | undefined;
  if (ctx.message?.photo) {
    fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  } else if (ctx.message?.document && ctx.message.document.mime_type?.startsWith('image/')) {
    fileId = ctx.message.document.file_id;
  }

  if (!fileId) return next();

  // Init page data if needed
  if (!ctx.session.proImageData) ctx.session.proImageData = [];
  let pageData = ctx.session.proImageData.find((p: any) => p.page === pageN);
  if (!pageData) {
    pageData = { page: pageN, photos: [] };
    ctx.session.proImageData.push(pageData);
  }

  const count = pageData.photos.length;

  if (count >= 5) {
    await ctx.reply(`âڑ ï¸ڈ ط§ظ„ط­ط¯ ط§ظ„ط£ظ‚طµظ‰ 5 طµظˆط± ظ„ظƒظ„ طµظپط­ط©. ط§ط¶ط؛ط· 'طھظ… ط§ظ„طµظپط­ط©' ظ„ظ„ظ…طھط§ط¨ط¹ط©.`);
    return;
  }

  // Save file_id and caption
  pageData.photos.push(fileId);
  const caption = ctx.message?.caption || ctx.message?.text || undefined;
  if (caption && !pageData.caption) {
    pageData.caption = caption;
  }

  await ctx.reply(`âœ… طھظ… ط§ط³طھظ„ط§ظ… ط§ظ„طµظˆط±ط© ${count + 1}/5`);
}));


// â”€â”€â”€ docBot: Premium Image Upload Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

docBot.on(['message:photo', 'message:document'], withDocBotHandler('premium_image_upload', async (ctx, next) => {
  if (ctx.session.awaitingPremiumImage) {
    let fileId: string | undefined;
    if (ctx.message?.photo) {
      fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    } else if (ctx.message?.document && ctx.message.document.mime_type?.startsWith('image/')) {
      fileId = ctx.message.document.file_id;
    }

    if (!fileId) return next();

    try {
      const waitMsg = await ctx.reply('âڈ³ ط¬ط§ط±ظٹ ط­ظپط¸ ط§ظ„ظ†ظ…ظˆط°ط¬ ط§ظ„ظ…ط±ط¬ط¹ظٹ...');
      const file = await ctx.api.getFile(fileId);
      const filePath = file.file_path;
      if (!filePath) throw new Error('File path not found');

      const res = await fetch(`https://api.telegram.org/file/bot${process.env.DOC_BOT_TOKEN}/${filePath}`);
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      ctx.session.referenceImageBuffer = buffer.toString('base64');
      ctx.session.pendingPremiumImage = undefined;
      ctx.session.awaitingPremiumImage = false;
      ctx.session.awaitingPremiumText = false;
      ctx.session.awaitingMoreText = true;
      ctx.session.collectedText = '';
      ctx.session.totalWords = 0;
      ctx.session.estimatedPages = 0;

      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id)
        .catch((error: unknown) => logDocBotError('[DocBot:premium_image_upload] delete wait message failed:', error));
      await ctx.reply(
        'âœ… <b>طھظ… ط­ظپط¸ ط§ظ„ظ†ظ…ظˆط°ط¬ ط§ظ„ظ…ط±ط¬ط¹ظٹ!</b>\n\n' +
        'ًں“‌ ط£ط±ط³ظ„ ط§ظ„ط¢ظ† ط§ظ„ظ…ط­طھظˆظ‰ ط±ط³ط§ظ„ط© ط±ط³ط§ظ„ط©طŒ ظˆط¹ظ†ط¯ ط§ظ„ط§ظ†طھظ‡ط§ط، ط£ط±ط³ظ„ ظƒظ„ظ…ط©: طھظ…',
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('Error fetching image for premium AI:', error);
      await ctx.reply('â‌Œ ط­ط¯ط« ط®ط·ط£ ط£ط«ظ†ط§ط، ظ…ط¹ط§ظ„ط¬ط© ط§ظ„طµظˆط±ط©طŒ ظٹط±ط¬ظ‰ ط§ظ„ظ…ط­ط§ظˆظ„ط© ط¨طµظˆط±ط© ط£ط®ط±ظ‰.');
    }
    return;
  }
  return next();
}));

// â”€â”€â”€ docBot: Admin + AI text input handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Handle "Done" button from inline keyboard during text collection
registerDocCallback('nizopdf_done', 'nizopdf_done', async (ctx) => {
  if (ctx.session.awaitingMoreText) {
    ctx.session.awaitingMoreText = false;
    const totalWords = (ctx.session.collectedText || '').split(/\s+/).filter(Boolean).length;
    const estimatedPages = Math.ceil(totalWords / 250);
    ctx.session.totalWords = totalWords;

    await ctx.editMessageText(
      `âœ… <b>طھظ… طھظ„ظ‚ظٹ ط§ظ„ظ…ط­طھظˆظ‰</b>\n` +
      `ًں“‌ ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظƒظ„ظ…ط§طھ: ${totalWords} â€” ط§ظ„طµظپط­ط§طھ ط§ظ„ظ…طھظˆظ‚ط¹ط©: ~${estimatedPages}\n\n` +
      `<b>ط§ط®طھط± ط¹ط¯ط¯ ط§ظ„طµظپط­ط§طھ:</b>`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              // @ts-ignore
              { text: 'ًں”’ 1 طµظپط­ط©', callback_data: 'pages_locked', style: 'primary' as const },
              // @ts-ignore
              { text: 'ًں”’ 2 طµظپط­ط©', callback_data: 'pages_locked', style: 'primary' as const },
              // @ts-ignore
              { text: 'ًں”’ 3 طµظپط­ط§طھ', callback_data: 'pages_locked', style: 'primary' as const },
              // @ts-ignore
              { text: 'ًں”’ 5 طµظپط­ط§طھ', callback_data: 'pages_locked', style: 'primary' as const },
            ],
            [
              // @ts-ignore
              { text: 'ًں”’ 10 طµظپط­ط§طھ', callback_data: 'pages_locked', style: 'primary' as const },
              // @ts-ignore
              { text: 'ًں”’ 15 طµظپط­ط©', callback_data: 'pages_locked', style: 'primary' as const },
              // @ts-ignore
              { text: 'ًں”’ 20 طµظپط­ط©', callback_data: 'pages_locked', style: 'primary' as const },
            ],
            [
              // @ts-ignore
              { text: 'ًں¤– طھظ„ظ‚ط§ط¦ظٹ (ظٹط­ط¯ط¯ظ‡ ط§ظ„ط¨ظˆطھ)', callback_data: 'pages_auto', style: 'success' as const }
            ],
            [
              // @ts-ignore
              { text: 'ط¥ظ„ط؛ط§ط، â‌Œ', callback_data: 'premium_cancel_flow', style: 'danger' as const }
            ],
          ],
        },
      }
    );
  }
});

docBot.on('message:text', withDocBotHandler('text_input', async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return next();

  const text = ctx.message?.text?.trim();
  if (!text) return next();

  // â”€â”€ Paid PDF Text Loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (ctx.session.awaitingMoreText && ctx.message?.text) {
    const incoming = ctx.message.text.trim();

    const _lowerIncoming = incoming.toLowerCase();
    const _nizoImageKeywords = [
      'طµظˆط±ط©', 'طµظˆط±', 'طµظˆط±ظ‡', 'طµظˆط±ظٹ', 'طµظˆط±طھظٹ', 'ط§ظ„طµظˆط±ط©', 'ط§ظ„طµظˆط±',
      'طµظˆط±ظƒ', 'ط§ط¶ظپ طµظˆط±ط©', 'ط¶ظپ طµظˆط±ط©', 'ط£ط¶ظپ طµظˆط±ط©',
      'ظ…ط¹ طµظˆط±ط©', 'ظپظٹظ‡ طµظˆط±ط©', 'ظٹط­طھظˆظٹ طµظˆط±ط©', 'طھط¶ظ…ظٹظ† طµظˆط±ط©',
      'طµظˆط± ط§ط­طھط±ط§ظپظٹط©', 'طµظˆط± طھظˆط¶ظٹط­ظٹط©', 'طµظˆط± ظ„ظ„ظ…ط³طھظ†ط¯',
      'ط§ط¯ط±ط¬ طµظˆط±ط©', 'ط£ط¯ط±ط¬ طµظˆط±ط©', 'ط§ط±ظپظ‚ طµظˆط±ط©',
      'ط­ط· طµظˆط±ط©', 'ط®ظ„ظٹ ظپظٹظ‡ طµظˆط±ط©', 'ط§ط¨ط؛ط§ طµظˆط±ط©',
      'image', 'images', 'photo', 'photos', 'picture', 'pictures',
      'img', 'add image', 'with image', 'include image',
      'طµظˆط±ط© ظ„ظƒظ„', 'طµظˆط± ظ„ظƒظ„', 'طµظˆط±ط© ظپظٹ ظƒظ„'
    ];
    const _foundNizoKw = _nizoImageKeywords.find(kw => _lowerIncoming.includes(kw.toLowerCase()));
    if (_foundNizoKw && incoming !== 'طھظ…' && incoming !== 'طھظ….' && incoming !== 'ط§ظ†طھظ‡ظٹطھ') {
      await ctx.reply(
        'âڑ ï¸ڈ <b>طھظ†ط¨ظٹظ‡ â€” ط±ط³ط§ظ„طھظƒ طھط­طھظˆظٹ ط¹ظ„ظ‰ ط·ظ„ط¨ طµظˆط±</b>\n\n' +
        'طھظ… ط§ظƒطھط´ط§ظپ ظƒظ„ظ…ط§طھ ظ…طھط¹ظ„ظ‚ط© ط¨ط§ظ„طµظˆط± ظپظٹ ط±ط³ط§ظ„طھظƒ.\n\n' +
        'âœڈï¸ڈ ط²ط± <b>ط§ظ„طھظ„ظ‚ط§ط¦ظٹ</b> ظ…ط®طµطµ ظ„ظ„ظ†طµظˆطµ ظپظ‚ط· ظˆظ„ط§ ظٹط¯ط¹ظ… ط§ظ„طµظˆط±.\n\n' +
        'ًں“Œ <b>ظٹط±ط¬ظ‰ ط§طھط¨ط§ط¹ ط§ظ„ط®ط·ظˆط§طھ ط§ظ„طھط§ظ„ظٹط©:</b>\n' +
        'ظ،. ط§ط­ط°ظپ ط¬ظ…ظٹط¹ ط§ظ„ظƒظ„ظ…ط§طھ ط§ظ„ظ…طھط¹ظ„ظ‚ط© ط¨ط§ظ„طµظˆط± ظ…ظ† ظ†طµظƒ\n' +
        'ظ¢. ط£ط±ط³ظ„ ط§ظ„ظ†طµ ط¨ط¹ط¯ ط§ظ„طھط¹ط¯ظٹظ„ ظˆط³ظٹطھظ… ط¥ظ†ط´ط§ط، ط§ظ„ظ…ط³طھظ†ط¯ ظپظˆط±ط§ظ‹',
        { parse_mode: 'HTML' }
      );
      return;
    }

    if (incoming === 'طھظ…' || incoming === 'طھظ….' || incoming === 'ط§ظ†طھظ‡ظٹطھ') {
      // Style already chosen upfront â€” go DIRECTLY to page selection
      ctx.session.awaitingMoreText = false;
      const totalWords = (ctx.session.collectedText || '').split(/\s+/).filter(Boolean).length;
      const estimatedPages = Math.ceil(totalWords / 250);
      ctx.session.totalWords = totalWords;

      await ctx.reply(
        `âœ… <b>طھظ… طھظ„ظ‚ظٹ ط§ظ„ظ…ط­طھظˆظ‰</b>\n` +
        `ًں“‌ ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظƒظ„ظ…ط§طھ: ${totalWords} â€” ط§ظ„طµظپط­ط§طھ ط§ظ„ظ…طھظˆظ‚ط¹ط©: ~${estimatedPages}\n\n` +
        `<b>ط§ط®طھط± ط¹ط¯ط¯ ط§ظ„طµظپط­ط§طھ:</b>`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                // @ts-ignore
                { text: 'ًں”’ 1 طµظپط­ط©', callback_data: 'pages_locked', style: 'primary' as const },
                // @ts-ignore
                { text: 'ًں”’ 2 طµظپط­ط©', callback_data: 'pages_locked', style: 'primary' as const },
                // @ts-ignore
                { text: 'ًں”’ 3 طµظپط­ط§طھ', callback_data: 'pages_locked', style: 'primary' as const },
                // @ts-ignore
                { text: 'ًں”’ 5 طµظپط­ط§طھ', callback_data: 'pages_locked', style: 'primary' as const },
              ],
              [
                // @ts-ignore
                { text: 'ًں”’ 10 طµظپط­ط§طھ', callback_data: 'pages_locked', style: 'primary' as const },
                // @ts-ignore
                { text: 'ًں”’ 15 طµظپط­ط©', callback_data: 'pages_locked', style: 'primary' as const },
                // @ts-ignore
                { text: 'ًں”’ 20 طµظپط­ط©', callback_data: 'pages_locked', style: 'primary' as const },
              ],
              [
                // @ts-ignore
                { text: 'ًں¤– طھظ„ظ‚ط§ط¦ظٹ (ظٹط­ط¯ط¯ظ‡ ط§ظ„ط¨ظˆطھ)', callback_data: 'pages_auto', style: 'success' as const }
              ],
              [
                // @ts-ignore
                { text: 'ط¥ظ„ط؛ط§ط، â‌Œ', callback_data: 'premium_cancel_flow', style: 'danger' as const }
              ],
            ],
          },
        }
      );
      return;
    }

    // Accumulate â€” show word count + Done/Cancel keyboard
    ctx.session.collectedText = (ctx.session.collectedText || '') + '\n' + incoming;
    const totalWords = ctx.session.collectedText.split(/\s+/).filter(Boolean).length;
    const estimatedPages = Math.ceil(totalWords / 250);
    ctx.session.totalWords = totalWords;

    await ctx.reply(
      `ًں“‌ <b>ط§ظ„ظƒظ„ظ…ط§طھ ط­طھظ‰ ط§ظ„ط¢ظ†:</b> ${totalWords}\n` +
      `ًں“„ <b>ط§ظ„طµظپط­ط§طھ ط§ظ„ظ…طھظˆظ‚ط¹ط©:</b> ~${estimatedPages}\n\n` +
      `ط£ط±ط³ظ„ ط§ظ„ظ…ط²ظٹط¯ ط£ظˆ ط§ط¶ط؛ط· ظ„ظ„ط¥ظ†ظ‡ط§ط،:`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              // @ts-ignore
              { text: 'طھظ… â€” ط¥ظ†ظ‡ط§ط، ظˆط¥ط±ط³ط§ظ„', callback_data: 'nizopdf_done', style: 'success' as const }
            ],
            [
              // @ts-ignore
              { text: 'ط¥ظ„ط؛ط§ط، â‌Œ', callback_data: 'premium_cancel_flow', style: 'danger' as const }
            ]
          ]
        }
      }
    );
    return; // CRITICAL: must return to prevent other handlers
  }

  // â”€â”€ Report to Dev state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (ctx.session?.docAwaitingReport) {
    const adminId = process.env.ADMIN_IDS?.split(',')[0]?.trim() || process.env.ADMIN_ID;
    const username = ctx.from.username ? `@${ctx.from.username}` : 'ط¨ط¯ظˆظ† ظٹظˆط²ط±';
    const name = ctx.from.first_name || 'ط¹ظ…ظٹظ„';

    const reportMsg = `ًں“‌ <b>ط¨ظ„ط§ط؛ ظ…ظ† ط¨ظˆطھ ط§ظ„ظ…ط³طھظ†ط¯ط§طھ</b> ًں“‌\n\nًں‘¤ <b>ط§ظ„ط¹ظ…ظٹظ„:</b> <a href="tg://user?id=${userId}">${name}</a> (${username})\nًں†” <b>ط§ظ„ط£ظٹط¯ظٹ:</b> <code>${userId}</code>\n\nًں“© <b>ط§ظ„ط±ط³ط§ظ„ط©:</b>\n${text}`;

    try {
      if (adminId) {
        await docBot.api.sendMessage(adminId, reportMsg, { parse_mode: 'HTML' });
      }
      if (ctx.session) ctx.session.docAwaitingReport = false;
      await ctx.reply("âœ… <b>طھظ… ط¥ط±ط³ط§ظ„ ط±ط³ط§ظ„طھظƒ ظ„ظ„ظ…ط·ظˆط± ط¨ظ†ط¬ط§ط­.</b> ط´ظƒط±ط§ظ‹ ظ„طھظˆط§طµظ„ظƒ!", { parse_mode: 'HTML' });
    } catch (error) {
      console.error('Failed to send docBot report to admin:', error);
      if (ctx.session) ctx.session.docAwaitingReport = false;
      await ctx.reply("â‌Œ ط­ط¯ط« ط®ط·ط£ ط£ط«ظ†ط§ط، ط¥ط±ط³ط§ظ„ ط§ظ„ط¨ظ„ط§ط؛. ظٹط±ط¬ظ‰ ط§ظ„ظ…ط­ط§ظˆظ„ط© ظ„ط§ط­ظ‚ط§ظ‹.");
    }
    return;
  }

  // â”€â”€ Admin state machine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (isAdmin(userId)) {
    const state = getDocAdminState(userId);
    if (state) {
      clearDocAdminState(userId);
      if (state === 'awaiting_user_id') {
        const targetUser = await User.findOne({ telegramId: text });
        if (!targetUser) { await ctx.reply('â‌Œ ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯.'); return; }
        await ctx.reply(
          `â„¹ï¸ڈ <b>ظ…ط¹ظ„ظˆظ…ط§طھ ط§ظ„ط¹ظ…ظٹظ„</b>\n\n` +
          `ًں†” ID: <code>${targetUser.telegramId}</code>\n` +
          `ًں‘¤ Username: @${targetUser.username || 'ط؛ظٹط± ظ…ط­ط¯ط¯'}\n` +
          `ًںڑ« ظ…ط­ط¸ظˆط±: ${targetUser.isBanned ? 'ظ†ط¹ظ…' : 'ظ„ط§'}`,
          { parse_mode: 'HTML' }
        );
        return;
      }
      if (state === 'awaiting_points') {
        const parts = text.split(/\s+/);
        if (parts.length !== 2 || isNaN(parseInt(parts[1]))) {
          await ctx.reply('â‌Œ ط§ظ„طµظٹط؛ط© ط؛ظٹط± طµط­ظٹط­ط©. ظ…ط«ط§ظ„: 123456789 10'); return;
        }
        const [targetId, amountStr] = parts;
        const amount = parseInt(amountStr);
        const updated = await User.findOneAndUpdate(
          { telegramId: targetId },
          { $inc: { dailyQuota: amount } },
          { new: true }
        );
        if (!updated) { await ctx.reply('â‌Œ ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯.'); return; }
        await ctx.reply(`âœ… طھظ…طھ ط¥ط¶ط§ظپط© <b>${amount}</b> ظ†ظ‚ط·ط© ظ„ظ„ظ…ط³طھط®ط¯ظ… <code>${targetId}</code>. ط§ظ„ط±طµظٹط¯: ${updated.dailyQuota}`, { parse_mode: 'HTML' });
        return;
      }
      if (state === 'awaiting_doc_page_unlock') {
        const targetId = text.trim();
        if (!/^\d+$/.test(targetId)) {
          await ctx.reply('â‌Œ ط£ط±ط³ظ„ userId طµط­ظٹط­ط§ظ‹ ط¨ط§ظ„ط£ط±ظ‚ط§ظ… ظپظ‚ط·.');
          return;
        }

        const updated = await User.findOneAndUpdate(
          { telegramId: targetId },
          { $set: { docPageLimit: 999 } },
          { new: true }
        );
        if (!updated) {
          await ctx.reply('â‌Œ ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯.');
          return;
        }

        const username = updated.username
          ? `@${updated.username}`
          : (updated.firstName || String(updated.telegramId));

        await ctx.reply(
          `âœ… طھظ… ظپطھط­ ط§ظ„طµظ„ط§ط­ظٹط© ظ„ظ€ ${username}. ظٹظ…ظƒظ†ظ‡ ط§ظ„ط¢ظ† ط¥ظ†ط´ط§ط،\n` +
          'ظˆط«ط§ط¦ظ‚ ط؛ظٹط± ظ…ط­ط¯ظˆط¯ط© ط§ظ„طµظپط­ط§طھ.'
        );
        return;
      }
      if (state === 'awaiting_broadcast') {
        const allUsers = await User.find({ isBanned: { $ne: true } }).select('telegramId').lean();
        let ok = 0; let fail = 0;
        for (const u of allUsers) {
          try {
            await docBot.api.sendMessage(u.telegramId, text);
            ok++;
          } catch (error: unknown) {
            fail++;
            logDocBotError('[DocBot:broadcast] Failed to send broadcast message:', error);
          }
          if ((ok + fail) % 25 === 0) await new Promise(r => setTimeout(r, 1000));
        }
        await ctx.reply(`ًں“¢ <b>طھظ… ط¥ط±ط³ط§ظ„ ط§ظ„ط¥ط´ط¹ط§ط±</b>\nâœ… ظ†ط¬ط­: ${ok}\nâ‌Œ ظپط´ظ„: ${fail}`, { parse_mode: 'HTML' });
        return;
      }
    }
  }

  // Paid PDF Text Loop moved to the top of the message interceptor.

  // â”€â”€ Edit Workflow Interceptor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (ctx.session.workflowState === 'waiting_for_doc_edit') {
    await handleEditPdfDocMessage(ctx);
    return;
  }

  if (ctx.session.awaitingAutoEdit) {
    await processAutoEditMessage(ctx);
    return;
  }

  if (ctx.session.awaitingProEditText) {
    await processProEditTextMessage(ctx);
    return;
  }

  // â”€â”€ Free AI Topic Interceptor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (ctx.session.awaitingFreeAiTopic) {
    ctx.session.awaitingFreeAiTopic = false;

    const user = await User.findOne({ telegramId: userId });
    if (!user) return;

    await checkAndResetDailyFree(user);
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim());
    const isAdminUser = adminIds.includes(userId.toString());

    if (!isAdminUser && user.freePdfsGeneratedToday >= 2) {
      await ctx.reply(
        'âڑ ï¸ڈ <b>ط§ط³طھظ†ظپط¯طھ ظ…ط­ط§ظˆظ„ط§طھظƒ ط§ظ„ظ…ط¬ط§ظ†ظٹط© (2) ط§ظ„ظٹظˆظ…!</b> ًںڑ«\n' +
        'ط§ط³طھط®ط¯ظ… ط²ط± [ NizoAI PDF ] ط§ظ„ظ…ط¬ط§ظˆط± ط¨ط£ط³ط¹ط§ط± ط±ظ…ط²ظٹط© ًںڑ€',
        { parse_mode: 'HTML' }
      );
      return;
    }

    // â”€â”€ Short Prompt Guard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const _userText = ctx.message?.text?.trim() ?? '';
    if (!ctx.session.proImageMode) {
      const _lowerText = _userText.toLowerCase();
      const _imageKeywords = [
        'طµظˆط±ط©', 'طµظˆط±', 'طµظˆط±ظ‡', 'طµظˆط±ظٹ', 'طµظˆط±طھظٹ', 'ط§ظ„طµظˆط±ط©', 'ط§ظ„طµظˆط±',
        'طµظˆط±ظƒ', 'ط§ط¶ظپ طµظˆط±ط©', 'ط¶ظپ طµظˆط±ط©', 'ط£ط¶ظپ طµظˆط±ط©',
        'ظ…ط¹ طµظˆط±ط©', 'ظپظٹظ‡ طµظˆط±ط©', 'ظٹط­طھظˆظٹ طµظˆط±ط©', 'طھط¶ظ…ظٹظ† طµظˆط±ط©',
        'طµظˆط± ط§ط­طھط±ط§ظپظٹط©', 'طµظˆط± طھظˆط¶ظٹط­ظٹط©', 'طµظˆط± ظ„ظ„ظ…ط³طھظ†ط¯',
        'ط§ط¯ط±ط¬ طµظˆط±ط©', 'ط£ط¯ط±ط¬ طµظˆط±ط©', 'ط§ط±ظپظ‚ طµظˆط±ط©',
        'ط­ط· طµظˆط±ط©', 'ط®ظ„ظٹ ظپظٹظ‡ طµظˆط±ط©', 'ط§ط¨ط؛ط§ طµظˆط±ط©',
        'image', 'images', 'photo', 'photos', 'picture', 'pictures',
        'img', 'add image', 'with image', 'include image',
        'طµظˆط±ط© ظ„ظƒظ„', 'طµظˆط± ظ„ظƒظ„', 'طµظˆط±ط© ظپظٹ ظƒظ„'
      ];
      const _foundKw = _imageKeywords.find(kw => _lowerText.includes(kw.toLowerCase()));
      if (_foundKw) {
        ctx.session.awaitingFreeAiTopic = true;
        await ctx.reply(
          'âڑ ï¸ڈ <b>طھظ†ط¨ظٹظ‡ â€” ط±ط³ط§ظ„طھظƒ طھط­طھظˆظٹ ط¹ظ„ظ‰ ط·ظ„ط¨ طµظˆط±</b>\n\n' +
          'طھظ… ط§ظƒطھط´ط§ظپ ظƒظ„ظ…ط§طھ ظ…طھط¹ظ„ظ‚ط© ط¨ط§ظ„طµظˆط± ظپظٹ ط±ط³ط§ظ„طھظƒ.\n\n' +
          'âœڈï¸ڈ ط²ط± <b>ط§ظ„طھظ„ظ‚ط§ط¦ظٹ</b> ظ…ط®طµطµ ظ„ظ„ظ†طµظˆطµ ظپظ‚ط· ظˆظ„ط§ ظٹط¯ط¹ظ… ط§ظ„طµظˆط±.\n\n' +
          'ًں“Œ <b>ظٹط±ط¬ظ‰ ط§طھط¨ط§ط¹ ط§ظ„ط®ط·ظˆط§طھ ط§ظ„طھط§ظ„ظٹط©:</b>\n' +
          'ظ،. ط§ط­ط°ظپ ط¬ظ…ظٹط¹ ط§ظ„ظƒظ„ظ…ط§طھ ط§ظ„ظ…طھط¹ظ„ظ‚ط© ط¨ط§ظ„طµظˆط± ظ…ظ† ظ†طµظƒ\n' +
          'ظ¢. ط£ط±ط³ظ„ ط§ظ„ظ†طµ ط¨ط¹ط¯ ط§ظ„طھط¹ط¯ظٹظ„ ظˆط³ظٹطھظ… ط¥ظ†ط´ط§ط، ط§ظ„ظ…ط³طھظ†ط¯ ظپظˆط±ط§ظ‹',
          { parse_mode: 'HTML' }
        );
        return;
      }
    }
    const _charCount = _userText.length;
    const _wordCount = _userText.split(/\s+/).filter(Boolean).length;

    if (_charCount < 100 || _wordCount < 20) {
      await ctx.reply(
        'âڑ ï¸ڈ ط¹ط°ط±ط§ظ‹طŒ ط§ظ„ظ…ظˆط¶ظˆط¹ ط§ظ„ظ…ظڈط¯ط®ظژظ„ ظ‚طµظٹط± ط¬ط¯ط§ظ‹!\n\n' +
        'ًں“‌ ظ„ط¥ظ†ط´ط§ط، ظ…ط³طھظ†ط¯ ط§ط­طھط±ط§ظپظٹطŒ ظٹط±ط¬ظ‰ ظƒطھط§ط¨ط© ظ…ظˆط¶ظˆط¹ ظˆط§ط¶ط­ ظˆظ…ظپطµظ‘ظ„\n' +
        '(ط¹ظ„ظ‰ ط§ظ„ط£ظ‚ظ„ ط¬ظ…ظ„ط© ط£ظˆ ط¬ظ…ظ„طھظٹظ† طھط´ط±ط­ ظ…ط§ طھط±ظٹط¯ظ‡ ط¨ط§ظ„ط¶ط¨ط·).\n\n' +
        'ًں’، ظ…ط«ط§ظ„ ط¬ظٹط¯: "ط§ظƒطھط¨ ظ„ظٹ طھظ‚ط±ظٹط±ط§ظ‹ ط¹ظ† طھط£ط«ظٹط± ط§ظ„ط°ظƒط§ط، ط§ظ„ط§طµط·ظ†ط§ط¹ظٹ ط¹ظ„ظ‰ ط³ظˆظ‚ ط§ظ„ط¹ظ…ظ„ ظ…ط¹ ط°ظƒط± ط§ظ„ط¥ظٹط¬ط§ط¨ظٹط§طھ ظˆط§ظ„ط³ظ„ط¨ظٹط§طھ"'
      );
      return;
    }
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    const promptAnalysis = analyzeAndEnhancePrompt(text);
    const detectedPages = promptAnalysis.detectedPages;
    const pageLimit = await getUserPageLimit(userId);

    if (detectedPages > pageLimit) {
      const _plg2 = buildPageLimitGuardMessage(pageLimit);
      await ctx.reply(_plg2.text, { reply_markup: _plg2.reply_markup as any });
      return;
    }

    // â”€â”€ PRO mode gets its own system prompt with full Unsplash image support â”€â”€
    const _isProMode = ctx.session.proImageMode === true;
    const _proImageRule = _isProMode
      ? '\nCRITICAL RULE FOR IMAGES: You are integrated with the Unsplash API.\n' +
        'To insert an image, you MUST output exactly this format on its own line: [IMAGE: english_search_keyword]\n' +
        'Example: [IMAGE: modern corporate office] or [IMAGE: apple logo]\n' +
        'If the request mentions Arabic placeholders like "(\u0623\u062f\u062e\u0644 \u0635\u0648\u0631\u0629 \u0644\u0639\u0644\u0627\u0645\u0629 \u0646\u0627\u064a\u0643)", replace with: [IMAGE: nike logo]\n' +
        'NEVER output literal Arabic image instructions like "(\u0635\u0648\u0631\u0629)" or "(\u0635\u0648\u0631\u0629: \u0643\u0630\u0627)".\n' +
        'ONLY use [IMAGE: english_keyword] tags. Use maximum 2 per document.\n'
      : '';
    const _systemPrompt = promptAnalysis.enhancedPrompt + _proImageRule;
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    const loadingState = await showDynamicLoading(ctx, 'âڈ³ ط¬ط§ط±ظٹ ط§ظ„ظƒطھط§ط¨ط© ط¨ط§ظ„ط°ظƒط§ط، ط§ظ„ط§طµط·ظ†ط§ط¹ظٹ');

    try {
      const response = await aiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: 'system', content: _systemPrompt },
          { role: 'user', content: text } // Sending raw text separately as good practice
        ],
        max_tokens: 4000,
        temperature: 0.4,
      });
      const aiResponse = response.choices[0]?.message?.content ?? '';
      if (!aiResponse.trim()) throw new Error('AI returned empty content');

      const cleanMarkdown = aiResponse.replace(/^```[a-z]*\n?/gm, '').replace(/```$/gm, '');
      // Pro mode keeps [IMAGE:] tags for Unsplash; Auto mode strips them
      const pdfBuffer = await generateAiPDF(cleanMarkdown, 'default', !_isProMode);
      ctx.session.isAutoMode = false;
      const fileName = `nizoai_free_${Date.now()}.pdf`;

      await loadingState.stop();

      const actualPageCount = getHtmlPageCount(cleanMarkdown);
      ctx.session.lastPageCount = actualPageCount;

      await ctx.replyWithDocument(
        new InputFile(pdfBuffer, fileName),
        { caption: `âœ… ظ…ط³طھظ†ط¯ظƒ ط§ظ„ظ…ط¬ط§ظ†ظٹ ط¬ط§ظ‡ط²! ًں“„\n\nًں“„ ط¹ط¯ط¯ ط§ظ„طµظپط­ط§طھ ط§ظ„ظپط¹ظ‘ط§ظ„ط©: ${ctx.session.lastPageCount}\n\nظ…ط¯ط¹ظˆظ… ط¨ظ€ AI Free PDF âڑ،` }
      );

      ctx.session.lastAiGeneratedText = cleanMarkdown;
      ctx.session.lastAiDocPages = ctx.session.lastPageCount;
      // â”€â”€ Free Mode Edit Amnesia fix â€” dedicated free session fields â”€â”€
      ctx.session.freeLastAiGeneratedText = cleanMarkdown;
      ctx.session.freeLastAiDocPages = ctx.session.lastPageCount;
      ctx.session.lastGeneratedDoc = {
        text: cleanMarkdown,
        pageCount: ctx.session.lastPageCount,
        originalCost: 0
      }; // Adding back compatibility for edit Workflow
      // Task 4: Store generation context for edit routing
      ctx.session.lastOriginalPrompt = promptAnalysis.enhancedPrompt + '\n\n' + text;
      ctx.session.lastGeneratedTopic = text;
      ctx.session.lastPdfMode = ctx.session.proImageMode ? 'free_pro' : 'free_auto';
      ctx.session.editCount = 0;
      ctx.session.lastImageCount = (cleanMarkdown.match(/\[IMAGE:/g) ?? []).length;
      ctx.session.lastImageCountPerPage = parseImageSections(cleanMarkdown);
      await sendTextChunksWithEditButton(ctx, cleanMarkdown);

      // Increment only on successful delivery
      if (!isAdminUser) {
        await User.updateOne({ _id: user._id }, { $inc: { freePdfsGeneratedToday: 1 } });
      }


    } catch (err: any) {
      await loadingState.stop();
      console.error('[DocBot Free AI] Error:', err);
      await ctx.reply(`â‌Œ <b>ظپط´ظ„ ط¥ظ†ط´ط§ط، ط§ظ„ظ…ط³طھظ†ط¯.</b>\n<code>${err?.message ?? 'unknown error'}</code>`, { parse_mode: 'HTML' });
    }
    return;
  }

  return next();
}));



// â”€â”€â”€ docBot: DocMaker handler (all remaining messages & callbacks) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

docBot.on(['message', 'callback_query'], withDocBotHandler('docmaker_router', async (ctx, next) => {
  const { handleDocMakerCallback, handleDocMakerMessage, showImageFormatMenu } = await import('./bot/handlers/docMakerHandler');

  if (ctx.callbackQuery) {
    const handled = await handleDocMakerCallback(ctx as any);
    if (!handled) return next();
    return;
  }

  if (ctx.message) {
    const docState = (ctx.session as any)?.docState as string | null;

    // â”€â”€ Session Closed Notification â”€â”€
    // Skip if user is actively in any AI or DocMaker flow
    if (!(ctx.session as any)?.isInDocMaker &&
      !(ctx.session as any)?.awaitingFreeAiTopic &&
      !(ctx.session as any)?.awaitingPremiumImage &&
      !(ctx.session as any)?.awaitingPremiumText &&
      !(ctx.session as any)?.awaitingCustomPages &&
      !(ctx.session as any)?.workflowState) {
      const txt = ctx.message.text || ctx.message.caption || '';
      if (txt.startsWith('/')) return next();

      await ctx.reply('âڑ ï¸ڈ ط§ظ„ط¬ظ„ط³ط© ط§ظ„ط³ط§ط¨ظ‚ط© ظ…ط؛ظ„ظ‚ط©.\n\nط¥ط°ط§ ط£ط±ط¯طھ ط¥ظ†ط´ط§ط، ظ…ط³طھظ†ط¯ ط¬ط¯ظٹط¯ ط§ط¶ط؛ط· ط§ظ„ط²ط± ط£ط¯ظ†ط§ظ‡:', {
        reply_markup: new InlineKeyboard().text('ًں†• ط¨ط¯ط، ظ…ط³طھظ†ط¯ ط¬ط¯ظٹط¯', 'start_doc_maker')
      });
      return;
    }

    // â”€â”€ CASE 1: Custom line number input â”€â”€
    if (docState === 'awaiting_custom_img_lines') {
      if (!ctx.message?.text) {
        await ctx.reply('âڑ ï¸ڈ ط£ط±ط³ظ„ ط±ظ‚ظ…ط§ظ‹ ظپظ‚ط· (ظ…ط«ط§ظ„: 10)', { parse_mode: 'HTML' });
        return;
      }
      const num = parseInt(ctx.message.text.trim());
      if (isNaN(num) || num < 1 || num > 50) {
        await ctx.reply('âڑ ï¸ڈ ط£ط±ط³ظ„ ط±ظ‚ظ…ط§ظ‹ طµط­ظٹط­ط§ظ‹ ط¨ظٹظ† 1 ظˆ50 ظپظ‚ط·.');
        return;
      }
      if (!(ctx.session as any).tempImage) {
        await ctx.reply('âڑ ï¸ڈ ط§ظ†طھظ‡طھ طµظ„ط§ط­ظٹط© ط§ظ„طµظˆط±ط©طŒ ط£ط±ط³ظ„ظ‡ط§ ظ…ط¬ط¯ط¯ط§ظ‹.');
        (ctx.session as any).docState = 'active';
        return;
      }
      (ctx.session as any).tempImage.lines = num;
      (ctx.session as any).docState = 'active';
      await showImageFormatMenu(ctx as any);
      return;
    }

    // â”€â”€ CASE 2: Image sent â”€â”€
    const isPhoto = !!ctx.message?.photo;
    const isImageDoc = !!ctx.message?.document && ((ctx.message.document.mime_type?.startsWith('image/')) ?? false);

    if (isPhoto || isImageDoc) {
      const isInManualDoc = (ctx.session as any).isInDocMaker === true;
      const isInAiFlow = (ctx.session as any).awaitingPremiumImage === true ||
        (ctx.session as any).awaitingFreeAiTopic === true ||
        (ctx.session as any).awaitingPremiumText === true;

      if (!isInManualDoc || isInAiFlow) return next();
      if ((ctx.session as any).awaitingNextRowImage) {
        const fileId = isPhoto
          ? ctx.message!.photo![ctx.message!.photo!.length - 1].file_id
          : ctx.message!.document!.file_id;
        const rowImages = (ctx.session as any).rowImages || [];
        const baseLines = rowImages[0]?.lines || 5;
        (ctx.session as any).tempImage = { fileId, lines: baseLines, align: undefined, mask: undefined };
        (ctx.session as any).awaitingNextRowImage = false;
        await showImageFormatMenu(ctx as any);
        return;
      }
      if ((ctx.session as any).tempImage?.fileId) {
        await ctx.reply(
          'âڑ ï¸ڈ <b>ط£ظƒظ…ظ„ ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„طµظˆط±ط© ط§ظ„ط­ط§ظ„ظٹط© ط£ظˆظ„ط§ظ‹</b>\nط£ظˆ ط§ط¶ط؛ط· ط¥ظ„ط؛ط§ط، ط§ظ„طµظˆط±ط©.',
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                // @ts-ignore
                [{ text: 'ًں”™ ط¥ظ„ط؛ط§ط، ط§ظ„طµظˆط±ط© ظˆط§ظ„ط¹ظˆط¯ط©', callback_data: 'doc_back_to_session', style: 'danger' as const }]
              ]
            }
          }
        );
        return;
      }

      const fileId = isPhoto
        ? ctx.message!.photo![ctx.message!.photo!.length - 1].file_id
        : ctx.message!.document!.file_id;

      (ctx.session as any).tempImage = { fileId };

      await ctx.reply(
        'ًں–¼ <b>طھظ… ط§ط³طھظ„ط§ظ… ط§ظ„طµظˆط±ط©!</b>\n\nًں“ڈ ظƒظ… ط³ط·ط±ط§ظ‹ طھط±ظٹط¯ طھط®طµظٹطµظ‡ط§ ظ„ظ„طµظˆط±ط© ظپظٹ ط§ظ„ظ…ط³طھظ†ط¯طں\nط£ظˆ ط§ط¬ط¹ظ„ظ‡ط§ ط؛ظ„ط§ظپط§ظ‹ ظٹظ…ظ„ط£ ط§ظ„طµظپط­ط© ط¨ط§ظ„ظƒط§ظ…ظ„:',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              // @ts-ignore
              [{ text: 'ًں“„ ظ…ظ„ط، ط§ظ„طµظپط­ط© ظƒط§ظ…ظ„ط© (ط؛ظ„ط§ظپ)', callback_data: 'doc_img_full_cover', style: 'primary' as const }],
              [{ text: 'ًں“ڈ ط§ظپطھط±ط§ط¶ظٹ â€” 5 ط£ط³ط·ط±', callback_data: 'doc_img_space_5', style: 'primary' as const }],
              // @ts-ignore
              [{ text: 'ًں“گ ظƒط¨ظٹط± â€” 10 ط£ط³ط·ط±', callback_data: 'doc_img_space_10', style: 'primary' as const }],
              [{ text: 'âœچï¸ڈ طھط®طµظٹطµ ط§ظ„ط¹ط¯ط¯...', callback_data: 'doc_img_space_custom', style: 'primary' as const }],
              // @ts-ignore
              [{ text: 'ًں”™ ط¥ظ„ط؛ط§ط،', callback_data: 'doc_back_to_session', style: 'danger' as const }]
            ]
          }
        }
      );
      return;
    }

    // â”€â”€ Row caption text intercept â”€â”€
    if (docState === 'awaiting_row_caption' && (ctx.session as any).tempCaptionTarget !== undefined) {
      const text = ctx.message?.text?.trim();
      if (!text) return;

      if ((ctx.session as any).tempCaptionTarget === 'temp' && (ctx.session as any).tempImage) {
        (ctx.session as any).tempImage.caption = text;
      } else if (typeof (ctx.session as any).tempCaptionTarget === 'number') {
        const rowImgs = (ctx.session as any).rowImages || [];
        if (rowImgs[(ctx.session as any).tempCaptionTarget]) {
          rowImgs[(ctx.session as any).tempCaptionTarget].caption = text;
        }
      }

      (ctx.session as any).tempCaptionTarget = undefined;
      (ctx.session as any).docState = 'active';

      await ctx.reply(`âœ… طھظ… ط­ظپط¸ ط§ظ„ظ†طµ ط¨ظ†ط¬ط§ط­!`);
      await showImageFormatMenu(ctx as any);
      return;
    }

    if ((ctx.session as any).tempImage?.fileId) {
      await ctx.reply(
        'âڑ ï¸ڈ <b>ط£ظƒظ…ظ„ ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„طµظˆط±ط© ط£ظˆظ„ط§ظ‹</b>\nط§ط®طھط± ط§ظ„ظ…ط­ط§ط°ط§ط© ظˆط§ظ„ط¥ط·ط§ط±طŒ ط£ظˆ ط§ط¶ط؛ط· ط¥ظ„ط؛ط§ط،.',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              // @ts-ignore
              [{ text: 'ًں”™ ط¥ظ„ط؛ط§ط، ط§ظ„طµظˆط±ط© ظˆط§ظ„ط¹ظˆط¯ط©', callback_data: 'doc_back_to_session', style: 'danger' as const }]
            ]
          }
        }
      );
      return;
    }

    const handled = await handleDocMakerMessage(ctx as any);
    if (!handled) return next();
  }
}));

// â”€â”€â”€ docBot Error Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

docBot.catch((err) => {
  const ctx = err.ctx;
  console.error(`[DocBot Error] Update ${ctx.update.update_id}:`, err.error);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
});

// â”€â”€â”€ HTTP Health Check (Render requirement) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const PORT = process.env.PORT ?? 3000;
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('NizoAI Bot is running\n');
});

server.listen(PORT, () => {
  console.log(`[Server] Health check listening on port ${PORT}`);
});

// â”€â”€â”€ Graceful Shutdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// â”€â”€â”€ Bootstrap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function bootstrap(): Promise<void> {
  try {
    await connectDatabase();
    await Settings.initDefaults();
    await initBotTexts();

    console.log('--- NizoAI Bot is starting ---');
    const [imageBotInfo, docBotInfo] = await Promise.all([
      imageBot.api.getMe(),
      docBot.api.getMe(),
    ]);
    console.log(`[ImageBot] âœ… Authenticated as @${imageBotInfo.username}`);
    console.log(`[DocBot]   âœ… Authenticated as @${docBotInfo.username}`);

    // Preload ONNX model in background (non-blocking)
    import('./services/onnxEnhanceService')
      .then(({ warmupONNX }) => warmupONNX?.())
      .catch(() => { });
    // Start fake counter engine
    import('./services/fakeCounterService')
      .then(({ startFakeCounterEngine }) => startFakeCounterEngine())
      .catch(err => console.error('[ImageBot] Failed to start fake counter engine', err));

    const imageRunner = run(imageBot);
    const docRunner = run(docBot);
    console.log('âœ… Image Bot and Document Bot are now running via grammy/runner for maximum concurrency and speed.');

    // Graceful shutdown for runners
    const shutdown = async () => {
      console.log('[System] Shutting down...');
      server.close();
      if (imageRunner.isRunning()) await imageRunner.stop();
      if (docRunner.isRunning()) await docRunner.stop();
      await closeDatabaseConnection();
      process.exit(0);
    };

    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

  } catch (error: unknown) {
    console.error('[Bootstrap] â‌Œ Fatal error:', error);
    process.exit(1);
  }
}

// â”€â”€ Task 8 Fix: parseImageSections helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Counts [IMAGE:] tags per markdown section (h2 heading = one section â‰ˆ one page).
// Returns an array like [2, 1, 3] (images in each section).
function parseImageSections(markdown: string): number[] {
  const sections = markdown.split(/^## /m);
  const counts: number[] = [];
  for (const section of sections) {
    const count = (section.match(/\[IMAGE:/g) ?? []).length;
    if (count > 0) counts.push(count);
  }
  // Fallback: if no h2 sections found, treat the whole doc as one section
  if (counts.length === 0) {
    const total = (markdown.match(/\[IMAGE:/g) ?? []).length;
    if (total > 0) counts.push(total);
  }
  return counts;
}

registerDocCallback('pages_locked', 'pages_locked', async (ctx) => {
  await ctx.answerCallbackQuery({
    text: 'ًں”’ ظ‡ط°ط§ ط§ظ„ط²ط± ظ…ظ‚ظپظ„ ظ…ظ† ظ‚ط¨ظ„ ط§ظ„ط§ط¯ظ…ظ† â€” ط§ط®طھط± ط²ط± طھظ„ظ‚ط§ط¦ظٹ',
    show_alert: true
  }).catch(() => {});
});

bootstrap();


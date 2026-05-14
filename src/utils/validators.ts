// src/utils/validators.ts
import { Context, SessionFlavor, InlineKeyboard } from 'grammy';
import { IUser } from '../database/models/User';

import { Resolution } from '../services/queueService';

// ─── Session & Context Types ───────────────────────────────────────────────────

export interface DocLine {
  text: string;
  align: 'right' | 'center' | 'left';
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  size?: 'small' | 'normal' | 'large';
  style?: 'normal' | 'quote' | 'divider' | 'highlight';
  color?: string;
  letterSpacing?: number;
  lineSpacing?: number;
  // Image-line fields
  type?: 'text' | 'image' | 'image_row';
  fileId?: string;
  imageLines?: number;
  imageMask?: 'square' | 'rounded' | 'circle';
  rowImages?: Array<{
    fileId: string;
    lines: number;
    align: 'right' | 'center' | 'left';
    mask: 'square' | 'rounded' | 'circle';
    caption?: string;
  }>;
}

export interface SessionData {
  pendingFile?: {
    fileId: string;
    fileName: string;
  };
  pendingConversionFileId?: string;
  pendingConversionFormat?: string;
  pendingBatchFiles?: string[];
  // Document Maker (session-based)
  isInDocMaker?: boolean;
  docType?: string;
  templateId?: number;
  pageSize?: string;
  tempLine?: string | null;
  tempFormatting?: {
    bold: boolean;
    italic: boolean;
    underline: boolean;
    size: 'small' | 'normal' | 'large';
    style: 'normal' | 'quote' | 'divider' | 'highlight';
    color?: string;
    align?: 'right' | 'center' | 'left';
    letterSpacing?: number;
    lineSpacing?: number;
  } | null;
  documentLines?: DocLine[];
  pendingExportCost?: number;
  pendingExportPages?: number;
  // DocMaker Edit State
  editingLineIndex?: number;
  awaitingLineEditIndex?: boolean;
  awaitingLineEditText?: boolean;
  // Live preview
  previewMessageId?: number;
  // Custom page size
  awaitingCustomWidth?: boolean;
  awaitingCustomHeight?: boolean;
  customSizeWidth?: number;  // cm
  customSizeDims?: { width: number; height: number; label: string }; // PDF points
  // Font & doc-session state
  selectedFont?: string;
  docBgColor?: string;
  docTextColor?: string;
  docState?: 'active' | 'awaiting_custom_img_lines' | 'awaiting_row_caption' | null;
  tempImage?: {
    fileId: string;
    lines?: number;
    align?: 'right' | 'center' | 'left';   // starts UNDEFINED
    mask?: 'square' | 'rounded' | 'circle'; // starts UNDEFINED
    caption?: string;
  };
  // Inline row builder
  rowImages?: Array<{
    fileId: string;
    lines: number;
    align: 'right' | 'center' | 'left';
    mask: 'square' | 'rounded' | 'circle';
    caption?: string;
  }>;
  awaitingRowCaption?: number;    // index of image awaiting caption text
  tempCaptionTarget?: number | 'temp'; // target for caption text
  awaitingNextRowImage?: boolean; // waiting for user to send next image
  awaitingCustomColor?: boolean;
  customColorPromptId?: number;
  awaitingTypographyValue?: 'letter' | 'line';
  typographyPromptId?: number;
}

export type BotContext = Context & SessionFlavor<SessionData>;

// ─── Environment Validation ────────────────────────────────────────────────────

export function validateEnv(): void {
  const required: string[] = ['BOT_TOKEN', 'MONGODB_URI', 'ADMIN_IDS', 'PORT'];
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`[Fatal] Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }
  if (!process.env.REPLICATE_AI_MODEL_ID) {
    throw new Error('REPLICATE_AI_MODEL_ID is missing from environment variables');
  }
}

// ─── File Size ─────────────────────────────────────────────────────────────────

export function isFileSizeValid(bytes: number): boolean {
  return bytes <= 20971520;
}

// ─── Admin Helpers ─────────────────────────────────────────────────────────────

export function getAdminIds(): number[] {
  return (process.env.ADMIN_IDS ?? '')
    .split(',')
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id));
}

export function isAdmin(id: number): boolean {
  return getAdminIds().includes(id);
}

// ─── Referral Helpers ──────────────────────────────────────────────────────────


export function parseStartPayload(payload?: string): number | null {
  if (!payload) return null;
  const id = parseInt(payload, 10);
  return isNaN(id) ? null : id;
}

// ─── Economy ───────────────────────────────────────────────────────────────────

export function checkAndDeductQuota(u: IUser): { canProceed: boolean } {
  // Reset quota BEFORE deduction (The Law)
  if (Date.now() - u.lastQuotaReset.getTime() >= 86400000) {
    u.dailyQuota = 3;
    u.lastQuotaReset = new Date();
  }

  if (u.dailyQuota > 0) {
    u.dailyQuota--;
    return { canProceed: true };
  }

  return { canProceed: false };
}

// ─── Misc ──────────────────────────────────────────────────────────────────────

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ─── Keyboard Builders ─────────────────────────────────────────────────────────



export function buildResolutionKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🚀 2K', 'enhance_2K')
    .text('🌟 4K', 'enhance_4K')
    .text('🔒 دقة 8K - مقفلة', 'locked_8k');
}

export function buildPostEnhanceKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('🔄 تحسين صورة أخرى', 'enhance_again');
}

export function buildAdminMainKeyboard(active: boolean): InlineKeyboard {
  return new InlineKeyboard()
    .text('📊 الإحصائيات', 'admin_stats')
    .text('📢 الإذاعة', 'admin_broadcast')
    .row()
    .text('✏️ المحتوى', 'admin_content')
    .text('👤 المستخدمين', 'admin_users')
    .row()
    .text('⚙️ الإعدادات', 'admin_settings')
    .text('💾 نسخة احتياطية', 'admin_backup')
    .row()
    .text(active ? '🟢 البوت: شغّال' : '🔴 البوت: متوقف', 'admin_toggle_bot');
}

export function buildAdminBackKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('↩️ رجوع', 'admin_back_main');
}

export function buildAdminSettingsKeyboard(
  notifyOn: boolean,
  autoDeleteOn: boolean,
  maintenanceOn: boolean
): InlineKeyboard {
  return new InlineKeyboard()
    .text(`🔔 إشعارات الانضمام: [${notifyOn ? 'ON' : 'OFF'}]`, 'admin_toggle_notify')
    .row()
    .text(`🗑️ حذف تلقائي: [${autoDeleteOn ? 'ON' : 'OFF'}]`, 'admin_toggle_autodelete')
    .row()
    .text(`🔧 وضع الصيانة: [${maintenanceOn ? 'ON' : 'OFF'}]`, 'admin_toggle_maintenance')
    .row()
    .text('↩️ رجوع', 'admin_back_main');
}

export function buildUserActionKeyboard(tid: number, banned: boolean): InlineKeyboard {
  return new InlineKeyboard()
    .text(banned ? '✅ رفع الحظر' : '🚫 حظر', `admin_user_ban_${tid}`)
    .row()
    .text('↩️ رجوع', 'admin_back_main');
}

export function resolutionLabel(res: Resolution): string {
  const labels: Record<Resolution, string> = {
    '2K': '🚀 2K',
    '4K': '🌟 4K',
    '8K': '🔥 8K',
  };
  return labels[res];
}

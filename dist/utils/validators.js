"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sleep = void 0;
exports.validateEnv = validateEnv;
exports.isFileSizeValid = isFileSizeValid;
exports.getAdminIds = getAdminIds;
exports.isAdmin = isAdmin;
exports.parseStartPayload = parseStartPayload;
exports.checkAndDeductQuota = checkAndDeductQuota;
exports.buildResolutionKeyboard = buildResolutionKeyboard;
exports.buildPostEnhanceKeyboard = buildPostEnhanceKeyboard;
exports.buildAdminMainKeyboard = buildAdminMainKeyboard;
exports.buildAdminBackKeyboard = buildAdminBackKeyboard;
exports.buildAdminSettingsKeyboard = buildAdminSettingsKeyboard;
exports.buildUserActionKeyboard = buildUserActionKeyboard;
exports.resolutionLabel = resolutionLabel;
// src/utils/validators.ts
const grammy_1 = require("grammy");
// ─── Environment Validation ────────────────────────────────────────────────────
function validateEnv() {
    const required = ['BOT_TOKEN', 'MONGODB_URI', 'ADMIN_IDS', 'PORT'];
    for (const key of required) {
        if (!process.env[key]) {
            console.error(`[Fatal] Missing required environment variable: ${key}`);
            process.exit(1);
        }
    }
    if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is missing from environment variables');
    }
    if (!process.env.REPLICATE_AI_MODEL_ID) {
        throw new Error('REPLICATE_AI_MODEL_ID is missing from environment variables');
    }
}
// ─── File Size ─────────────────────────────────────────────────────────────────
function isFileSizeValid(bytes) {
    return bytes <= 20971520;
}
// ─── Admin Helpers ─────────────────────────────────────────────────────────────
function getAdminIds() {
    return (process.env.ADMIN_IDS ?? '')
        .split(',')
        .map((id) => parseInt(id.trim(), 10))
        .filter((id) => !isNaN(id));
}
function isAdmin(id) {
    return getAdminIds().includes(id);
}
// ─── Referral Helpers ──────────────────────────────────────────────────────────
function parseStartPayload(payload) {
    if (!payload)
        return null;
    const id = parseInt(payload, 10);
    return isNaN(id) ? null : id;
}
// ─── Economy ───────────────────────────────────────────────────────────────────
function checkAndDeductQuota(u) {
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.sleep = sleep;
// ─── Keyboard Builders ─────────────────────────────────────────────────────────
function buildResolutionKeyboard() {
    return new grammy_1.InlineKeyboard()
        .text('🚀 2K', 'enhance_2K')
        .text('🌟 4K', 'enhance_4K')
        .text('🔒 دقة 8K - مقفلة', 'locked_8k');
}
function buildPostEnhanceKeyboard() {
    return new grammy_1.InlineKeyboard().text('🔄 تحسين صورة أخرى', 'enhance_again');
}
function buildAdminMainKeyboard(active) {
    return new grammy_1.InlineKeyboard()
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
function buildAdminBackKeyboard() {
    return new grammy_1.InlineKeyboard().text('↩️ رجوع', 'admin_back_main');
}
function buildAdminSettingsKeyboard(notifyOn, autoDeleteOn, maintenanceOn) {
    return new grammy_1.InlineKeyboard()
        .text(`🔔 إشعارات الانضمام: [${notifyOn ? 'ON' : 'OFF'}]`, 'admin_toggle_notify')
        .row()
        .text(`🗑️ حذف تلقائي: [${autoDeleteOn ? 'ON' : 'OFF'}]`, 'admin_toggle_autodelete')
        .row()
        .text(`🔧 وضع الصيانة: [${maintenanceOn ? 'ON' : 'OFF'}]`, 'admin_toggle_maintenance')
        .row()
        .text('↩️ رجوع', 'admin_back_main');
}
function buildUserActionKeyboard(tid, banned) {
    return new grammy_1.InlineKeyboard()
        .text(banned ? '✅ رفع الحظر' : '🚫 حظر', `admin_user_ban_${tid}`)
        .row()
        .text('↩️ رجوع', 'admin_back_main');
}
function resolutionLabel(res) {
    const labels = {
        '2K': '🚀 2K',
        '4K': '🌟 4K',
        '8K': '🔥 8K',
    };
    return labels[res];
}
//# sourceMappingURL=validators.js.map
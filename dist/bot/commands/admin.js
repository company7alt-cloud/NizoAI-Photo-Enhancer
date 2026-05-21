"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminCommands = registerAdminCommands;
const isAdmin = (ctx) => {
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    return adminIds.includes(ctx.from?.id.toString() || '');
};
function registerAdminCommands(bot) {
    // ── /admin — Main Panel ──
    bot.command('admin', async (ctx) => {
        if (!isAdmin(ctx))
            return;
        const { GlobalStat } = await Promise.resolve().then(() => __importStar(require('../../database/models/GlobalStat')));
        const config = await GlobalStat.findOne({ key: 'total_processed' });
        const isActive = config?.isFakeCounterActive || false;
        await ctx.reply('🛠 <b>لوحة تحكم المدير</b>\n\nاختر ما تريد إدارته:', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👥 التحكم في العميل', callback_data: 'admin_user_control', style: 'primary' }],
                    [{ text: `📈 العداد الوهمي: ${isActive ? '✅ شغال' : '❌ متوقف'}`, callback_data: 'toggle_fake_counter', style: 'danger' }],
                    [{ text: '✏️ تعديل رسالة الترحيب', callback_data: 'admin_edit_welcome', style: 'primary' }],
                    [{ text: '🎁 تعديل عدد المحاولات اليومية', callback_data: 'admin_edit_daily', style: 'primary' }],
                    [{ text: '⚠️ تعديل رسالة انتهاء المحاولات', callback_data: 'admin_edit_low', style: 'primary' }],
                    [{ text: '📊 إحصائيات البوت', callback_data: 'admin_stats', style: 'success' }],
                    [{ text: '🔍 البحث عن مستخدم', callback_data: 'admin_search_user', style: 'primary' }],
                    [{ text: '📢 إرسال إشعار لجميع المستخدمين', callback_data: 'admin_broadcast', style: 'primary' }],
                    [{ text: '🔧 وضع الصيانة', callback_data: 'admin_maintenance', style: 'primary' }],
                    [{ text: '📢 تمويل أعضاء قناة', callback_data: 'start_fund_campaign', style: 'success' }],
                    [{ text: '⚙️ إدارة أزرار البوت (قفل/فتح)', callback_data: 'admin_panel', style: 'primary' }],
                    [{ text: '🔄 إعدادات زر تحويل الصيغة', callback_data: 'admin_edit_convert_msg', style: 'primary' }],
                    [{ text: '✏️ تعديل نصوص البوت', callback_data: 'admin_edit_texts', style: 'primary' }],
                    [{ text: '🎯 إدارة المحاولات', callback_data: 'admin_manage_attempts', style: 'primary' }],
                    [{ text: '🔗 إنشاء رابط مكافأة', callback_data: 'admin_create_magic_link', style: 'primary' }],
                ],
            },
        });
    });
}
//# sourceMappingURL=admin.js.map
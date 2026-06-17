import { Context } from 'grammy';

const isAdmin = (ctx: Context): boolean => {
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
  return adminIds.includes(ctx.from?.id.toString() || '');
};

export function registerAdminCommands(bot: any) {

  // ── /admin — Main Panel ──
  bot.command('admin', async (ctx: Context) => {
    if (!isAdmin(ctx)) return;
    const { GlobalStat } = await import('../../database/models/GlobalStat');
    const config = await GlobalStat.findOne({ key: 'total_processed' });
    const isActive = config?.isFakeCounterActive || false;

    await ctx.reply(
      '🛠 <b>لوحة تحكم المدير</b>\n\nاختر ما تريد إدارته:',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '👥 التحكم في العميل', callback_data: 'admin_user_control' , style: 'primary' as const}],
            [{ text: `📈 العداد الوهمي: ${isActive ? '✅ شغال' : '❌ متوقف'}`, callback_data: 'toggle_fake_counter' , style: 'danger' as const}],
            [{ text: '✏️ تعديل رسالة الترحيب', callback_data: 'admin_edit_welcome' , style: 'primary' as const}],
            [{ text: '🎁 تعديل عدد المحاولات اليومية', callback_data: 'admin_edit_daily' , style: 'primary' as const}],
            [{ text: '⚠️ تعديل رسالة انتهاء المحاولات', callback_data: 'admin_edit_low' , style: 'primary' as const}],
            [{ text: '📊 إحصائيات البوت', callback_data: 'admin_stats' , style: 'success' as const}],
            [{ text: '🔍 البحث عن مستخدم', callback_data: 'admin_search_user' , style: 'primary' as const}],
            [{ text: '📢 إرسال إشعار لجميع المستخدمين', callback_data: 'admin_broadcast' , style: 'primary' as const}],
            [{ text: '🔧 وضع الصيانة', callback_data: 'admin_maintenance' , style: 'primary' as const}],
            [{ text: '📢 تمويل أعضاء قناة', callback_data: 'start_fund_campaign' , style: 'success' as const}],
            [{ text: '⚙️ إدارة أزرار البوت (قفل/فتح)', callback_data: 'admin_panel' , style: 'primary' as const}],
            [{ text: '🔄 إعدادات زر تحويل الصيغة', callback_data: 'admin_edit_convert_msg' , style: 'primary' as const}],
            [{ text: '✏️ تعديل نصوص البوت', callback_data: 'admin_edit_texts' , style: 'primary' as const}],
            [{ text: '🎯 إدارة المحاولات', callback_data: 'admin_manage_attempts' , style: 'primary' as const}],
            [{ text: '🔗 إنشاء رابط مكافأة', callback_data: 'admin_create_magic_link' , style: 'primary' as const}],
            [{ text: '✏️ تعديل النصوص', callback_data: 'admin_text_override' , style: 'primary' as const}],
            [{ text: '🔗 ربط حساب شبح', callback_data: 'admin_add_ghost', style: 'success' as const }],
            [{ text: '👻 إحصائيات الجيش', callback_data: 'admin_ghost_stats', style: 'primary' as const }],
          ],
        },
      }
    );
  });
}

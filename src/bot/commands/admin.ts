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
            [{ text: `📈 العداد الوهمي: ${isActive ? '✅ شغال' : '❌ متوقف'}`, callback_data: 'toggle_fake_counter' }],
            [{ text: '✏️ تعديل رسالة الترحيب', callback_data: 'admin_edit_welcome' }],
            [{ text: '🎁 تعديل عدد المحاولات اليومية', callback_data: 'admin_edit_daily' }],
            [{ text: '⚠️ تعديل رسالة انتهاء المحاولات', callback_data: 'admin_edit_low' }],
            [{ text: '📊 إحصائيات البوت', callback_data: 'admin_stats' }],
            [{ text: '🔍 البحث عن مستخدم', callback_data: 'admin_search_user' }],
            [{ text: '📢 إرسال إشعار لجميع المستخدمين', callback_data: 'admin_broadcast' }],
            [{ text: '🔧 وضع الصيانة', callback_data: 'admin_maintenance' }],
            [{ text: '📢 تمويل أعضاء قناة', callback_data: 'start_fund_campaign' }],
            [{ text: '⚙️ إدارة أزرار البوت (قفل/فتح)', callback_data: 'admin_panel' }],
            [{ text: '🔄 إعدادات زر تحويل الصيغة', callback_data: 'admin_edit_convert_msg' }],
            [{ text: '✏️ تعديل نصوص البوت', callback_data: 'admin_edit_texts' }],
            [{ text: '🎯 إدارة المحاولات', callback_data: 'admin_manage_attempts' }],
            [{ text: '🔗 إنشاء رابط مكافأة', callback_data: 'admin_create_magic_link' }],
          ],
        },
      }
    );
  });
}

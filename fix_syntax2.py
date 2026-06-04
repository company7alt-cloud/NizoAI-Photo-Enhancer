import re

path = 'c:/NizoAI-Bot/src/index.ts'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

broken_block = """    if (!link.startsWith('http')) {
      await ctx.reply('❌ يرجى إرسال رابط صحيح يبدأ بـ http');
        { parse_mode: 'Markdown' },
      );
      return;
    }"""

fixed_block = """    if (!link.startsWith('http')) {
      await ctx.reply('❌ يرجى إرسال رابط صحيح يبدأ بـ http');
      return;
    }

    // ── Guard B: Kill-Switch ──
    const { isInternetFetcherEnabled: _ifeB } = await import('./utils/internetFetcherSettings');
    const fetcherAdminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const isFetcherAdmin = fetcherAdminIds.includes(ctx.from?.id?.toString() || '');

    // Allow passing if the feature is enabled OR if the user is an Admin
    if (!_ifeB() && !isFetcherAdmin) {
      await ctx.reply(
        `🔧 *تحميل الصور من الإنترنت*\\n\\n` +
        `✨ هذه الميزة تحت الصيانة حالياً لتقديم تجربة أفضل لك!\\n\\n` +
        `🚀 سيتم إعادة تفعيلها قريباً إن شاء الله 🌟\\n` +
        `💙 نعتذر عن الإزعاج ونقدّر صبرك الجميل`,
        { parse_mode: 'Markdown' },
      );
      return;
    }"""

content = content.replace(broken_block, fixed_block)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

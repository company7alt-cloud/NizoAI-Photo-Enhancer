
import re

path = 'c:/NizoAI-Bot/src/index.ts'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

broken_block = '''    if (!link.startsWith('http')) {
      await ctx.reply('? íÑÌì ÅÑÓÇá ÑÇÈØ ÕÍíÍ íÈÏÃ ÈÜ http');
        { parse_mode: 'Markdown' },
      );
      return;
    }'''

fixed_block = '''    if (!link.startsWith('http')) {
      await ctx.reply('? íÑÌì ÅÑÓÇá ÑÇÈØ ÕÍíÍ íÈÏÃ ÈÜ http');
      return;
    }

    // ?? Guard B: Kill-Switch ??
    const { isInternetFetcherEnabled: _ifeB } = await import('./utils/internetFetcherSettings');
    const fetcherAdminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const isFetcherAdmin = fetcherAdminIds.includes(ctx.from?.id?.toString() || '');

    // Allow passing if the feature is enabled OR if the user is an Admin
    if (!_ifeB() && !isFetcherAdmin) {
      await ctx.reply(
        \?? *ÊÍãíá ÇáÕæÑ ãä ÇáÅäÊÑäÊ*\\n\\n\ +
        \? åĞå ÇáãíÒÉ ÊÍÊ ÇáÕíÇäÉ ÍÇáíÇğ áÊŞÏíã ÊÌÑÈÉ ÃİÖá áß!\\n\\n\ +
        \?? ÓíÊã ÅÚÇÏÉ ÊİÚíáåÇ ŞÑíÈÇğ Åä ÔÇÁ Çááå ??\\n\ +
        \?? äÚÊĞÑ Úä ÇáÅÒÚÇÌ æäŞÏøÑ ÕÈÑß ÇáÌãíá\,
        { parse_mode: 'Markdown' },
      );
      return;
    }'''

content = content.replace(broken_block, fixed_block)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)


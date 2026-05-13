// src/bot/handlers/docMakerHandler.ts
import { BotContext, DocLine } from '../../utils/validators';
import { User } from '../../database/models/User';
import { InputFile } from 'grammy';
import { getSettings } from '../../services/settingsService';
import { generatePreviewPNG, TEMPLATE_NAMES } from '../../services/previewGeneratorService';

function buildFormattingKeyboard(fmt: any): { inline_keyboard: any[][] } {
  const b = fmt.bold ? '✅ عريض' : '𝐁 عريض';
  const it = fmt.italic ? '✅ مائل' : '𝐼 مائل';
  const ul = fmt.underline ? '✅ تحته خط' : 'U̲ تحته خط';
  const sm = fmt.size === 'small' ? '✅ صغير' : '🔡 صغير';
  const nm = (!fmt.size || fmt.size === 'normal') ? '✅ عادي' : '🔤 عادي';
  const lg = fmt.size === 'large' ? '✅ كبير' : '🔠 كبير';
  const qt = fmt.style === 'quote' ? '✅ اقتباس' : '" اقتباس';
  const dv = fmt.style === 'divider' ? '✅ فاصل' : '— فاصل';
  const hl = fmt.style === 'highlight' ? '✅ مميز' : '★ مميز';
  return {
    inline_keyboard: [
      [
        { text: '➡️ يمين', callback_data: 'align_right' },
        { text: '↔️ وسط', callback_data: 'align_center' },
        { text: '⬅️ يسار', callback_data: 'align_left' },
      ],
      [
        { text: b, callback_data: 'style_bold' },
        { text: it, callback_data: 'style_italic' },
        { text: ul, callback_data: 'style_underline' },
      ],
      [
        { text: sm, callback_data: 'size_small' },
        { text: nm, callback_data: 'size_normal' },
        { text: lg, callback_data: 'size_large' },
      ],
      [
        { text: qt, callback_data: 'style_quote' },
        { text: dv, callback_data: 'style_divider' },
        { text: hl, callback_data: 'style_highlight' },
      ],
      [
        { text: '🔙 رجوع', callback_data: 'doc_format_back' }
      ]
    ],
  };
}

const BACKUP_CHANNEL_ID = process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID || '';

function smartWrap(text: string, pageSize: string): string[] {
  const MAX_CHARS = pageSize === 'A5' ? 40 : 65;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; }
    else if (cur.length + 1 + w.length <= MAX_CHARS) { cur += ' ' + w; }
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

const DOC_MAKER_INSTRUCTION =
  `✨ <b>صانع المستندات والكتب</b>\n\n` +
  `📌 <b>كيفية الاستخدام:</b>\n\n` +
  `▸ أرسل النص أو العبارة التي تريد إضافتها\n` +
  `▸ ستظهر لك أزرار لاختيار موضع النص:\n` +
  `   [ ➡️ يمين ] [ ↔️ وسط ] [ ⬅️ يسار ]\n\n` +
  `📐 <b>للأسطر الفارغة:</b>\n` +
  `▸ أرسل <code>فارغ</code> ← لسطر فارغ واحد\n` +
  `▸ أرسل <code>فارغ 2</code> ← لسطرين فارغين\n` +
  `▸ أرسل <code>فارغ 3</code> ← لثلاثة أسطر فارغة\n\n` +
  `⚠️ <b>ملاحظة:</b> النص لن يلمس حواف المستند أبداً — هناك هوامش احترافية.`;

const COMPILE_KB = {
  inline_keyboard: [
    [{ text: '📤 تصدير الآن', callback_data: 'doc_export_pdf' }],
    [{ text: '↩️ إعادة آخر سطر', callback_data: 'doc_undo_last' }],
  ],
};

function controlPanel() {
  return {
    inline_keyboard: [
      [
        { text: '📤 تصدير الآن', callback_data: 'doc_export_pdf' },
        { text: '✏️ تعديل سطر', callback_data: 'doc_edit_line' }
      ],
      [
        { text: '↩️ إعادة آخر سطر', callback_data: 'doc_undo_last' },
        { text: '📄 صفحة جديدة', callback_data: 'doc_new_page' }
      ],
      [{ text: '📋 عرض الأسطر', callback_data: 'doc_view_lines' }],
      [{ text: '🚪 إنهاء الجلسة', callback_data: 'doc_cancel_end' }]
    ]
  };
}

const SIZE_KB = {
  inline_keyboard: [
    [{ text: 'A4 (افتراضي)', callback_data: 'doc_size_A4' }, { text: 'A5', callback_data: 'doc_size_A5' }],
    [{ text: 'Letter', callback_data: 'doc_size_Letter' }, { text: 'B5', callback_data: 'doc_size_B5' }],
    [{ text: 'Legal', callback_data: 'doc_size_Legal' }, { text: 'Executive', callback_data: 'doc_size_Executive' }],
    [{ text: '📐 مقاس مخصص', callback_data: 'doc_custom_size' }],
    [{ text: '🔙 رجوع', callback_data: 'doc_tpl_back' }],
  ],
};

async function refreshPreview(ctx: BotContext): Promise<void> {
  if (!ctx.session.previewMessageId || !ctx.chat) return;
  try {
    const png = await generatePreviewPNG({
      templateId: ctx.session.templateId || 1,
      pageSize: ctx.session.pageSize || 'A4',
      lines: ctx.session.documentLines || [],
      selectedFont: ctx.session.selectedFont,
      docBgColor:   ctx.session.docBgColor,
      docTextColor: ctx.session.docTextColor,
    });
    const tplName = TEMPLATE_NAMES[ctx.session.templateId || 1] || '';
    await ctx.api.editMessageMedia(ctx.chat.id, ctx.session.previewMessageId, {
      type: 'photo',
      media: new InputFile(png, 'preview.png'),
      caption: `🖼 <b>معاينة مباشرة</b> · ${tplName} · ${ctx.session.pageSize || 'A4'}\n📝 ${(ctx.session.documentLines || []).length} سطر\n🔤 الخط: ${ctx.session.selectedFont || 'Amiri'} — سيظهر في PDF النهائي`,

      parse_mode: 'HTML',
    });
  } catch { /* silent */ }
}

// ── CALLBACK HANDLER ─────────────────────────────────────────────────────────

export async function handleDocMakerCallback(ctx: BotContext): Promise<boolean> {
  if (!ctx.session || !ctx.from) return false;
  ctx.session.pendingBatchFiles ??= [];

  const data = ctx.callbackQuery?.data;
  if (!data) return false;

  if (data === 'doc_maker_start') {
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim());
    if (!adminIds.includes(ctx.from!.id.toString())) {
      const lock = await getSettings();
      if (lock.locks.btn_doc_maker === true) {
        const u = await User.findOne({ telegramId: ctx.from!.id.toString() }).select('canBypassLocks');
        if (!u?.canBypassLocks) {
          await ctx.answerCallbackQuery({ text: '⚠️ هذا القسم مغلق مؤقتاً.', show_alert: true }).catch(() => {});
          return true;
        }
      }
    }
  }

  const docCallbacks = [
    'doc_maker_start','doc_maker_cancel',
    'doc_type_text','doc_type_image','doc_type_image_locked',
    'doc_compile','doc_continue','doc_finish','doc_export_pdf',
    'doc_export_confirm','doc_export_cancel','doc_back_to_session_keep',
    'align_right','align_center','align_left',
    'style_bold','style_italic','style_underline',
    'size_small','size_normal','size_large',
    'style_quote','style_divider','style_highlight',
    'doc_undo_last','doc_edit_line','doc_view_lines','doc_edit_after','doc_new_page',
    'doc_tpl_confirm','doc_tpl_back',
    'doc_end_session','doc_confirm_end','doc_cancel_end',
    'doc_format_back','doc_custom_size','doc_template_colored',
    'doc_back_to_session',
    'doc_img_align_locked',
    'doc_row_add_image','doc_row_caption_skip','doc_row_finish',
    'doc_colored_approve','doc_colored_back',
  ];
  const isDoc =
    docCallbacks.includes(data) ||
    data.startsWith('doc_bg_') ||
    data.startsWith('doc_txt_') ||
    data.startsWith('doc_tpl_') ||
    data.startsWith('doc_size_') ||
    data.startsWith('doc_font_') ||
    data.startsWith('doc_img_space_') ||
    data.startsWith('doc_img_fmt_') ||
    data.startsWith('doc_img_mask_') ||
    data.startsWith('doc_row_caption_');
  if (!isDoc) return false;

  const telegramId = ctx.from!.id.toString();

  // ── Entry ─────────────────────────────────────────────────────────────────
  if (data === 'doc_maker_start') {
    await ctx.answerCallbackQuery();
    await ctx.reply('📝 <b>صانع المستندات</b>\n\nاختر نوع المستند:', {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📄 مستند نصي', callback_data: 'doc_type_text' }],
          [{ text: '🖼 مستند مصور 🔒', callback_data: 'doc_type_image_locked' }],
          [{ text: '❌ إلغاء', callback_data: 'doc_maker_cancel' }],
        ],
      },
    });
    return true;
  }

  // ── Type Selected → Template Selection ───────────────────────────────────
  if (data === 'doc_type_text' || data === 'doc_type_image') {
    await ctx.answerCallbackQuery();
    ctx.session.docType = data === 'doc_type_text' ? 'text' : 'image';
    ctx.session.docBgColor = undefined;
    ctx.session.docTextColor = undefined;
    await ctx.editMessageText(
      '🎨 <b>اختر نموذج التصميم:</b>\n\n' +
      '1️⃣ كلاسيكي نظيف (إطار رفيع)\n' +
      '2️⃣ احترافي مع رأس وتذييل\n' +
      '3️⃣ زوايا مزخرفة\n' +
      '4️⃣ أشرطة جانبية\n' +
      '5️⃣ إطار مزدوج أنيق\n\n' +
      '<i>اختر النموذج المناسب:</i>',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '1️⃣ كلاسيكي', callback_data: 'doc_tpl_1' }, { text: '2️⃣ احترافي', callback_data: 'doc_tpl_2' }],
            [{ text: '3️⃣ زوايا', callback_data: 'doc_tpl_3' }, { text: '4️⃣ أشرطة', callback_data: 'doc_tpl_4' }],
            [{ text: '5️⃣ إطار مزدوج', callback_data: 'doc_tpl_5' }],
            [{ text: '🎨 تصميم نموذج ملون (احترافي)', callback_data: 'doc_template_colored' }],
            [{ text: '❌ إلغاء', callback_data: 'doc_maker_cancel' }],
          ],
        },
      }
    );
    return true;
  }

  if (data.startsWith('doc_tpl_') && data !== 'doc_tpl_confirm' && data !== 'doc_tpl_back') {
    ctx.session.docBgColor = undefined;
    ctx.session.docTextColor = undefined;
    await ctx.answerCallbackQuery();
    const tplId = parseInt(data.replace('doc_tpl_', ''), 10);
    ctx.session.templateId = tplId;

    let png: Buffer;
    try {
      png = await generatePreviewPNG({ templateId: tplId, pageSize: ctx.session.pageSize || 'A4', lines: [] });
    } catch {
      await ctx.reply('⚠️ تعذّر توليد المعاينة. اختر المقاس:',  { reply_markup: SIZE_KB });
      return true;
    }

    // Delete current text message, send photo
    await ctx.deleteMessage().catch(() => {});
    const sent = await ctx.replyWithPhoto(new InputFile(png, 'preview.png'), {
      caption: `🎨 <b>معاينة النموذج: ${TEMPLATE_NAMES[tplId]}</b>\n\nهذه معاينة مبدئية للإطار. اضغط ✅ موافق للمتابعة.`,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ موافق', callback_data: 'doc_tpl_confirm' },
          { text: '🔙 رجوع', callback_data: 'doc_tpl_back' },
        ]],
      },
    });
    ctx.session.previewMessageId = sent.message_id;
    return true;
  }

  // ── Confirm Template → Show Size Selection (edit caption) ─────────────────
  if (data === 'doc_tpl_confirm') {
    await ctx.answerCallbackQuery();
    await ctx.editMessageCaption({
      caption: '📐 <b>اختر مقاس الصفحة:</b>',
      parse_mode: 'HTML',
      reply_markup: SIZE_KB,
    }).catch(() => {});
    return true;
  }

  // ── Back from Preview → Restore Template List ─────────────────────────────
  if (data === 'doc_tpl_back') {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
    ctx.session.previewMessageId = undefined;
    await ctx.reply(
      '🎨 <b>اختر نموذج التصميم:</b>\n\n' +
      '1️⃣ كلاسيكي · 2️⃣ احترافي · 3️⃣ زوايا · 4️⃣ أشرطة · 5️⃣ إطار مزدوج',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '1️⃣ كلاسيكي', callback_data: 'doc_tpl_1' }, { text: '2️⃣ احترافي', callback_data: 'doc_tpl_2' }],
            [{ text: '3️⃣ زوايا', callback_data: 'doc_tpl_3' }, { text: '4️⃣ أشرطة', callback_data: 'doc_tpl_4' }],
            [{ text: '5️⃣ إطار مزدوج', callback_data: 'doc_tpl_5' }],
            [{ text: '❌ إلغاء', callback_data: 'doc_maker_cancel' }],
          ],
        },
      }
    );
    return true;
  }

  // ── Custom Size → ask for width ──────────────────────────────────────────
  if (data === 'doc_custom_size') {
    try {
      await ctx.answerCallbackQuery();
      ctx.session.awaitingCustomWidth = true;
      ctx.session.awaitingCustomHeight = false;
      ctx.session.customSizeWidth = undefined;
      await ctx.editMessageCaption({
        caption: '📐 <b>مقاس مخصص</b>\n\nأرسل <b>العرض</b> بالسنتيمتر (مثال: 21):',
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'doc_tpl_back' }]] },
      }).catch(() => {});
    } catch (e) { console.error('[DocMaker] custom_size error:', e); }
    return true;
  }

  // ── Standard Size Selected → Show Font Menu ───────────────────────────
  if (data.startsWith('doc_size_')) {
    await ctx.answerCallbackQuery();
    ctx.session.pageSize = data.replace('doc_size_', '');
    ctx.session.awaitingCustomWidth = false;
    ctx.session.awaitingCustomHeight = false;

    await ctx.editMessageCaption({
      caption:
        '🔤 <b>اختر خط المستند:</b>\n\nسيُطبَّق هذا الخط على كامل النص في PDF.',
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✒️ Omnia Serif',               callback_data: 'doc_font_Omnia' }],
          [{ text: '✨ Modern Pro 2024',           callback_data: 'doc_font_ModernPro' }],
          [{ text: '🎙 خط إذاعة ثمانية',       callback_data: 'doc_font_Thamanya' }],
          [{ text: '📜 الخط الرسمي — Amiri', callback_data: 'doc_font_Amiri' }],
          [{ text: '📱 Cairo العصري',          callback_data: 'doc_font_Cairo' }],
          [{ text: '❌ إلغاء',                      callback_data: 'doc_cancel_end' }],
        ],
      },
    }).catch(() => {});
    return true;
  }

  // ── Font Selected → Start Session ────────────────────────────────────
  if (data.startsWith('doc_font_')) {
    await ctx.answerCallbackQuery();
    ctx.session.selectedFont = data.replace('doc_font_', '');
    ctx.session.docState = 'active';
    ctx.session.isInDocMaker = true;
    ctx.session.documentLines = [];
    ctx.session.tempLine = null;
    ctx.session.tempFormatting = null;
    ctx.session.tempImage = undefined;

    // Update preview photo caption, remove keyboard
    if (ctx.session.previewMessageId && ctx.chat) {
      try {
        const png = await generatePreviewPNG({
          templateId: ctx.session.templateId || 1,
          pageSize: ctx.session.pageSize || 'A4',
          lines: [],
          selectedFont: ctx.session.selectedFont,
        });
        const tplName = TEMPLATE_NAMES[ctx.session.templateId || 1] || '';
        await ctx.api.editMessageMedia(ctx.chat.id, ctx.session.previewMessageId, {
          type: 'photo',
          media: new InputFile(png, 'preview.png'),
          caption: `🖼 <b>معاينة مباشرة</b> · ${tplName} · ${ctx.session.pageSize || 'A4'}\n📝 0 سطر`,
          parse_mode: 'HTML',
        });
      } catch { /* silent */ }
    }

    await ctx.reply(
      '✅ <b>بدأت الجلسة بنجاح!</b>\n\n' +
      '📝 أرسل نصاً أو صورة لإضافتها للمستند.\n\n' +
      '⚠️ <i>البوت الآن في وضع المستند — لن يستجيب لأوامر تحسين الصور حتى تنهي الجلسة.</i>',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📥 إنهاء وتصدير PDF', callback_data: 'doc_compile' }],
          ],
        },
      }
    );
    await ctx.reply(DOC_MAKER_INSTRUCTION, { parse_mode: 'HTML', reply_markup: COMPILE_KB });
    return true;
  }

  // ── Image: Spacing selection ────────────────────────────────────────
  if (data.startsWith('doc_img_space_')) {
    if (!ctx.session.tempImage?.fileId) {
      await ctx.answerCallbackQuery({ text: '⚠️ انتهت الجلسة، أرسل الصورة مجدداً.' });
      return true;
    }
    const val = data.replace('doc_img_space_', '');
    if (val === 'custom') {
      ctx.session.docState = 'awaiting_custom_img_lines';
      await ctx.editMessageText(
        '✍️ <b>أرسل عدد الأسطر</b> (رقم بين 1 و50):',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '🔙 إلغاء', callback_data: 'doc_back_to_session' }
            ]]
          }
        }
      );
      return true;
    }
    ctx.session.tempImage.lines = parseInt(val);
    await showImageFormatMenu(ctx);
    return true;
  }

  // ── Image: Format (align) + Mask handlers ───────────────────────────
  if (data.startsWith('doc_img_fmt_') || data.startsWith('doc_img_mask_')) {
    if (!ctx.session.tempImage?.fileId) {
      await ctx.answerCallbackQuery({ text: '⚠️ انتهت الجلسة، أرسل الصورة مجدداً.' });
      return true;
    }

    if (data.startsWith('doc_img_fmt_')) {
      ctx.session.tempImage.align = data.replace('doc_img_fmt_', '') as 'right' | 'center' | 'left';
    }
    if (data.startsWith('doc_img_mask_')) {
      ctx.session.tempImage.mask = data.replace('doc_img_mask_', '') as 'square' | 'rounded' | 'circle';
    }

    // CRITICAL: Only save when BOTH values are explicitly set
    const bothSelected = !!ctx.session.tempImage.align && !!ctx.session.tempImage.mask;

    if (!bothSelected) {
      await ctx.answerCallbackQuery(); // required silent ACK

      const alignVal  = ctx.session.tempImage?.align;
      const maskVal   = ctx.session.tempImage?.mask;
      const alignEmoji: Record<string, string> = { right: '➡️', center: '↔️', left: '⬅️' };
      const maskEmoji:  Record<string, string> = { circle: '⭕', rounded: '🔲', square: '⬛' };

      const alignStatus = alignVal
        ? `${alignEmoji[alignVal] ?? ''} <b>${alignVal}</b> ✅`
        : '⬜ لم يُختَر بعد';
      const maskStatus = maskVal
        ? `${maskEmoji[maskVal] ?? ''} <b>${maskVal}</b> ✅`
        : '⬜ لم يُختَر بعد';

      const missingItem = !alignVal ? 'المحاذاة' : 'شكل الإطار';

      await ctx.editMessageText(
        '🎨 <b>تنسيق الصورة:</b>\n\n' +
        `📐 المحاذاة: ${alignStatus}\n` +
        `🖼 الإطار: ${maskStatus}\n\n` +
        `<i>اختر ${missingItem} لإتمام الإضافة:</i>`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '➡️ يمين',  callback_data: 'doc_img_fmt_right' },
                { text: '↔️ وسط',  callback_data: 'doc_img_fmt_center' },
                { text: '⬅️ يسار', callback_data: 'doc_img_fmt_left' },
              ],
              [
                { text: '⭕ دائري',       callback_data: 'doc_img_mask_circle' },
                { text: '🔲 حواف ناعمة', callback_data: 'doc_img_mask_rounded' },
                { text: '⬛ مربع عادي',  callback_data: 'doc_img_mask_square' },
              ],
              [{ text: '🔙 إلغاء الصورة', callback_data: 'doc_back_to_session' }],
            ],
          },
        }
      );
      return true;
    }

    // Both selected → push image line
    ctx.session.documentLines = ctx.session.documentLines || [];
    ctx.session.documentLines.push({
      text: '',
      type: 'image',
      fileId: ctx.session.tempImage.fileId,
      imageLines: ctx.session.tempImage.lines || 5,
      align: ctx.session.tempImage.align ?? 'center',

      imageMask: ctx.session.tempImage.mask,
    });

    ctx.session.tempImage = undefined;
    ctx.session.docState = 'active';

    await ctx.editMessageText(
      '✅ <b>تمت إضافة الصورة للمستند!</b>\n\nأرسل المزيد من النصوص أو الصور، أو اضغط تصدير.',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 تصدير الآن', callback_data: 'doc_export_pdf' }],
          ],
        },
      }
    );
    await refreshPreview(ctx);
    return true;
  }

  // ── Image: Back / cancel ────────────────────────────────────────────
  if (data === 'doc_back_to_session') {
    await ctx.answerCallbackQuery();
    ctx.session.tempImage = undefined;
    ctx.session.docState = 'active';
    await ctx.editMessageText(
      '↩️ <b>تم الإلغاء.</b>\n\nأرسل نصاً أو صورة، أو اضغط تصدير.',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 تصدير الآن', callback_data: 'doc_export_pdf' }],
          ],
        },
      }
    );
    return true;
  }

  // ── Cancel ─────────────────────────────────────────────────────────────────────────────
  if (data === 'doc_maker_cancel') {
    await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' });
    ctx.session.isInDocMaker = false;
    ctx.session.documentLines = [];
    ctx.session.tempLine = null;
    ctx.session.tempFormatting = null;
    ctx.session.previewMessageId = undefined;
    await ctx.deleteMessage().catch(() => {});
    return true;
  }

  if (data === 'align_right' || data === 'align_center' || data === 'align_left') {
    await ctx.answerCallbackQuery();
    const tempLine = ctx.session.tempLine;
    const tempFormatting = ctx.session.tempFormatting;
    if (!tempLine || !tempFormatting) {
      await ctx.editMessageText('⚠️ انتهت صلاحية النص. أرسل النص مجدداً.').catch(() => {});
      return true;
    }
    const alignMap: Record<string, 'right' | 'center' | 'left'> = {
      align_right: 'right', align_center: 'center', align_left: 'left',
    };
    if (!ctx.session.documentLines) ctx.session.documentLines = [];
    const pageSize = ctx.session.pageSize || 'A4';
    const chosenAlign = alignMap[data];
    const finalLine: DocLine = { text: tempLine, align: chosenAlign, ...tempFormatting };

    if (ctx.session.editingLineIndex !== undefined) {
      const idx = ctx.session.editingLineIndex;
      if (idx >= 0 && idx < ctx.session.documentLines.length) {
        ctx.session.documentLines[idx] = finalLine;
      }
      ctx.session.editingLineIndex = undefined;
      ctx.session.awaitingLineEditText = false;
      ctx.session.tempLine = null;
      ctx.session.tempFormatting = null;
      const lines = ctx.session.documentLines;
      const preview = lines.map((l, i) => `${i+1}. ${l.text ? l.text.substring(0,30)+'...' : '[فارغ]'}`).join('\n');
      await ctx.editMessageText(`✅ تم تعديل السطر!\n\n📄 <b>المستند:</b>\n${preview}`, { parse_mode: 'HTML', reply_markup: controlPanel() }).catch(() => {});
      await refreshPreview(ctx);
      return true;
    }

    const wrapped = smartWrap(finalLine.text, pageSize);
    for (const chunk of wrapped) {
      ctx.session.documentLines.push({ ...finalLine, text: chunk });
    }
    ctx.session.tempLine = null;
    ctx.session.tempFormatting = null;

    const lines = ctx.session.documentLines;
    const preview = lines.map((l, i) => `${i+1}. ${l.text ? l.text.substring(0,30)+'...' : '[فارغ]'}`).join('\n');
    await ctx.editMessageText(`✅ تمت إضافة النص\n\n📄 <b>المستند:</b>\n${preview}`, { parse_mode: 'HTML', reply_markup: controlPanel() }).catch(() => {});
    await refreshPreview(ctx);
    return true;
  }

  // ── Smart Export Confirmation ──────────────────────────────────────────────
  if (data === 'doc_export_pdf') {
    const lines = ctx.session.documentLines || [];

    const totalLineCount = lines.reduce((acc, l) => {
      return acc + (l.type === 'image' ? (l.imageLines || 5) : 1);
    }, 0);
    const estimatedPages = Math.max(1, Math.ceil(totalLineCount / 30));

    if (estimatedPages > 40) {
      await ctx.editMessageText(
        '🚫 <b>المستند كبير جداً!</b>\n\n' +
        `📄 عدد الصفحات المتوقع: <b>${estimatedPages} صفحة</b>\n\n` +
        'الحد المسموح به هو 40 صفحة.\n' +
        'للحصول على صلاحية تصدير حتى 1000 صفحة تواصل مع المطور.',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '🔙 العودة للجلسة', callback_data: 'doc_back_to_session_keep' }
            ]]
          }
        }
      );
      return true;
    }

    let cost: number;
    if (estimatedPages <= 3)       cost = 1;
    else if (estimatedPages <= 5)  cost = 2;
    else if (estimatedPages <= 10) cost = 3;
    else if (estimatedPages <= 20) cost = 4;
    else                           cost = 5;

    ctx.session.pendingExportCost = cost;
    ctx.session.pendingExportPages = estimatedPages;

    await ctx.editMessageText(
      '📤 <b>تأكيد التصدير</b>\n\n' +
      `📄 مستندك مكوّن من <b>~${estimatedPages} صفحة</b>\n` +
      `💳 سيتم خصم <b>${cost} محاولة</b> من رصيدك\n\n` +
      'هل أنت موافق على المتابعة؟',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: `✅ موافق — خصم ${cost} محاولة`, callback_data: 'doc_export_confirm' },
            { text: '❌ إلغاء', callback_data: 'doc_export_cancel' }
          ]]
        }
      }
    );
    return true;
  }

  if (data === 'doc_export_confirm') {
    const cost = ctx.session.pendingExportCost || 1;

    // Fetch real user from database
    const user = await User.findOne({ telegramId });
    if (!user) return true;

    if (user.dailyQuota < cost) {
      await ctx.editMessageText(
        '❌ <b>رصيدك غير كافٍ!</b>\n\n' +
        `💳 رصيدك الحالي: <b>${user.dailyQuota} محاولة</b>\n` +
        `💸 المطلوب: <b>${cost} محاولات</b>\n\n` +
        'أضف رصيداً للمتابعة.',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '🔙 العودة', callback_data: 'doc_back_to_session_keep' }
            ]]
          }
        }
      );
      return true;
    }

    // Deduct attempts from real database
    await User.updateOne({ telegramId }, { $inc: { dailyQuota: -cost } });

    await ctx.editMessageText(
      '⏳ <b>جاري إنشاء ملف PDF...</b>',
      { parse_mode: 'HTML' }
    );

    try {
      const { generateDocumentFromLines } = await import('../../services/pdfGeneratorService');
      const safeLines = (ctx.session.documentLines ?? []).filter(l => l !== null && l !== undefined);
      
      const pdfBuffer = await generateDocumentFromLines(
        safeLines,
        ctx.session.pageSize || 'A4',
        ctx.session.selectedFont || 'Amiri',
        ctx.session.docBgColor,
        ctx.session.docTextColor
      );

      if (!pdfBuffer || pdfBuffer.length === 0) {
        throw new Error('PDF buffer is empty');
      }

      const { incrementGlobalCounter } = await import('../../services/statsService');
      await incrementGlobalCounter();

      const fileName = `document_${Date.now()}.pdf`;
      const { InputFile } = await import('grammy');
      await ctx.replyWithDocument(
        new InputFile(pdfBuffer, fileName),
        {
          caption:
            '✅ <b>مستندك جاهز!</b>\n' +
            `📄 الصفحات: ~${ctx.session.pendingExportPages}\n` +
            `🔤 الخط: ${ctx.session.selectedFont || 'Amiri'}\n` +
            `💳 تم خصم: ${cost} محاولة`,
          parse_mode: 'HTML'
        }
      );

      if (BACKUP_CHANNEL_ID) {
        await ctx.api.sendDocument(BACKUP_CHANNEL_ID, new InputFile(pdfBuffer, fileName), {
          caption: `📦 أرشيف صانع المستندات\n🆔 ${telegramId}`, disable_notification: true,
        }).catch(() => {});
      }

      ctx.session.pendingExportCost = undefined;
      ctx.session.pendingExportPages = undefined;

    } catch (err: any) {
      console.error('[EXPORT] Failed:', err?.message, err?.stack);
      // Refund on failure — real database rollback
      await User.updateOne({ telegramId }, { $inc: { dailyQuota: cost } });
      await ctx.reply(
        '❌ <b>فشل إنشاء المستند.</b>\n' +
        'تم استرداد محاولاتك تلقائياً.\n\n' +
        `<code>${err?.message || 'unknown error'}</code>`,
        { parse_mode: 'HTML' }
      );
    }
    return true;
  }

  if (data === 'doc_export_cancel') {
    ctx.session.pendingExportCost = undefined;
    ctx.session.pendingExportPages = undefined;
    await ctx.editMessageText(
      '↩️ <b>تم إلغاء التصدير.</b>\nيمكنك الاستمرار في تعديل المستند.',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '📤 تصدير PDF', callback_data: 'doc_export_pdf' }
          ]]
        }
      }
    );
    return true;
  }

  if (data === 'doc_back_to_session_keep') {
    ctx.session.pendingExportCost = undefined;
    ctx.session.pendingExportPages = undefined;
    await ctx.editMessageText(
      '↩️ <b>عدت للجلسة.</b>\nأرسل نصاً أو صورة، أو اضغط تصدير.',
      {
        parse_mode: 'HTML',
        reply_markup: controlPanel()
      }
    );
    return true;
  }

  // ── Redo ───────────────────────────────────────────────────────────────────
  if (data === 'doc_undo_last') {
    await ctx.answerCallbackQuery();
    if (!ctx.session.documentLines || ctx.session.documentLines.length === 0) {
      await ctx.editMessageText('⚠️ المستند فارغ!').catch(() => {});
      return true;
    }
    ctx.session.documentLines.pop();
    ctx.session.tempLine = null;
    ctx.session.tempFormatting = null;
    ctx.session.awaitingLineEditIndex = false;
    ctx.session.awaitingLineEditText = false;
    const lines = ctx.session.documentLines;
    if (lines.length === 0) {
      await ctx.editMessageText('🗑️ تم حذف آخر سطر.\n\nالمستند فارغ. أرسل النص البديل:', { reply_markup: COMPILE_KB }).catch(() => {});
    } else {
      const preview = lines.map((l, i) => `${i+1}. ${l.text ? l.text.substring(0,30)+'...' : '[فارغ]'}`).join('\n');
      await ctx.editMessageText(`🗑️ تم حذف آخر سطر.\n\n📄 <b>المستند:</b>\n${preview}`, { parse_mode: 'HTML', reply_markup: controlPanel() }).catch(() => {});
    }
    await refreshPreview(ctx);
    return true;
  }

  // ── New Page ───────────────────────────────────────────────────────────────
  if (data === 'doc_new_page') {
    await ctx.answerCallbackQuery();
    if (!ctx.session.documentLines) ctx.session.documentLines = [];
    ctx.session.documentLines.push({ text: '---PAGE_BREAK---', align: 'right' });
    ctx.session.tempLine = null;
    ctx.session.tempFormatting = null;
    await ctx.reply('✅ تم حفظ الصفحة. ابدأ كتابة الصفحة التالية:', { reply_markup: controlPanel() });
    return true;
  }

  // ── Edit Line ──────────────────────────────────────────────────────────────
  if (data === 'doc_edit_line') {
    await ctx.answerCallbackQuery();
    ctx.session.awaitingLineEditIndex = true;
    await ctx.reply('✏️ أرسل <b>رقم السطر</b> الذي تريد تعديله:', { parse_mode: 'HTML' });
    return true;
  }

  // ── Edit After Export ──────────────────────────────────────────────────────
  if (data === 'doc_edit_after') {
    await ctx.answerCallbackQuery();
    ctx.session.isInDocMaker = true;
    ctx.session.awaitingLineEditIndex = true;
    const lines = ctx.session.documentLines || [];
    const preview = lines.map((l, i) => `${i+1}. ${l.text || '[فارغ]'}`).join('\n');
    await ctx.reply(`📋 <b>أسطر المستند:</b>\n\n${preview}\n\n✏️ أرسل <b>رقم السطر</b>:`, { parse_mode: 'HTML' });
    return true;
  }

  // ── View Lines ─────────────────────────────────────────────────────────────
  if (data === 'doc_view_lines') {
    await ctx.answerCallbackQuery();
    const lines = ctx.session.documentLines || [];
    if (lines.length === 0) { await ctx.reply('⚠️ المستند فارغ.'); return true; }
    const fullText = lines.map((l, i) => `${i+1}. ${l.text || '[فارغ]'}`).join('\n');
    await ctx.reply(`📋 <b>محتوى المستند:</b>\n\n${fullText}`, { parse_mode: 'HTML' });
    return true;
  }

  // ── Continue ───────────────────────────────────────────────────────────────
  if (data === 'doc_continue') {
    await ctx.answerCallbackQuery();
    ctx.session.tempLine = null;
    ctx.session.tempFormatting = null;
    await ctx.editMessageReplyMarkup(undefined).catch(() => {});
    await ctx.reply(DOC_MAKER_INSTRUCTION, { parse_mode: 'HTML', reply_markup: COMPILE_KB });
    return true;
  }

  // ── Finish ─────────────────────────────────────────────────────────────────
  if (data === 'doc_finish') {
    await ctx.answerCallbackQuery();
    ctx.session.isInDocMaker = false;
    ctx.session.documentLines = [];
    ctx.session.tempLine = null;
    ctx.session.tempFormatting = null;
    ctx.session.awaitingLineEditIndex = false;
    ctx.session.awaitingLineEditText = false;
    ctx.session.editingLineIndex = undefined;
    ctx.session.previewMessageId = undefined;
    await ctx.editMessageText('✅ تم إنهاء المستند. يمكنك البدء من جديد.').catch(() => {});
    return true;
  }

  // ── Formatting toggles ─────────────────────────────────────────────────────
  const fmtToggles: Record<string, (fmt: any) => any> = {
    style_bold:       fmt => ({ ...fmt, bold: !fmt.bold }),
    style_italic:     fmt => ({ ...fmt, italic: !fmt.italic }),
    style_underline:  fmt => ({ ...fmt, underline: !fmt.underline }),
    size_small:       fmt => ({ ...fmt, size: 'small'  }),
    size_normal:      fmt => ({ ...fmt, size: 'normal' }),
    size_large:       fmt => ({ ...fmt, size: 'large'  }),
    style_quote:      fmt => ({ ...fmt, style: fmt.style === 'quote'     ? 'normal' : 'quote'     }),
    style_divider:    fmt => ({ ...fmt, style: fmt.style === 'divider'   ? 'normal' : 'divider'   }),
    style_highlight:  fmt => ({ ...fmt, style: fmt.style === 'highlight' ? 'normal' : 'highlight' }),
  };
  if (fmtToggles[data]) {
    try {
      await ctx.answerCallbackQuery();
      if (!ctx.session.tempLine || !ctx.session.tempFormatting) {
        await ctx.answerCallbackQuery({ text: '⚠️ أرسل النص أولاً', show_alert: true }).catch(() => {});
        return true;
      }
      ctx.session.tempFormatting = fmtToggles[data](ctx.session.tempFormatting);
      await ctx.editMessageReplyMarkup(buildFormattingKeyboard(ctx.session.tempFormatting) as any).catch(() => {});
    } catch (e) {
      console.error('[DocMaker] fmt toggle error:', e);
    }
    return true;
  }

  // ── Format Back Button ───────────────────────────────────────────────────────
  if (data === 'doc_format_back') {
    try {
      await ctx.answerCallbackQuery();
      ctx.session.tempLine = null;
      ctx.session.tempFormatting = null;
      await ctx.deleteMessage().catch(() => {});
      await ctx.reply('↩️ تم الإلغاء. أرسل النص الذي تريد إضافته:');
    } catch (e) { console.error('[DocMaker] format_back error:', e); }
    return true;
  }

  // ── End Session ───────────────────────────────────────────────────────────
  if (data === 'doc_end_session') {
    try {
      await ctx.answerCallbackQuery();
      await ctx.reply(
        '⚠️ سيتم حذف جميع بيانات مشروعك نهائياً. هل أنت متأكد؟',
        { reply_markup: { inline_keyboard: [[
          { text: '✅ نعم، إنهاء', callback_data: 'doc_confirm_end' },
          { text: '❌ لا، العودة', callback_data: 'doc_cancel_end' },
        ]] } }
      );
    } catch (e) { console.error('[DocMaker] end_session error:', e); }
    return true;
  }

    if (data === 'doc_confirm_end') {
    try {
      await ctx.answerCallbackQuery();
      ctx.session.documentLines = [];
      ctx.session.tempLine = null;
      ctx.session.tempFormatting = null;
      ctx.session.docType = undefined;
      ctx.session.templateId = undefined;
      ctx.session.pageSize = undefined;
      ctx.session.isInDocMaker = false;
      ctx.session.editingLineIndex = undefined;
      ctx.session.awaitingLineEditIndex = false;
      ctx.session.awaitingLineEditText = false;
      ctx.session.previewMessageId = undefined;
      await ctx.editMessageText('✅ تم إنهاء الجلسة. يمكنك البدء من جديد.', { reply_markup: undefined }).catch(() => {});
    } catch (e) { console.error('[DocMaker] confirm_end error:', e); }
    return true;
  }

  if (data === 'doc_cancel_end') {
    try {
      await ctx.answerCallbackQuery();
      await ctx.deleteMessage().catch(() => {});
    } catch (e) { console.error('[DocMaker] cancel_end error:', e); }
    return true;
  }

  // 1. Trigger Background Color Selection
  if (data === 'doc_template_colored') {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      '🎨 <b>تصميم نموذج ملون (خطوة 1/2):</b>\n\nاختر <b>لون خلفية</b> المستند (ألوان هادئة واحترافية):',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'أسود هادئ 🖤', callback_data: 'doc_bg_#1A1A1A' },
              { text: 'رمادي فاتح 🤍', callback_data: 'doc_bg_#F0F2F5' }
            ],
            [
              { text: 'كحلي ليلي 🌌', callback_data: 'doc_bg_#1B263B' },
              { text: 'مريمية هادئ 🌿', callback_data: 'doc_bg_#8F9779' }
            ],
            [
              { text: 'بيج كلاسيكي 📜', callback_data: 'doc_bg_#FDF5E6' },
              { text: 'عنابي داكن 🍷', callback_data: 'doc_bg_#4A232C' }
            ],
            [{ text: '🔙 رجوع للنماذج', callback_data: 'doc_type_text' }]
          ]
        }
      }
    );
    return true;
  }

  // 2. Save Background & Trigger Text Color Selection
  if (data.startsWith('doc_bg_')) {
    await ctx.answerCallbackQuery();
    ctx.session.docBgColor = data.replace('doc_bg_', '');
    
    await ctx.editMessageText(
      '🔤 <b>تصميم نموذج ملون (خطوة 2/2):</b>\n\nاختر <b>لون النص</b> المتناسق مع الخلفية:',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'أبيض ناصع ⚪', callback_data: 'doc_txt_#FFFFFF' },
              { text: 'أسود فاحم ⚫', callback_data: 'doc_txt_#000000' }
            ],
            [
              { text: 'رمادي داكن 🔘', callback_data: 'doc_txt_#333333' },
              { text: 'ذهبي فاخر ✨', callback_data: 'doc_txt_#D4AF37' }
            ],
            [
              { text: 'أزرق ملكي 🔵', callback_data: 'doc_txt_#1D3557' },
              { text: 'أحمر قاني 🔴', callback_data: 'doc_txt_#8B0000' }
            ],
            [{ text: '🔙 رجوع لاختيار الخلفية', callback_data: 'doc_template_colored' }]
          ]
        }
      }
    );
    return true;
  }

  // 3. Save Text Color → Bulletproof color preview via sharp { create }
  if (data.startsWith('doc_txt_')) {
    await ctx.answerCallbackQuery();
    ctx.session.docTextColor = data.replace('doc_txt_', '');
    (ctx.session as any).selectedTemplate = 'colored';

    const bgColor  = ctx.session.docBgColor  || '#FFFFFF';
    const txtColor = ctx.session.docTextColor || '#000000';

    // Bulletproof: create solid background via { create }, composite SVG text on top.
    // sharp does NOT support %-based SVG dims reliably — always use absolute px.
    const W = 600, H = 800;
    const midY = Math.round(H * 0.45);
    const subY = Math.round(H * 0.56);
    const svgText = [
      `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`,
      `  <text x="${W/2}" y="${midY}" font-family="sans-serif" font-size="38" font-weight="bold"`,
      `        fill="${txtColor}" text-anchor="middle" dominant-baseline="middle">معاينة النموذج الملون</text>`,
      `  <text x="${W/2}" y="${subY}" font-family="sans-serif" font-size="18"`,
      `        fill="${txtColor}" text-anchor="middle" dominant-baseline="middle" opacity="0.75">خلفية: ${bgColor}  ·  نص: ${txtColor}</text>`,
      `</svg>`,
    ].join('\n');

    try {
      const sharpLib = (await import('sharp')).default;

      // Parse hex color → RGBA for sharp background
      const hex = bgColor.replace('#', '');
      const r = parseInt(hex.slice(0, 2), 16) || 0;
      const g = parseInt(hex.slice(2, 4), 16) || 0;
      const b = parseInt(hex.slice(4, 6), 16) || 0;

      const previewBuffer = await sharpLib({
        create: { width: W, height: H, channels: 4 as const, background: { r, g, b, alpha: 1 } },
      })
        .composite([{ input: Buffer.from(svgText), blend: 'over' }])
        .png()
        .toBuffer();

      await ctx.deleteMessage().catch(() => {});
      const sent = await ctx.replyWithPhoto(
        new InputFile(previewBuffer, 'color_preview.png'),
        {
          caption:
            `🎨 <b>معاينة النموذج: ملون</b>\n\n` +
            `<b>خلفية:</b> <code>${bgColor}</code>  ·  <b>نص:</b> <code>${txtColor}</code>\n\n` +
            `هذه معاينة مبدئية للألوان. اضغط ✅ موافق للمتابعة.`,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[
            { text: '✅ موافق', callback_data: 'doc_colored_approve' },
            { text: '🔙 رجوع',  callback_data: 'doc_colored_back'    },
          ]]},
        }
      );
      // Store as previewMessageId so native doc_custom_size can editMessageCaption on it
      ctx.session.previewMessageId = sent.message_id;
    } catch (err) {
      console.error('[PREVIEW] Color preview failed:', err);
      await ctx.editMessageText(
        `✅ <b>تم حفظ الألوان</b> (خلفية: ${bgColor} · نص: ${txtColor})\n\nاضغط متابعة للمتابعة:`,
        {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[
            { text: 'متابعة ➡️', callback_data: 'doc_colored_approve' },
          ]]},
        }
      ).catch(() => ctx.reply(`✅ تم حفظ الألوان. اضغط متابعة:`));
    }
    return true;
  }

  // 4. Colored approve → EXACTLY the same as doc_tpl_confirm: editMessageCaption + SIZE_KB
  if (data === 'doc_colored_approve') {
    await ctx.answerCallbackQuery();
    // Use editMessageCaption on the preview photo (same as native doc_tpl_confirm flow)
    await ctx.editMessageCaption({
      caption: '📐 <b>اختر مقاس الصفحة:</b>',
      parse_mode: 'HTML',
      reply_markup: SIZE_KB,
    }).catch(() => {});
    return true;
  }

  // 5. Colored back → re-show text color selection
  if (data === 'doc_colored_back') {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(
      '🔤 <b>تصميم نموذج ملون (خطوة 2/2):</b>\n\nاختر <b>لون النص</b> المتناسق مع الخلفية:',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'أبيض ناصع ⚪', callback_data: 'doc_txt_#FFFFFF' },
              { text: 'أسود فاحم ⚫', callback_data: 'doc_txt_#000000' },
            ],
            [
              { text: 'رمادي داكن 🔘', callback_data: 'doc_txt_#333333' },
              { text: 'ذهبي فاخر ✨',  callback_data: 'doc_txt_#D4AF37' },
            ],
            [
              { text: 'أزرق ملكي 🔵', callback_data: 'doc_txt_#1D3557' },
              { text: 'أحمر قاني 🔴', callback_data: 'doc_txt_#8B0000' },
            ],
            [{ text: '🔙 رجوع لاختيار الخلفية', callback_data: 'doc_template_colored' }],
          ],
        },
      }
    );
    return true;
  }

  // ── A) Locked alignment (used in row) ────────────────────────────────────
  if (data === 'doc_img_align_locked') {
    await ctx.answerCallbackQuery({ text: '🔒 هذه المحاذاة مستخدمة في هذا السطر', show_alert: true });
    return true;
  }

  // ── B) Alignment / Mask buttons (set on tempImage) ───────────────────────
  if (data.startsWith('doc_img_fmt_')) {
    if (!ctx.session.tempImage?.fileId) {
      await ctx.answerCallbackQuery({ text: '⚠️ لا توجد صورة نشطة', show_alert: true });
      return true;
    }
    const align = data.replace('doc_img_fmt_', '') as 'right' | 'center' | 'left';
    ctx.session.tempImage.align = align;
    await ctx.answerCallbackQuery({ text: '✅ تم تحديد المحاذاة' });
    await showImageFormatMenu(ctx);
    return true;
  }

  if (data.startsWith('doc_img_mask_')) {
    if (!ctx.session.tempImage?.fileId) {
      await ctx.answerCallbackQuery({ text: '⚠️ لا توجد صورة نشطة', show_alert: true });
      return true;
    }
    const mask = data.replace('doc_img_mask_', '') as 'circle' | 'rounded' | 'square';
    ctx.session.tempImage.mask = mask;
    await ctx.answerCallbackQuery({ text: '✅ تم تحديد شكل الإطار' });
    await showImageFormatMenu(ctx);
    return true;
  }

  // ── C) Add current image to row, await next image ────────────────────
  if (data === 'doc_row_add_image') {
    if (!ctx.session.tempImage?.fileId || !ctx.session.tempImage.align || !ctx.session.tempImage.mask) {
      await ctx.answerCallbackQuery({ text: '⚠️ أكمل إعداد الصورة الحالية أولاً', show_alert: true });
      return true;
    }
    const rowImages = ctx.session.rowImages || [];
    if (rowImages.length >= 3) {
      await ctx.answerCallbackQuery({ text: '⚠️ لا يمكن إضافة أكثر من 3 صور في سطر واحد', show_alert: true });
      return true;
    }
    rowImages.push({
      fileId: ctx.session.tempImage.fileId,
      lines:  ctx.session.tempImage.lines || 5,
      align:  ctx.session.tempImage.align!,
      mask:   ctx.session.tempImage.mask!,
    });
    ctx.session.rowImages = rowImages;
    ctx.session.tempImage = undefined;
    ctx.session.awaitingNextRowImage = true;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `✅ تم حفظ الصورة ${rowImages.length}\n\n🖼 أرسل الصورة الإضافية الآن:\n` +
      `تنبيه: يجب ألا يتجاوز حجمها ${rowImages[0].lines} سطر (نفس حجم الأولى)`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
        { text: '🔙 إلغاء وإنهاء السطر', callback_data: 'doc_row_finish' }
      ]]}}
    );
    return true;
  }

  // ── D) Request caption for a specific row image ────────────────────
  if (data.startsWith('doc_row_caption_') && data !== 'doc_row_caption_skip') {
    const rawId = data.replace('doc_row_caption_', '');
    
    if (rawId === 'temp') {
      ctx.session.tempCaptionTarget = 'temp';
      (ctx.session as any).docState = 'awaiting_row_caption';
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        `📝 أرسل النص الذي تريده تحت الصورة الحالية:`,
        { reply_markup: { inline_keyboard: [[
          { text: '❌ تخطي بدون تسمية', callback_data: 'doc_row_caption_skip' }
        ]]}}
      );
      return true;
    }

    const idx = parseInt(rawId, 10);
    const rowImages = ctx.session.rowImages || [];
    if (isNaN(idx) || idx < 0 || idx >= rowImages.length) {
      await ctx.answerCallbackQuery({ text: '⚠️ صورة غير موجودة', show_alert: true });
      return true;
    }
    ctx.session.tempCaptionTarget = idx;
    (ctx.session as any).docState = 'awaiting_row_caption';
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `📝 أرسل النص الذي تريده تحت الصورة ${idx + 1}:`,
      { reply_markup: { inline_keyboard: [[
        { text: '❌ تخطي بدون تسمية', callback_data: 'doc_row_caption_skip' }
      ]]}}
    );
    return true;
  }

  // ── E) Skip caption ──────────────────────────────────────────
  if (data === 'doc_row_caption_skip') {
    ctx.session.tempCaptionTarget = undefined;
    (ctx.session as any).docState = 'active';
    await ctx.answerCallbackQuery();
    await showImageFormatMenu(ctx);
    return true;
  }

  // ── F) Finish the row and commit to documentLines ──────────────────
  if (data === 'doc_row_finish') {
    const rowImages = ctx.session.rowImages || [];
    if (ctx.session.tempImage?.fileId && ctx.session.tempImage.align && ctx.session.tempImage.mask) {
      rowImages.push({
        fileId: ctx.session.tempImage.fileId,
        lines:  ctx.session.tempImage.lines || 5,
        align:  ctx.session.tempImage.align,
        mask:   ctx.session.tempImage.mask,
        caption: ctx.session.tempImage.caption
      });
    }
    
    if (rowImages.length === 0) {
      await ctx.answerCallbackQuery({ text: '⚠️ لا توجد صور لإضافتها', show_alert: true });
      return true;
    }
    
    // Safely save to document lines
    ctx.session.documentLines = ctx.session.documentLines || [];
    ctx.session.documentLines.push({ 
      type: 'image_row', 
      rowImages: rowImages,
      imageLines: rowImages[0].lines, // Fallback line height
      align: 'center' 
    } as any);
    
    // Wipe all temporary row data
    ctx.session.rowImages = undefined;
    ctx.session.tempImage = undefined;
    ctx.session.awaitingNextRowImage = false;
    ctx.session.tempCaptionTarget = undefined;
    ctx.session.docState = 'active';
    
    await ctx.answerCallbackQuery({ text: '✅ تمت إضافة السطر للمستند!' });
    await ctx.deleteMessage().catch(() => {});
    
    const lines = ctx.session.documentLines;
    const preview = lines.map((l, i) => {
      if (l.type === 'image') return `${i+1}. 🖼 [صورة]`;
      if (l.type === 'image_row' || l.rowImages) return `${i+1}. 🖼 [سطر صور]`;
      return `${i+1}. ${l.text ? l.text.substring(0,30)+'...' : '[فارغ]'}`;
    }).join('\n');
    await ctx.reply(`✅ تمت إضافة سطر الصور للمستند\n\n📄 <b>المستند:</b>\n${preview}`, { parse_mode: 'HTML', reply_markup: controlPanel() });
    await refreshPreview(ctx);
    return true;
  }

  return false;
}

// ── MESSAGE HANDLER ────────────────────────────────────────────────────────────

export async function handleDocMakerMessage(ctx: BotContext): Promise<boolean> {
  if (!ctx.session || !ctx.from) return false;

  // If tempImage exists and message is a number → it is a line count input
  if (ctx.session?.tempImage?.fileId && ctx.message?.text) {
    const num = parseInt(ctx.message.text.trim());
    if (!isNaN(num) && num >= 1 && num <= 50) {
      ctx.session.tempImage.lines = num;
      ctx.session.docState = 'active';
      await showImageFormatMenu(ctx);
      return true;
    }
    // Non-number text while image pending → block it
    await ctx.reply(
      '⚠️ <b>أكمل إعدادات الصورة أولاً</b>\nأو اضغط إلغاء.',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '🔙 إلغاء الصورة والعودة', callback_data: 'doc_back_to_session' }
          ]]
        }
      }
    );
    return true;
  }

  const text = ctx.message?.text?.trim();
  if (!text || text.startsWith('/')) return false;

  // HARD STOP: never process text as doc-content during image configuration
  if (ctx.session?.docState === 'awaiting_custom_img_lines') {
    return false; // number input is handled by the session trap — do not touch it
  }
  if (ctx.session?.docState === 'active' && ctx.session?.tempImage?.fileId) {
    return false; // user has a pending image — do not open text format menu
  }




  // ── Custom size: step 1 — awaiting width (cm) ────────────────────────────
  if (ctx.session.awaitingCustomWidth) {
    try {
      const w = parseFloat(text);
      if (isNaN(w) || w < 5 || w > 200) {
        await ctx.reply('⚠️ الرجاء إرسال رقم صحيح بين 5 و 200');
        return true;
      }
      ctx.session.customSizeWidth = w;
      ctx.session.awaitingCustomWidth = false;
      ctx.session.awaitingCustomHeight = true;
      await ctx.reply('📐 أرسل <b>الارتفاع</b> بالسنتيمتر (مثال: 29.7):', { parse_mode: 'HTML' });
    } catch (e) { console.error('[DocMaker] custom width error:', e); }
    return true;
  }

  // ── Custom size: step 2 — awaiting height (cm) ──────────────────────────
  if (ctx.session.awaitingCustomHeight) {
    try {
      const h = parseFloat(text);
      if (isNaN(h) || h < 5 || h > 200) {
        await ctx.reply('⚠️ الرجاء إرسال رقم صحيح بين 5 و 200');
        return true;
      }
      const wCm = ctx.session.customSizeWidth!;
      const CM_TO_PT = 28.35;
      const label = `${wCm}×${h} سم`;

      ctx.session.awaitingCustomHeight = false;
      ctx.session.customSizeDims = { width: wCm * CM_TO_PT, height: h * CM_TO_PT, label };
      ctx.session.pageSize = label;
      ctx.session.isInDocMaker = true;
      ctx.session.documentLines = [];
      ctx.session.tempLine = null;
      ctx.session.tempFormatting = null;

      await ctx.reply(
        `✅ <b>تم تحديد المقاس: ${label}</b>\n\nابدأ الكتابة:`,
        { parse_mode: 'HTML', reply_markup: COMPILE_KB }
      );
      await ctx.reply(DOC_MAKER_INSTRUCTION, { parse_mode: 'HTML' });
    } catch (e) { console.error('[DocMaker] custom height error:', e); }
    return true;
  }

  // For all remaining steps the user must be inside an active doc maker session
  if (!ctx.session.isInDocMaker) return false;

  // Awaiting line index to edit
  if (ctx.session.awaitingLineEditIndex) {
    const idx = parseInt(text, 10) - 1;
    const lines = ctx.session.documentLines || [];
    if (isNaN(idx) || idx < 0 || idx >= lines.length) {
      await ctx.reply('❌ رقم السطر غير صحيح. أرسل الرقم الصحيح:');
      return true;
    }
    ctx.session.editingLineIndex = idx;
    ctx.session.awaitingLineEditIndex = false;
    ctx.session.awaitingLineEditText = true;
    await ctx.reply(`✏️ <b>السطر الحالي:</b>\n<code>${lines[idx].text || '[سطر فارغ]'}</code>\n\nأرسل النص الجديد:`, { parse_mode: 'HTML' });
    return true;
  }

  // Awaiting replacement text
  if (ctx.session.awaitingLineEditText) {
    if (ctx.session.tempLine) {
      await ctx.reply('⚠️ الرجاء اختيار المحاذاة أولاً من الأزرار أدناه', {
        reply_markup: buildFormattingKeyboard(ctx.session.tempFormatting!) as any,
      });
      return true;
    }
    ctx.session.tempLine = text;
    ctx.session.tempFormatting = { bold: false, italic: false, underline: false, size: 'normal', style: 'normal' };
    await ctx.reply(`📝 <b>اختر تنسيق النص الجديد:</b>\n\n<code>${text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code>`, {
      parse_mode: 'HTML',
      reply_markup: buildFormattingKeyboard(ctx.session.tempFormatting) as any,
    });
    return true;
  }

  // Empty line command
  const emptyMatch = text.match(/^فارغ(\s+(\d+))?$/);
  if (emptyMatch) {
    const n = Math.min(Math.max(emptyMatch[2] ? parseInt(emptyMatch[2], 10) : 1, 1), 20);
    if (!ctx.session.documentLines) ctx.session.documentLines = [];
    for (let i = 0; i < n; i++) ctx.session.documentLines.push({ text: '', align: 'right' });
    const lines = ctx.session.documentLines;
    const preview = lines.map((l, i) => `${i+1}. ${l.text ? l.text.substring(0,30)+'...' : '[فارغ]'}`).join('\n');
    await ctx.reply(`✅ تمت إضافة ${n} سطر فارغ\n\n📄 <b>المستند:</b>\n${preview}`, { parse_mode: 'HTML', reply_markup: controlPanel() });
    await refreshPreview(ctx);
    return true;
  }

  // Enforce Alignment Selection
  if (ctx.session.tempLine) {
    await ctx.reply('⚠️ الرجاء اختيار المحاذاة أولاً من الأزرار أدناه', {
      reply_markup: buildFormattingKeyboard(ctx.session.tempFormatting!) as any,
    });
    return true;
  }

  // Normal text → show full formatting keyboard
  ctx.session.tempLine = text;
  ctx.session.tempFormatting = { bold: false, italic: false, underline: false, size: 'normal', style: 'normal' };
  await ctx.reply(`📝 <b>اختر تنسيق النص:</b>\n\n<code>${text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code>`, {
    parse_mode: 'HTML',
    reply_markup: buildFormattingKeyboard(ctx.session.tempFormatting) as any,
  });
  return true;
}

// ── Image Format Menu Helper ───────────────────────────────────────────────────

export async function showImageFormatMenu(ctx: any): Promise<void> {
  const rowImages = ctx.session.rowImages || [];
  const usedAligns = rowImages.map((img: any) => img.align).filter(Boolean);
  const isTempReady = ctx.session.tempImage?.align && ctx.session.tempImage?.mask;

  const keyboard: any[][] = [
    // Row 1: Alignment (Strictly only these 3 buttons)
    [
      { text: usedAligns.includes('right')  ? '🔒 يمين'  : '➡️ يمين',  callback_data: usedAligns.includes('right')  ? 'doc_img_align_locked' : 'doc_img_fmt_right'  },
      { text: usedAligns.includes('center') ? '🔒 وسط'   : '↔️ وسط',   callback_data: usedAligns.includes('center') ? 'doc_img_align_locked' : 'doc_img_fmt_center' },
      { text: usedAligns.includes('left')   ? '🔒 يسار'  : '⬅️ يسار',  callback_data: usedAligns.includes('left')   ? 'doc_img_align_locked' : 'doc_img_fmt_left'   },
    ],
    // Row 2: Mask
    [
      { text: '⭕ دائري',        callback_data: 'doc_img_mask_circle'  },
      { text: '🔲 حواف ناعمة',  callback_data: 'doc_img_mask_rounded' },
      { text: '⬛ مربع عادي',   callback_data: 'doc_img_mask_square'  },
    ]
  ];

  // Reveal row builder actions ONLY when current image is fully configured
  if (isTempReady) {
    keyboard.push([{ 
      text: ctx.session.tempImage?.caption ? '✏️ تعديل النص تحت الصورة' : '📝 إضافة نص تحت الصورة', 
      callback_data: 'doc_row_caption_temp' 
    }]);

    if (rowImages.length < 2) { 
      keyboard.push([{ text: '🖼 إضافة صورة بجانبها في نفس السطر', callback_data: 'doc_row_add_image' }]);
    }
    
    keyboard.push([{ text: '✅ إتمام التعديلات وإضافة للمستند', callback_data: 'doc_row_finish' }]);
  }

  // Row Images Captions (for previously added images in this row)
  const captionButtons = rowImages.map((img: any, idx: number) => ({
    text: img.caption ? `✏️ تعديل نص صورة ${idx + 1}` : `📝 نص صورة ${idx + 1}`,
    callback_data: `doc_row_caption_${idx}`
  }));
  if (captionButtons.length > 0) keyboard.push(captionButtons);

  keyboard.push([{ text: '🔙 رجوع وإلغاء الصورة', callback_data: 'doc_back_to_session' }]);

  const text = '🎨 <b>تنسيق الصورة:</b>\n\nاختر <b>المحاذاة</b> وشكل <b>الإطار</b> كلاهما معاً ثم تُحفَظ الصورة تلقائياً:';
  const options = { parse_mode: 'HTML' as const, reply_markup: { inline_keyboard: keyboard } };

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, options).catch(async () => {
      await ctx.reply(text, options);
    });
  } else {
    await ctx.reply(text, options);
  }
}


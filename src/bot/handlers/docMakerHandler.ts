// src/bot/handlers/docMakerHandler.ts
import { BotContext } from '../../utils/validators';
import { User } from '../../database/models/User';
import { generateDocumentFromLines } from '../../services/pdfGeneratorService';
import { InputFile } from 'grammy';
import { getSettings } from '../../services/settingsService';

const BACKUP_CHANNEL_ID = process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID || '';

// ─── Instruction message ───────────────────────────────────────────────────────

const DOC_MAKER_INSTRUCTION =
  `✨ <b>صانع المستندات والكتب</b>\n\n` +
  `📌 <b>كيفية الاستخدام:</b>\n\n` +
  `▸ أرسل النص أو العبارة التي تريد إضافتها\n` +
  `▸ ستظهر لك أزرار لاختيار موضع النص:\n` +
  `   [ ➡️ يمين ] [ ↔️ وسط ] [ ⬅️ يسار ]\n\n` +
  `📐 <b>للأسطر الفارغة:</b>\n` +
  `▸ أرسل <code>فارغ</code> ← لسطر فارغ واحد\n` +
  `▸ أرسل <code>فارغ 2</code> ← لسطرين فارغين\n` +
  `▸ أرسل <code>فارغ 3</code> ← لثلاثة أسطر فارغة\n` +
  `(وهكذا لأي عدد تريده)\n\n` +
  `⚠️ <b>ملاحظة:</b> النص لن يلمس حواف المستند أبداً — هناك هوامش احترافية على جميع الجوانب.`;

const COMPILE_KB = {
  inline_keyboard: [
    [{ text: '📥 إنهاء وتصدير PDF', callback_data: 'doc_compile' }],
    [{ text: '❌ إلغاء', callback_data: 'doc_maker_cancel' }],
  ],
};

// ══════════════════════════════════════════════════════════════════════════════
// CALLBACK HANDLER
// ══════════════════════════════════════════════════════════════════════════════

export async function handleDocMakerCallback(ctx: BotContext): Promise<boolean> {
  if (!ctx.session) return false;
  if (!ctx.from) return false;
  ctx.session.pendingBatchFiles ??= [];

  const data = ctx.callbackQuery?.data;
  if (!data) return false;

  // ── Lock guard: doc_maker_start bypasses callbackHandler's lockMap ────────
  if (data === 'doc_maker_start') {
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const isAdminUser = adminIds.includes(ctx.from!.id.toString());
    if (!isAdminUser) {
      const lockSettings = await getSettings();
      const isLocked = lockSettings.locks.btn_doc_maker === true;
      if (isLocked) {
        const bypassUser = await User.findOne({ telegramId: ctx.from!.id.toString() }).select('canBypassLocks');
        if (!bypassUser?.canBypassLocks) {
          await ctx.answerCallbackQuery({
            text: '⚠️ هذا القسم مغلق مؤقتاً للتحديث. متاح حالياً للمطورين والمشتركين المعتمدين فقط.',
            show_alert: true,
          }).catch(() => {});
          return true;
        }
      }
    }
  }

  // Only handle recognised doc-maker callbacks
  const docCallbacks = [
    'doc_maker_start', 'doc_maker_cancel',
    'doc_type_text', 'doc_type_image',
    'doc_compile', 'doc_continue', 'doc_finish',
    'align_right', 'align_center', 'align_left',
  ];
  const isDocCallback = docCallbacks.includes(data) || data.startsWith('doc_tpl_') || data.startsWith('doc_size_');
  if (!isDocCallback) return false;

  const telegramId = ctx.from!.id.toString();

  // ── Entry: Ask Type ──────────────────────────────────────────────────────
  if (data === 'doc_maker_start') {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      '📝 <b>صانع المستندات والكتب</b>\n\nاختر نوع المستند:',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📄 مستند نصي', callback_data: 'doc_type_text' }],
            [{ text: '🖼 مستند مصور', callback_data: 'doc_type_image' }],
            [{ text: '❌ إلغاء', callback_data: 'doc_maker_cancel' }],
          ],
        },
      }
    );
    return true;
  }

  // ── Step 1 → 2: Doc Type Selected -> Ask Template ────────────────────────
  if (data === 'doc_type_text' || data === 'doc_type_image') {
    await ctx.answerCallbackQuery();
    ctx.session.docType = data === 'doc_type_text' ? 'text' : 'image';
    
    await ctx.editMessageText(
      '🎨 <b>اختر نموذج التصميم:</b>\n\n' +
      '1️⃣ كلاسيكي نظيف (إطار رفيع)\n' +
      '2️⃣ احترافي مع رأس وتذييل\n' +
      '3️⃣ زوايا مزخرفة — خط كبير\n' +
      '4️⃣ أشرطة جانبية — خط مضغوط\n' +
      '5️⃣ إطار مزدوج أنيق\n\n' +
      '<i>اختر النموذج المناسب لمستندك:</i>',
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

  // ── Step 2 → 3: Template Selected -> Ask Size ─────────────────────────────
  if (data.startsWith('doc_tpl_')) {
    await ctx.answerCallbackQuery();
    ctx.session.templateId = parseInt(data.replace('doc_tpl_', ''), 10);
    
    await ctx.editMessageText('📐 <b>اختر مقاس الصفحة:</b>', {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'A4 (افتراضي)', callback_data: 'doc_size_A4' }, { text: 'A5', callback_data: 'doc_size_A5' }],
          [{ text: 'Letter', callback_data: 'doc_size_Letter' }, { text: 'B5', callback_data: 'doc_size_B5' }],
          [{ text: 'Legal', callback_data: 'doc_size_Legal' }, { text: 'Executive', callback_data: 'doc_size_Executive' }],
          [{ text: '❌ إلغاء', callback_data: 'doc_maker_cancel' }],
        ],
      },
    });
    return true;
  }

  // ── Step 3 → 4: Size Selected -> Enable Text Input Mode ───────────────────
  if (data.startsWith('doc_size_')) {
    await ctx.answerCallbackQuery();
    ctx.session.pageSize = data.replace('doc_size_', '');
    
    // NOW enable text input state
    ctx.session.isInDocMaker = true;
    ctx.session.documentLines = [];
    ctx.session.tempLine = null;

    await ctx.editMessageText(DOC_MAKER_INSTRUCTION, {
      parse_mode: 'HTML',
      reply_markup: COMPILE_KB,
    });
    return true;
  }

  // ── Cancel ────────────────────────────────────────────────────────────────
  if (data === 'doc_maker_cancel') {
    await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' });
    ctx.session.isInDocMaker = false;
    ctx.session.documentLines = [];
    ctx.session.tempLine = null;
    await ctx.deleteMessage().catch(() => {});
    return true;
  }

  // ── Alignment callbacks ───────────────────────────────────────────────────
  if (data === 'align_right' || data === 'align_center' || data === 'align_left') {
    await ctx.answerCallbackQuery();

    const tempLine = ctx.session.tempLine;
    if (!tempLine) {
      await ctx.editMessageText('⚠️ انتهت صلاحية النص. أرسل النص مجدداً.').catch(() => {});
      return true;
    }

    const alignMap: Record<string, 'right' | 'center' | 'left'> = {
      align_right: 'right',
      align_center: 'center',
      align_left: 'left',
    };
    const alignLabel: Record<string, string> = {
      align_right: 'اليمين ➡️',
      align_center: 'الوسط ↔️',
      align_left: 'اليسار ⬅️',
    };

    if (!ctx.session.documentLines) ctx.session.documentLines = [];
    ctx.session.documentLines.push({ text: tempLine, align: alignMap[data] });
    ctx.session.tempLine = null;

    const count = ctx.session.documentLines.length;
    await ctx.editMessageText(
      `✅ تمت إضافة السطر بمحاذاة ${alignLabel[data]}\n📝 إجمالي الأسطر: ${count}`,
    ).catch(() => {});
    return true;
  }

  // ── Compile & deliver ─────────────────────────────────────────────────────
  if (data === 'doc_compile') {
    const lines = ctx.session.documentLines ?? [];

    if (lines.length === 0) {
      await ctx.answerCallbackQuery({ text: '⚠️ لم تضف أي محتوى بعد!', show_alert: true });
      return true;
    }

    await ctx.answerCallbackQuery();
    const processingMsg = await ctx.reply('⏳ جاري إنشاء ملف PDF... الرجاء الانتظار');

    try {
      const pdfBuffer = await generateDocumentFromLines(lines);
      const fileName  = `NizoDoc_${Date.now()}.pdf`;

      await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id).catch(() => {});

      const { incrementGlobalCounter } = await import('../../services/statsService');
      await incrementGlobalCounter();

      await ctx.replyWithDocument(new InputFile(pdfBuffer, fileName), {
        caption:
          `✅ <b>تم إنشاء المستند بنجاح!</b>\n\n` +
          `📄 الأسطر: ${lines.length}\n` +
          `📐 المقاس: A4`,
        parse_mode: 'HTML',
      });

      // Silent archive
      if (BACKUP_CHANNEL_ID) {
        await ctx.api.sendDocument(
          BACKUP_CHANNEL_ID,
          new InputFile(pdfBuffer, fileName),
          { caption: `📦 أرشيف صانع المستندات\n🆔 ${telegramId}`, disable_notification: true }
        ).catch(() => {});
      }

      // Post-export choice
      await ctx.reply(
        '🎉 <b>تم تصدير مستندك!</b>\n\nهل تريد متابعة الإضافة إلى نفس المستند أم إنهائه؟',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '📝 متابعة', callback_data: 'doc_continue' },
              { text: '✅ إتمام',  callback_data: 'doc_finish'   },
            ]],
          },
        }
      );
    } catch (err) {
      console.error('[DocMaker] compile error:', err);
      await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id).catch(() => {});
      await ctx.reply('❌ حدث خطأ أثناء إنشاء المستند. حاول مرة أخرى.');
    }
    return true;
  }

  // ── Continue (keep lines, resend instruction) ─────────────────────────────
  if (data === 'doc_continue') {
    await ctx.answerCallbackQuery();
    ctx.session.tempLine = null;
    await ctx.editMessageReplyMarkup(undefined).catch(() => {});
    await ctx.reply(DOC_MAKER_INSTRUCTION, {
      parse_mode: 'HTML',
      reply_markup: COMPILE_KB,
    });
    return true;
  }

  // ── Finish (reset all state) ──────────────────────────────────────────────
  if (data === 'doc_finish') {
    await ctx.answerCallbackQuery();
    ctx.session.isInDocMaker = false;
    ctx.session.documentLines = [];
    ctx.session.tempLine = null;
    await ctx.editMessageText(
      '✅ تم إنهاء المستند بنجاح. يمكنك البدء من جديد متى شئت.',
    ).catch(() => {});
    return true;
  }

  return false;
}

// ══════════════════════════════════════════════════════════════════════════════
// MESSAGE HANDLER
// ══════════════════════════════════════════════════════════════════════════════

export async function handleDocMakerMessage(ctx: BotContext): Promise<boolean> {
  if (!ctx.session) return false;
  if (!ctx.from) return false;
  if (!ctx.session.isInDocMaker) return false;

  const text = ctx.message?.text?.trim();
  if (!text) return false;

  // 1. HARD RULE — ignore commands (prevents ObjectParameterError crash)
  if (text.startsWith('/')) return false;

  // 2. Empty line detection: "فارغ" or "فارغ N"
  const emptyMatch = text.match(/^فارغ(\s+(\d+))?$/);
  if (emptyMatch) {
    const rawN = emptyMatch[2] ? parseInt(emptyMatch[2], 10) : 1;
    const n    = Math.min(Math.max(rawN, 1), 20); // cap at 20 for safety

    if (!ctx.session.documentLines) ctx.session.documentLines = [];
    for (let i = 0; i < n; i++) {
      ctx.session.documentLines.push({ text: '', align: 'right' });
    }

    const total = ctx.session.documentLines.length;
    await ctx.reply(
      `✅ تمت إضافة ${n} سطر فارغ\n📝 إجمالي الأسطر: ${total}`,
      { reply_markup: COMPILE_KB }
    );
    return true;
  }

  // 3. Normal text → save to tempLine, show alignment keyboard
  ctx.session.tempLine = text;

  await ctx.reply(
    `📝 <b>اختر محاذاة النص:</b>\n\n<code>${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '➡️ يمين',  callback_data: 'align_right'  },
          { text: '↔️ وسط',   callback_data: 'align_center' },
          { text: '⬅️ يسار', callback_data: 'align_left'   },
        ]],
      },
    }
  );
  return true;
}

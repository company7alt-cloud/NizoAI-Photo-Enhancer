// src/bot/handlers/callbackHandler.ts
import { InputFile, InlineKeyboard } from 'grammy';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import AdmZip from 'adm-zip';
import PDFDocument from 'pdfkit';
import { User } from '../../database/models/User';
import { BotContext, isAdmin } from '../../utils/validators';
import { setImageAdminState, getImageAdminState, clearImageAdminState } from '../../utils/adminTextState';
import * as imageService from '../../services/imageService';
import { sendAdminAlert } from '../../utils/adminAlert';
import { BotSettings } from '../../database/models/BotSettings';
import {
  startFundCampaignSetup,
  clearFundCampaignState,
  claimChannelReward,
} from '../../services/channelFundService';
import { FundCampaign } from '../../database/models/FundCampaign';
import { getSettings, toggleLock } from '../../services/settingsService';
import {
  enhanceWithONNX,
  getQueuePosition,
} from '../../services/onnxEnhanceService';
import { ForceSubChannel } from '../../database/models/ForceSubChannel';

import { execFile } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
const execFileAsync = util.promisify(execFile);

const GRID_CONFIGS: Record<number, { cols: number; rows: number }> = {
  30: { cols: 5, rows: 6 },
  40: { cols: 5, rows: 8 },
  50: { cols: 5, rows: 10 },
  70: { cols: 7, rows: 10 },
  80: { cols: 8, rows: 10 },
  100: { cols: 10, rows: 10 },
};

const ARCHIVE_GROUP_ID = process.env.ARCHIVE_GROUP_ID ?? '';
const CHANNEL_ID = process.env.CHANNEL_ID ?? '';
const BACKUP_CHANNEL_ID = ARCHIVE_GROUP_ID || CHANNEL_ID;

async function convertWithImageMagick(
  inputBuffer: Buffer,
  sourceFormat: string,
  targetFormat: string
): Promise<Buffer> {
  const jobId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const src = sourceFormat.toLowerCase();
  const tgt = targetFormat.toLowerCase();
  const inputPath = path.join(os.tmpdir(), `nizo_${jobId}_in.${src}`);
  const outputPath = path.join(os.tmpdir(), `nizo_${jobId}_out.${tgt}`);

  fs.writeFileSync(inputPath, inputBuffer);

  try {
    const rawFormats = ['cr2', 'nef', 'arw', 'dng', 'sr2', 'raw'];
    const heicFormats = ['heic', 'heif'];
    const adobeFormats = ['psd', 'ai', 'eps'];

    if (rawFormats.includes(src)) {
      const { stdout } = await execFileAsync('dcraw', ['-c', '-w', inputPath], { encoding: 'buffer' });
      const tempPpm = `${inputPath}.ppm`;
      fs.writeFileSync(tempPpm, stdout as unknown as Buffer);
      await execFileAsync('convert', [tempPpm, outputPath]);
      if (fs.existsSync(tempPpm)) fs.unlinkSync(tempPpm);
    } else if (heicFormats.includes(src)) {
      await execFileAsync('heif-convert', [inputPath, outputPath]);
    } else if (adobeFormats.includes(src)) {
      await execFileAsync('convert', [
        '-density', '300',
        `${inputPath}[0]`,
        '-flatten',
        '-quality', '95',
        outputPath,
      ]);
    } else {
      await execFileAsync('convert', [inputPath, '-quality', '95', outputPath]);
    }

    const result = fs.readFileSync(outputPath);
    return result;
  } finally {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
}

async function showFormatSelection(ctx: any, count: number, _upscale: boolean, sourceFormat?: string): Promise<void> {
  const isSingle = count === 1;
  const src = sourceFormat ? sourceFormat.toUpperCase() : '';
  const srcLower = sourceFormat ? sourceFormat.toLowerCase() : '';
  const label = (fmt: string) => src ? `${src} ➜ ${fmt}` : `🔄 ${fmt}`;
  const btnStyle = (fmt: string): 'danger' | 'primary' =>
    srcLower && fmt.toLowerCase() === srcLower ? 'danger' : 'primary';

  const keyboard: any[] = [
    [
      { text: label('JPG'), callback_data: 'fconv_jpg', style: btnStyle('jpg') as any },
      { text: label('PNG'), callback_data: 'fconv_png', style: btnStyle('png') as any },
      { text: label('WEBP'), callback_data: 'fconv_webp', style: btnStyle('webp') as any },
    ],
    [
      { text: label('AVIF'), callback_data: 'fconv_avif', style: btnStyle('avif') as any },
      { text: label('TIFF'), callback_data: 'fconv_tiff', style: btnStyle('tiff') as any },
      { text: label('GIF'), callback_data: 'fconv_gif', style: btnStyle('gif') as any },
    ],
    [
      { text: label('BMP'), callback_data: 'fconv_bmp', style: btnStyle('bmp') as any },
      { text: label('PDF'), callback_data: 'fconv_pdf', style: btnStyle('pdf') as any },
      { text: label('SVG'), callback_data: 'fconv_svg', style: btnStyle('svg') as any },
    ],
    [
      { text: label('PSD'), callback_data: 'fconv_psd', style: btnStyle('psd') as any },
      { text: label('ICO'), callback_data: 'fconv_ico', style: btnStyle('ico') as any },
      { text: label('HEIC'), callback_data: 'fconv_heic', style: btnStyle('heic') as any },
    ],
    [
      { text: label('EPS'), callback_data: 'fconv_eps', style: btnStyle('eps') as any },
      { text: label('AI'), callback_data: 'fconv_ai', style: btnStyle('ai') as any },
      { text: label('RAW'), callback_data: 'fconv_raw', style: btnStyle('raw') as any },
    ],
    [
      { text: label('CR2'), callback_data: 'fconv_cr2', style: btnStyle('cr2') as any },
      { text: label('NEF'), callback_data: 'fconv_nef', style: btnStyle('nef') as any },
      { text: label('SR2'), callback_data: 'fconv_sr2', style: btnStyle('sr2') as any },
    ],
    [
      { text: label('DNG'), callback_data: 'fconv_dng', style: btnStyle('dng') as any },
      { text: label('ARW'), callback_data: 'fconv_arw', style: btnStyle('arw') as any },
      { text: label('JP2'), callback_data: 'fconv_jp2', style: btnStyle('jp2') as any },
    ],
    [
      { text: label('DDS'), callback_data: 'fconv_dds', style: btnStyle('dds') as any },
      { text: label('TGA'), callback_data: 'fconv_tga', style: btnStyle('tga') as any },
      { text: label('PPM'), callback_data: 'fconv_ppm', style: btnStyle('ppm') as any },
    ],
    [
      { text: label('PGM'), callback_data: 'fconv_pgm', style: btnStyle('pgm') as any },
      { text: label('PBM'), callback_data: 'fconv_pbm', style: btnStyle('pbm') as any },
      { text: label('PNM'), callback_data: 'fconv_pnm', style: btnStyle('pnm') as any },
    ],
    [
      { text: label('HDR'), callback_data: 'fconv_hdr', style: btnStyle('hdr') as any },
      { text: label('EXR'), callback_data: 'fconv_exr', style: btnStyle('exr') as any },
      { text: label('DIB'), callback_data: 'fconv_dib', style: btnStyle('dib') as any },
    ],
  ];

  // @ts-ignore
  keyboard.push([{ text: '❌ إلغاء', callback_data: 'convert_format_cancel', style: 'danger' as const }]);

  await ctx.reply(
    `🔄 <b>اختر الصيغة التي تريد التحويل إليها:</b>` +
    (src ? `\n📂 <b>الصيغة الأصلية:</b> ${src}` : '') +
    (isSingle ? '\n📄 PDF و SVG و PSD متاحان للصورة الواحدة فقط' : ''),
    {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    }
  );
}

export async function callbackHandler(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data || !ctx.from) return;

  // ── [KILL-SWITCH — ABSOLUTE TOP] Admin Toggle Internet Fetcher ──
  if (data === 'admin_toggle_internet_fetcher') {
    if (!isAdmin(ctx.from!.id)) {
      await ctx.answerCallbackQuery({ text: '⛔ غير مصرح' }).catch(() => { });
      return;
    }
    await ctx.answerCallbackQuery().catch(() => { });
    const { toggleInternetFetcher, getFetcherStatus } = await import('../../utils/internetFetcherSettings');
    const newEnabled = toggleInternetFetcher();
    const status = getFetcherStatus();
    const stateText = newEnabled ? '✅ مفعّل' : '🔴 مطفي';
    await ctx.reply(
      `🌐 <b>تحميل الصور من الإنترنت</b>\n\n` +
      `الحالة الآن: <b>${stateText}</b>\n` +
      `آخر تغيير: ${new Date(status.lastChanged).toLocaleString('ar-SA')}`,
      { parse_mode: 'HTML' }
    );
    return;
  }
  // ── [END KILL-SWITCH] ──

  // ── Admin User Control Handlers ──────────────────────────────────────────
  if (data === 'admin_user_control') {
    const adminIds = (process.env.ADMIN_IDS || '').split(',');
    if (!adminIds.includes(ctx.from!.id.toString())) return;

    await ctx.editMessageText('👥 <b>لوحة التحكم في العملاء</b>\n\nاختر الإجراء المطلوب:', {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            // @ts-ignore
            { text: '👤 تصفية الوجه', callback_data: 'filter_face', style: 'primary' },
            // @ts-ignore
            { text: '🎨 تلوين الصور', callback_data: 'filter_color', style: 'primary' }
          ],
          [
            // @ts-ignore
            { text: '🌸 تحويل أنمي', callback_data: 'filter_anime', style: 'primary' },
            // @ts-ignore
            { text: ' تأثير جيبلي', callback_data: 'filter_ghibli', style: 'primary' }
          ],
          [
            // @ts-ignore
            { text: '🪄 ترميم الصور القديمة', callback_data: 'filter_restore', style: 'primary' }
          ],
          [
            // @ts-ignore
            { text: '❌ إلغاء', callback_data: 'cancel_filter', style: 'danger' }
          ]
        ]
      }
    }
    );
    return;
  }

  // ── Handle filter button press — ALL filters use unified awaitingFilterAction flow ──
  if (data.startsWith('filter_')) {
    await ctx.answerCallbackQuery().catch(() => { });

    const filterType = data.replace('filter_', '');
    const cost = ['anime', 'ghibli'].includes(filterType) ? 3 : 2;

    // @ts-ignore -- filterNames used as reference; actual lookup done in imageHandler
    const filterNames: Record<string, string> = {
      'filter_restore': '🪄 ترميم الصور القديمة',
      'filter_face': '👤 تصفية الوجه',
      'filter_color': '🎨 تلوين الصور',
      'filter_anime': '🌸 تحويل أنمي',
      'filter_ghibli': ' تأثير جيبلي',
    };

    if (ctx.session) ctx.session.awaitingFilterAction = data;

    await ctx.editMessageText(
      `🖼️ <b>أرسل الصورة الآن</b>\n\n` +
      `سيتم تطبيق الفلتر خلال 30-60 ثانية \n` +
      `⚡ <b>التكلفة: ${cost} محاولات</b>\n` +
      `💡 <i>تُخصم عند النجاح فقط</i>`,
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('❌ إلغاء', 'cancel_filter')
      }
    ).catch(() => { });
    return;
  }

  // ── Handle cancel_filter ──────────────────────────────────────────────────────
  if (data === 'cancel_filter') {
    await ctx.answerCallbackQuery().catch(() => { });
    await User.updateOne(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingFilterImage: false, selectedFilterType: '' } }
    );
    await ctx.editMessageText('تم الإلغاء ❌').catch(() => { });
    return;
  }

  if (data === 'show_global_stats') {
    const { getGlobalCounter } = await import('../../services/statsService');
    const total = await getGlobalCounter();

    await ctx.answerCallbackQuery({
      text: `🚀 إحصائيات البوت:\n\nتمت معالجة وتحسين أكثر من [ ${total} ] صورة وملف بنجاح عبر نظامنا الذكي! 🌟`,
      show_alert: true
    }).catch(() => { });
    return;
  }


  if (data === 'check_force_sub') {
    await ctx.answerCallbackQuery().catch(() => { });

    const userId = ctx.from!.id;
    const channels = await ForceSubChannel.find().sort({ order: 1 });

    if (channels.length === 0) {
      await ctx.deleteMessage().catch(() => { });
      return;
    }

    let allSubscribed = true;

    for (const ch of channels) {
      try {
        const member = await ctx.api.getChatMember(ch.channelId, userId);
        if (['left', 'kicked'].includes(member.status)) {
          allSubscribed = false;
          break;
        }
      } catch {
        // Cannot verify — allow user through (bot may have lost admin)
        // This prevents an infinite block loop
        console.error(`[CheckForceSub] Cannot verify channel ${ch.channelId}`);
      }
    }

    if (allSubscribed) {
      await ctx.answerCallbackQuery({
        text: '✅ تم التحقق! يمكنك استخدام البوت الآن 🎉',
        show_alert: true,
      }).catch(() => { });
      await ctx.deleteMessage().catch(() => { });
    } else {
      await ctx.answerCallbackQuery({
        text: '❌ لم تشترك في جميع القنوات بعد!',
        show_alert: true,
      }).catch(() => { });
    }
    return;
  }

  if (data.startsWith("eraser_fmt_")) {
    await ctx.answerCallbackQuery();

    const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
    if (!user?.lastEraserResultBuffer) {
      await ctx.reply("❌ انتهت صلاحية الملف. أرسل الصورة مجدداً.");
      return;
    }

    const formatMap: Record<string, string> = {
      eraser_fmt_jpg: 'jpeg',
      eraser_fmt_png: 'png',
      eraser_fmt_webp: 'webp',
      eraser_fmt_gif: 'gif',
      eraser_fmt_tiff: 'tiff',
    };

    const targetFormat = formatMap[data];
    if (!targetFormat) return;

    const processingMsg = await ctx.reply(`⏳ جاري تحويل الصيغة إلى ${data.split('_')[2].toUpperCase()}...`);

    try {
      const inputBuffer = Buffer.from(user.lastEraserResultBuffer, 'base64');

      // Convert using sharp
      const convertedBuffer = await sharp(inputBuffer)
        .toFormat(targetFormat as keyof sharp.FormatEnum, {
          quality: 100,
          lossless: targetFormat === 'webp',
        })
        .toBuffer();

      await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id).catch(() => { });

      const ext = targetFormat === 'jpeg' ? 'jpg' : targetFormat;
      const { incrementGlobalCounter } = await import('../../services/statsService');
      await incrementGlobalCounter();
      await ctx.replyWithDocument(
        new InputFile(convertedBuffer, `converted_${Date.now()}.${ext}`),
        {
          caption: `✅ تم التحويل إلى ${ext.toUpperCase()} بنجاح`,
        }
      );
    } catch (err: any) {
      await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id).catch(() => { });
      await ctx.reply("❌ فشل التحويل. حاول مرة أخرى.");
      console.error("[EraserFmt] Error:", err.message);
    }
    return;
  }

  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
  const isAdminUser = adminIds.includes(ctx.from!.id.toString());
  const settings = await getSettings();
  const locks = settings.locks;

  const lockMap: Record<string, boolean> = {
    'enhance_2k': locks.btn_2k,
    'enhance_4k': locks.btn_4k,
    'locked_8k': locks.btn_8k,
    'process_4k_ai': locks.btn_4kai,
    'locked_8k_ai': locks.btn_8kai,
    'nano_banana_start': locks.btn_nano,
    'eraser_start': locks.btn_eraser,
    'remove_watermark_auto': locks.btn_eraser,
    'doc_maker_start': locks.btn_doc_maker,
    'magic_enhance_start': locks.btn_magic_enhance,
  };

  const bypassUser = await User.findOne({ telegramId: ctx.from.id }).select('canBypassLocks');
  const canBypass = isAdminUser || bypassUser?.canBypassLocks === true;

  if (!canBypass && lockMap[data] === true) {
    await ctx.answerCallbackQuery({
      text: '⚠️ هذا القسم مغلق مؤقتاً للتحديث. متاح حالياً للمطورين والمشتركين المعتمدين فقط.',
      show_alert: true
    }).catch(() => { });
    return;
  }

  // Admin callbacks are now handled at the bottom of this file

  if (data === 'toggle_fake_counter') {
    if (!isAdminUser) return;
    const { GlobalStat } = await import('../../database/models/GlobalStat');
    const config = await GlobalStat.findOne({ key: 'total_processed' });
    const newState = !(config?.isFakeCounterActive || false);

    await GlobalStat.updateOne(
      { key: 'total_processed' },
      { $set: { isFakeCounterActive: newState } },
      { upsert: true }
    );
    await ctx.answerCallbackQuery({ text: 'تم تحديث حالة العداد الوهمي 🔄' }).catch(() => { });

    // Rebuild the admin keyboard correctly using InlineKeyboard
    const adminKeyboard = new InlineKeyboard()
      .text(`📈 العداد الوهمي: ${newState ? '✅ شغال' : '❌ متوقف'}`, 'toggle_fake_counter').row()
      .text('✏️ تعديل رسالة الترحيب', 'admin_edit_welcome').row()
      .text('🎁 تعديل عدد المحاولات اليومية', 'admin_edit_daily').row()
      .text('⚠️ تعديل رسالة انتهاء المحاولات', 'admin_edit_low').row()
      .text('📊 إحصائيات البوت', 'admin_stats').row()
      .text('🔍 البحث عن مستخدم', 'admin_search_user').row()
      .text('📢 إرسال إشعار لجميع المستخدمين', 'admin_broadcast').row()
      .text('🔧 وضع الصيانة', 'admin_maintenance').row()
      .text('📢 تمويل أعضاء قناة', 'start_fund_campaign').row()
      .text('⚙️ إدارة أزرار البوت (قفل/فتح)', 'admin_panel').row()
      .text('🔄 إعدادات زر تحويل الصيغة', 'admin_edit_convert_msg').row()
      .text('✏️ تعديل نصوص البوت', 'admin_edit_texts').row()
      .text('🎯 إدارة المحاولات', 'admin_manage_attempts').row()
      .text('🔗 إنشاء رابط مكافأة', 'admin_create_magic_link');

    await ctx.editMessageReplyMarkup(adminKeyboard as any).catch(() => { });
    return;
  }
  // ── STEP 1: Fetch FRESH user ──────────────────────────────────────────────────
  let user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) {
    user = await User.create({
      telegramId: ctx.from.id,
      firstName: ctx.from.first_name ?? '',
      username: ctx.from.username,
      language: ctx.from.language_code ?? 'en',
      dailyQuota: 5,
      lastQuotaReset: new Date(),
    });
  }

  // ── STEP 2: Ban check ─────────────────────────────────────────────────────────
  if (user.isBanned) {
    void ctx.answerCallbackQuery({
      text: '🚫 عذراً، تم تقييد وصولك للبوت. للاستفسار تواصل مع المطور 💙',
      show_alert: true,
    }).catch(() => { });
    return;
  }

  // ── STEP 3: Auto-reset logic removed. User MUST click daily reward button. ──

  // ── STEP 4: Admin flag ────────────────────────────────────────────────────────
  const admin = isAdmin(ctx.from.id);

  // ── STEP 5: Locked 8K ─────────────────────────────────────────────────────────
  if (data === 'locked_8k') {
    void ctx.answerCallbackQuery({
      text: '🔒 هذه الميزة مقفلة حالياً 💫\nتواصل مع المطور لفتح ميزة الـ 8K ',
      show_alert: true,
    }).catch(() => { });
    return;
  }

  if (data === 'locked_4k') {
    void ctx.answerCallbackQuery({
      text: '🔒 هذه الميزة مقفلة حالياً 💫\nتواصل مع المطور لفتح الميزة ',
      show_alert: true,
    }).catch(() => { });
    return;
  }

  // ── Helper: get Telegram file URL from session ────────────────────────────────
  const pendingFile = ctx.session?.pendingFile;
  const getTelegramFileUrl = async (): Promise<string | null> => {
    if (!pendingFile?.fileId) return null;
    const tgFile = await ctx.api.getFile(pendingFile.fileId);
    if (!tgFile.file_path) return null;
    return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
  };

  // ── Helper: forward result to public channel ──────────────────────────────────
  const forwardToChannel = async (
    buf: Buffer,
    fileName: string,
    resolution: string,
    jobId: string
  ): Promise<void> => {
    if (!BACKUP_CHANNEL_ID) return;

    const actionUser = ctx.from;
    const userLink = actionUser?.username
      ? `@${actionUser.username}`
      : `<a href="tg://user?id=${actionUser?.id}">${actionUser?.first_name || 'مجهول'}</a>`;

    const caption =
      `📦 <b>نسخة أرشيفية</b>\n` +
      `━━━━━━━━━━━━━━\n` +
      `🆔 <b>User ID:</b> <code>${actionUser?.id}</code>\n` +
      `👤 <b>Username:</b> ${userLink}\n` +
      `🏷 <b>Job ID:</b> <code>${jobId}</code>\n` +
      `💎 <b>Resolution:</b> ${resolution}\n` +
      `📅 <b>Time:</b> ${new Date().toLocaleString('ar-SA')}\n` +
      `━━━━━━━━━━━━━━`;

    try {
      await ctx.api.sendDocument(
        BACKUP_CHANNEL_ID,
        new InputFile(buf, fileName),
        {
          disable_notification: true,
          caption: caption,
          parse_mode: 'HTML',
        }
      );
    } catch (fwdErr: unknown) {
      console.error('[Archive Error]', fwdErr);
    }
  };

  // ── STEP 6: enhance_2k ───────────────────────────────────────────────────────
  if (data === 'enhance_2k') {
    const resolution = '2K';
    await ctx.answerCallbackQuery().catch(() => { });

    if (resolution !== '2K') {
      if (!admin && user.dailyQuota < 1) {
        await ctx.reply(
          '🌙 أوه! انتهت محاولاتك اليومية 🥺\nعد غداً وستجد 5 محاولات جديدة بانتظارك 🎁'
        );
        return;
      }
    }

    const telegramFileUrl = await getTelegramFileUrl();
    if (!telegramFileUrl) {
      await ctx.reply('❌ انتهت الجلسة. أرسل الصورة مجدداً.');
      return;
    }

    if (resolution !== '2K') {
      if (!admin) {
        user.dailyQuota -= 1;
        await user.save();
      }
    }

    const jobId = uuidv4().substring(0, 8).toUpperCase();
    await ctx.editMessageText('⏳ جاري تحسين صورتك بدقة 2K...\nالرجاء الانتظار لحظات 🌟');
    if (ctx.session) ctx.session.pendingFile = undefined;

    try {
      const resultBuffer = await imageService.enhance(telegramFileUrl, '2K');
      user.totalEnhancements += 1;
      await user.save();

      const outputFileName = `NizoAI_2K_${jobId}.jpg`;

      const { incrementGlobalCounter } = await import('../../services/statsService');
      await incrementGlobalCounter();
      await ctx.replyWithDocument(new InputFile(resultBuffer, outputFileName), {
        caption: `🎉 صورتك جاهزة بدقة 2K! 🌟\n🏷 Job ID: ${jobId}\n⚡ محاولاتك المتبقية: ${user.dailyQuota}`,
        reply_markup: {
          inline_keyboard: [
            [
              // @ts-ignore
              { text: '✅ PNG', callback_data: 'conv_png', style: 'primary' as const },
              { text: '✅ JPG', callback_data: 'conv_jpg', style: 'primary' as const },
              // @ts-ignore
              { text: '✅ WEBP', callback_data: 'conv_webp', style: 'primary' as const },
            ],
            [
              // @ts-ignore
              { text: '✅ AVIF', callback_data: 'conv_avif', style: 'primary' as const },
              { text: '✅ TIFF', callback_data: 'conv_tiff', style: 'primary' as const },
            ],
          ],
        },
      });
      await ctx.deleteMessage().catch(() => { });

      // Forward to channel (silent — never affects user)
      void forwardToChannel(resultBuffer, outputFileName, '2K', jobId);
    } catch {
      if (resolution !== '2K') {
        if (!admin) {
          user.dailyQuota += 1;
          await user.save();
        }
      }
      await ctx.deleteMessage().catch(() => { });
      await ctx.reply(
        '😔 عذراً حدث خطأ أثناء معالجة صورتك 🌸\nتم إعادة محاولتك تلقائياً \nجرب مرة أخرى وسنكون معك 💙'
      );
    }
    return;
  }

  // ── STEP 7: enhance_4k ───────────────────────────────────────────────────────
  if (data === 'enhance_4k') {
    await ctx.answerCallbackQuery().catch(() => { });

    if (!admin && user.dailyQuota < 2) {
      await ctx.reply(
        `💫 تحتاج محاولتين لدقة 4K الفائقة 🌟\nرصيدك الحالي: ${user.dailyQuota} محاولة 🥺\nاستخدم دقة 2K أو عد غداً لـ 5 محاولات جديدة 🎁`
      );
      return;
    }

    const telegramFileUrl = await getTelegramFileUrl();
    if (!telegramFileUrl) {
      await ctx.reply('❌ انتهت الجلسة. أرسل الصورة مجدداً.');
      return;
    }

    if (!admin) {
      user.dailyQuota -= 2;
      await user.save();
    }

    const jobId = uuidv4().substring(0, 8).toUpperCase();
    await ctx.editMessageText(
      '⚙️ جاري المعالجة بدقة 4K الفائقة \nهذه العملية تستهلك محاولتين من رصيدك 💎\nالرجاء الانتظار، قد تستغرق دقيقة أو أكثر 🌸'
    );
    ctx.session && (ctx.session.pendingFile = undefined);

    try {
      const resultBuffer = await imageService.enhance(telegramFileUrl, '4K');
      user.totalEnhancements += 1;
      await user.save();

      const outputFileName = `NizoAI_4K_${jobId}.jpg`;

      const { incrementGlobalCounter } = await import('../../services/statsService');
      await incrementGlobalCounter();
      await ctx.replyWithDocument(new InputFile(resultBuffer, outputFileName), {
        caption: `💎 صورتك جاهزة بدقة 4K الفائقة! \n🏷 Job ID: ${jobId}\n⚡ محاولاتك المتبقية: ${user.dailyQuota}`,
        reply_markup: {
          inline_keyboard: [
            [
              // @ts-ignore
              { text: '✅ PNG', callback_data: 'conv_png', style: 'primary' as const },
              { text: '✅ JPG', callback_data: 'conv_jpg', style: 'primary' as const },
              // @ts-ignore
              { text: '✅ WEBP', callback_data: 'conv_webp', style: 'primary' as const },
            ],
            [
              // @ts-ignore
              { text: '✅ AVIF', callback_data: 'conv_avif', style: 'primary' as const },
              { text: '✅ TIFF', callback_data: 'conv_tiff', style: 'primary' as const },
            ],
          ],
        },
      });
      await ctx.deleteMessage().catch(() => { });

      // Forward to channel (silent — never affects user)
      void forwardToChannel(resultBuffer, outputFileName, '4K', jobId);
    } catch {
      if (!admin) {
        user.dailyQuota += 2;
        await user.save();
      }
      await ctx.deleteMessage().catch(() => { });
      await ctx.reply(
        '😔 عذراً حدث خطأ أثناء معالجة صورتك بدقة 4K 🌸\nتم إعادة المحاولتين تلقائياً \nجرب مرة أخرى وسنكون معك 💙'
      );
    }
    return;
  }

  // ── process_4k_ai & locked_8k_ai ───────────────────────────────────────────
  if (data === 'locked_8k_ai') {
    void ctx.answerCallbackQuery({
      text: '🔒 هذه الميزة مقفلة. تواصل مع المدير لتفعيلها',
      show_alert: true,
    }).catch(() => { });
    return;
  }

  if (data === 'process_4k_ai') {
    // ── Resolve file ID, file name, and file size from message ──────────────
    const msg = (ctx.callbackQuery as any)?.message;
    let fileId: string | undefined;
    let fileSize: number = 0;
    let fileName = 'RealESRGAN_Enhanced.jpg';

    if (msg?.photo && msg.photo.length > 0) {
      const photo = msg.photo[msg.photo.length - 1];
      fileId = photo.file_id;
      fileSize = photo.file_size ?? 0;
    } else if (msg?.reply_to_message?.photo?.length > 0) {
      const photo = msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1];
      fileId = photo.file_id;
      fileSize = photo.file_size ?? 0;
    } else if (msg?.document?.mime_type?.startsWith('image/')) {
      fileId = msg.document.file_id;
      fileSize = msg.document.file_size ?? 0;
      fileName = (msg.document.file_name?.replace(/\.[^/.]+$/, '') || 'RealESRGAN_Enhanced') + '.jpg';
    } else if (msg?.reply_to_message?.document?.mime_type?.startsWith('image/')) {
      fileId = msg.reply_to_message.document.file_id;
      fileSize = msg.reply_to_message.document.file_size ?? 0;
      fileName = (msg.reply_to_message.document.file_name?.replace(/\.[^/.]+$/, '') || 'RealESRGAN_Enhanced') + '.jpg';
    }

    // STEP 1 — Pre-checks (before any DB write) ──────────────────────────────
    if (!fileId) {
      await ctx.answerCallbackQuery({ text: 'عذراً، لم أتمكن من العثور على الصورة ❌', show_alert: true });
      return;
    }

    if (fileSize > 2 * 1024 * 1024) {
      await ctx.answerCallbackQuery({ text: '❌ حجم الصورة يتجاوز 2 ميجابايت. يرجى إرسال صورة أصغر.', show_alert: true });
      return;
    }

    // STEP 2 — Atomic lock + deduction (3 points) ───────────────────────────
    const lockedUser = await User.findOneAndUpdate(
      {
        telegramId: ctx.from!.id.toString(),
        isProcessingImage: { $ne: true },
        dailyQuota: { $gte: 3 },
      },
      {
        $set: { isProcessingImage: true },
        $inc: { dailyQuota: -3 },
      },
      { new: true }
    );

    if (!lockedUser) {
      // Distinguish between «already processing» and «not enough quota»
      const check = await User.findOne({ telegramId: ctx.from!.id.toString() });
      if (check?.isProcessingImage) {
        await ctx.answerCallbackQuery({ text: '⏳ جاري معالجة طلبك بالفعل. انتظر حتى ينتهي.', show_alert: true });
        return;
      }
      await ctx.answerCallbackQuery({ text: '❌ رصيدك غير كافٍ. هذا التحسين يتطلب 3 محاولات.', show_alert: true });
      return;
    }

    // Acknowledge the button press
    await ctx.answerCallbackQuery({ text: 'بدأ التحسين... ⏳' }).catch(() => { });

    // Delete the inline-keyboard message
    try {
      if (msg?.message_id && msg?.chat?.id) {
        await ctx.api.deleteMessage(msg.chat.id, msg.message_id);
      }
    } catch (_e) { /* ignore */ }

    let processingMsg: { chat: { id: number }; message_id: number } | null = null;

    try {
      // STEP 3 — Queue status message ────────────────────────────────────────
      const queuePos = getQueuePosition();
      if (queuePos > 0) {
        processingMsg = await ctx.reply(
          `⏳ تم وضعك في طابور الانتظار (${queuePos} قبلك)...\nسيتم معالجة صورتك قريباً بتقنية RealESRGAN AI`
        );
      } else {
        processingMsg = await ctx.reply(
          '🔬 جاري تحليل صورتك بنموذج RealESRGAN AI...\nقد يستغرق 30-60 ثانية'
        );
      }

      // STEP 4 — Download image as Buffer ────────────────────────────────────
      const tgFile = await ctx.api.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;

      const fetchRes = await fetch(fileUrl);
      if (!fetchRes.ok) throw new Error('download_failed');

      const inputBuffer = Buffer.from(await fetchRes.arrayBuffer());

      // STEP 5 — Run RealESRGAN ───────────────────────────────────────────────
      if (processingMsg) {
        await ctx.api
          .editMessageText(
            processingMsg.chat.id,
            processingMsg.message_id,
            ' *جاري معالجة الصورة بلمسة سحرية...*\n⏳ يتم الآن رفع الدقة وإبراز التفاصيل المخفية، لحظات من فضلك.',
            { parse_mode: 'Markdown' }
          )
          .catch(() => { });
      }

      const resultBuffer = await enhanceWithONNX(inputBuffer);

      // Delete processing message
      if (processingMsg) {
        try { await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id); } catch (_e) { }
        processingMsg = null;
      }

      // STEP 6 — Deliver to user ─────────────────────────────────────────────
      const { incrementGlobalCounter } = await import('../../services/statsService');
      await incrementGlobalCounter();
      await ctx.replyWithDocument(
        new InputFile(resultBuffer, fileName),
        {
          caption: ' تم التحسين بنموذج RealESRGAN AI ×4 | NizoAI Bot 🚀',
          reply_to_message_id: ctx.msg?.message_id,
        }
      );

      // STEP 7 — Channel backup (untouched original logic) ───────────────────
      const actionUser = ctx.from;
      const userLink = actionUser?.username
        ? `@${actionUser.username}`
        : `<a href="tg://user?id=${actionUser?.id}">${actionUser?.first_name || 'مجهول'}</a>`;

      const archiveCaption =
        `📦 نسخة أرشيفية\n\n` +
        `🆔 User ID: ${actionUser?.id}\n` +
        `👤 Username: ${userLink}\n` +
        `💎 Resolution: RealESRGAN ×4\n` +
        `🕐 Time: ${new Date().toLocaleString('ar-SA')}`;

      await ctx.api.sendDocument(
        BACKUP_CHANNEL_ID,
        new InputFile(resultBuffer, fileName),
        { caption: archiveCaption, parse_mode: 'HTML' }
      );

      if (CHANNEL_ID && CHANNEL_ID !== BACKUP_CHANNEL_ID) {
        try {
          await ctx.api.sendDocument(
            CHANNEL_ID,
            new InputFile(resultBuffer, fileName),
            { caption: ' تمت المعالجة بنجاح', disable_notification: true }
          );
        } catch (e) {
          console.error('[RealESRGAN Channel Forward]', e);
        }
      }

    } catch (error: unknown) {
      // STEP 8 — Error handler + refund ──────────────────────────────────────
      // Do NOT refund if the error was a pre-download file-size rejection
      if (!(error instanceof Error && error.message === 'file_too_large')) {
        const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
        const isAdminCaller = adminIds.includes(ctx.from!.id.toString());
        if (!isAdminCaller) {
          await User.findOneAndUpdate(
            { telegramId: ctx.from!.id.toString() },
            { $inc: { dailyQuota: 3 } }
          );
        }
      }

      // Clean up any leftover processing message
      if (processingMsg) {
        try { await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id); } catch (_e) { }
      }

      const errMsg =
        error instanceof Error && error.message === 'download_failed'
          ? '❌ فشل تحميل الصورة. تم إرجاع محاولاتك.'
          : '❌ حدث خطأ في المعالجة. تم إرجاع محاولاتك.';

      await ctx.reply(errMsg);
      console.error('[RealESRGAN Error]', error);

    } finally {
      // STEP 9 — Release lock (always) ────────────────────────────────────────
      await User.findOneAndUpdate(
        { telegramId: ctx.from!.id.toString() },
        { $set: { isProcessingImage: false } }
      ).catch(() => { });
    }
    return;
  }

  // ── enhance_again ─────────────────────────────────────────────────────────────
  if (data === 'enhance_again') {
    await ctx.answerCallbackQuery().catch(() => { });
    await ctx.editMessageText('📸 أرسل الصورة الجديدة التي تريد تحسينها.');
    return;
  }

  // ══════════════════════════════════════
  // 🎁 الهدية اليومية
  // ══════════════════════════════════════
  if (data === 'notifications_menu') {
    await ctx.answerCallbackQuery().catch(() => { });
    await ctx.reply('قائمة الإشعارات 🔔\n\nاختر الإشعارات التي تود تفعيلها:', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔔 إشعارات الهدية اليومية', callback_data: 'toggle_daily_reminder', style: 'primary' } as any,
            { text: '🔒 إشعارات مهمة — قريباً', callback_data: 'coming_soon_reminder', style: 'primary' } as any,
          ],
          [
            { text: '🔴 رجوع', callback_data: 'back_to_main', style: 'danger' } as any,
          ],
        ],
      } as any,
    });
    return;
  }

  if (data === 'toggle_daily_reminder') {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;
    const user = await User.findOne({ telegramId });
    if (!user) return;

    if (!user.dailyReminderEnabled) {
      await User.findOneAndUpdate({ telegramId }, { $set: { dailyReminderEnabled: true } });
      await ctx.answerCallbackQuery({
        text: '✅ تم تفعيل إشعار الهدية اليومية!\n\nسنذكرك عندما تكون هديتك اليومية جاهزة للاستلام 🎁',
        show_alert: true
      }).catch(() => { });
    } else {
      await User.findOneAndUpdate({ telegramId }, { $set: { dailyReminderEnabled: false } });
      await ctx.answerCallbackQuery({
        text: '🔕 تم إيقاف إشعار الهدية اليومية.',
        show_alert: true
      }).catch(() => { });
    }
    return;
  }

  if (data === 'coming_soon_reminder') {
    await ctx.answerCallbackQuery({
      text: '🔒 هذه الميزة تحت الصيانة حالياً، ترقبها قريباً!',
      show_alert: true
    }).catch(() => { });
    return;
  }

  if (data === 'claim_daily_reward') {
    try {
      const telegramId = ctx.from?.id.toString();
      if (!telegramId) return;

      const claimUser = await User.findOne({ telegramId });
      if (!claimUser) return;

      // ── GATE 1: Check referral count ──
      const referralCount = claimUser.referralCount ?? 0;
      const REQUIRED_REFERRALS = 3;

      if (referralCount < REQUIRED_REFERRALS) {
        const remaining = REQUIRED_REFERRALS - referralCount;
        await ctx.answerCallbackQuery({
          text:
            `🍯 يا صديقي العسل!\n\n` +
            `الهدية اليومية محجوزة لك بس تحتاج تدعو أصدقاء أولاً 💙\n\n` +
            `👥 أصدقاؤك الحاليون: ${referralCount} / ${REQUIRED_REFERRALS}\n` +
            `📨 تحتاج دعوة ${remaining} صديق إضافي\n\n` +
            `شارك رابطك الآن واجمع محاولاتك! 🚀`,
          show_alert: true,
        }).catch(() => { });
        return;
      }

      // ── GATE 2: Check 24h cooldown ──
      const now = new Date();
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

      if (claimUser.lastRewardDate) {
        const timePassed = now.getTime() - new Date(claimUser.lastRewardDate).getTime();

        if (timePassed < TWENTY_FOUR_HOURS) {
          const timeLeft = TWENTY_FOUR_HOURS - timePassed;
          const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
          const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

          const claimTime = new Intl.DateTimeFormat('ar-SA', {
            timeZone: 'Asia/Riyadh',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          }).format(new Date(claimUser.lastRewardDate));

          await ctx.answerCallbackQuery({
            text:
              `❌ عزيزي، هديتك لم تكتمل بعد!\n\n` +
              `⏰ استلمت هديتك الساعة: ${claimTime}\n\n` +
              `⏳ الوقت المتبقي:\n` +
              `${hoursLeft} ساعة و ${minutesLeft} دقيقة\n\n` +
              `انتظر انتهاء الوقت لفتح الهدية من جديد 🎁`,
            show_alert: true,
          }).catch(() => { });
          return;
        }
      }

      // ── SUCCESS: Add 5 attempts atomically ──
      const updated = await User.findOneAndUpdate(
        { telegramId },
        {
          $inc: { dailyQuota: 5 },
          $set: { lastRewardDate: now, dailyReminderSent: false },
        },
        { new: true }
      );

      if (!updated) return;

      const newBalance = updated.dailyQuota;

      const claimTimeDisplay = new Intl.DateTimeFormat('ar-SA', {
        timeZone: 'Asia/Riyadh',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(now);

      const nextClaimTime = new Intl.DateTimeFormat('ar-SA', {
        timeZone: 'Asia/Riyadh',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(new Date(now.getTime() + TWENTY_FOUR_HOURS));

      await ctx.answerCallbackQuery({
        text:
          `🎉 تم! هديتك وصلت!\n\n` +
          `✅ تمت إضافة 5 محاولات مجانية\n` +
          `💎 رصيدك الآن: ${newBalance} محاولة\n\n` +
          `🕐 استلمت الهدية: ${claimTimeDisplay}\n` +
          `🔓 الهدية القادمة: ${nextClaimTime}\n\n` +
          `استمتع بتحسين صورك! 🚀`,
        show_alert: true,
      }).catch(() => { });

    } catch (error) {
      console.error('[DailyReward] Error:', error);
      await sendAdminAlert(ctx as any, `Daily Reward Error: ${(error as Error).message}`);
    }
    return;
  }

  // ══════════════════════════════════════
  // 🛡️ أزرار الأدمن — حظر وتقييد
  // ══════════════════════════════════════
  if (data.startsWith('admin_ban_')) {
    if (!isAdminUser) return;

    const targetId = data.replace('admin_ban_', '');
    await User.findOneAndUpdate({ telegramId: targetId }, { isBanned: true });

    await ctx.answerCallbackQuery({ text: '✅ تم حظر العميل بنجاح!', show_alert: true }).catch(() => { });
    await ctx.editMessageReplyMarkup(undefined);
    return;
  }

  if (data.startsWith('admin_restrict_')) {
    if (!isAdminUser) return;

    const targetId = data.replace('admin_restrict_', '');
    await User.findOneAndUpdate(
      { telegramId: targetId },
      { $set: { dailyQuota: 0, isRestricted: true } }
    );

    await ctx.answerCallbackQuery({ text: '✅ تم تقييد العميل وتصفير محاولاته بنجاح!', show_alert: true }).catch(() => { });
    await ctx.editMessageReplyMarkup(undefined);
    return;
  }
  if (data === 'show_welcome') {
    await ctx.answerCallbackQuery().catch(() => { });
    const { startCommand } = await import('../commands/start');
    await startCommand(ctx);
    return;
  }

  if (data === 'report_to_dev') {
    await ctx.answerCallbackQuery().catch(() => { });
    const telegramId = ctx.from?.id.toString();
    await User.findOneAndUpdate({ telegramId }, { $set: { awaitingReport: true } });
    await ctx.reply(
      '🌹 فضلاً أرسل لنا بلاغك (رسالة أو صورة)\nوسيتم الرد عليك في أسرع وقت ممكن 💬',
      {
        reply_markup: {
          // @ts-ignore
          inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_report', style: 'danger' as const }]],
        },
      }
    );
    return;
  }

  if (data === 'cancel_report') {
    await ctx.answerCallbackQuery({ text: 'تم الإلغاء' }).catch(() => { });
    const telegramId = ctx.from?.id.toString();
    await User.findOneAndUpdate({ telegramId }, { $set: { awaitingReport: false } });
    return;
  }

  if (data.startsWith('confirm_report_')) {
    await ctx.answerCallbackQuery();

    // Parse chatId and messageId from callback data
    const withoutPrefix = data.replace('confirm_report_', '');
    const underscoreIdx = withoutPrefix.indexOf('_');
    const sourceChatId = Number(withoutPrefix.substring(0, underscoreIdx));
    const sourceMessageId = Number(withoutPrefix.substring(underscoreIdx + 1));

    if (!sourceChatId || !sourceMessageId || isNaN(sourceChatId) || isNaN(sourceMessageId)) {
      await ctx.editMessageText('❌ انتهت صلاحية البلاغ. يرجى إرسال بلاغ جديد.').catch(() => { });
      return;
    }

    const adminIdsRaw = process.env.ADMIN_IDS || '';
    const adminIds = adminIdsRaw.split(',').map((id) => id.trim());

    const userId = ctx.from?.id;
    const firstName = ctx.from?.first_name || 'مجهول';
    const username = ctx.from?.username ? `@${ctx.from.username}` : 'لا يوجد معرف';
    const userLink = `tg://user?id=${userId}`;

    const reportHeader =
      `🚨 <b>بلاغ جديد من عميل</b>\n\n` +
      `👤 <b>العميل:</b> <a href="${userLink}">${firstName}</a>\n` +
      `🔗 <b>المعرف:</b> ${username}\n` +
      `🆔 <b>الـ ID:</b> <code>${userId}</code>\n` +
      `📅 <b>التوقيت:</b> ${new Date().toLocaleString('ar-SA')}`;

    let forwarded = false;

    for (const adminId of adminIds) {
      try {
        // Send header with user info and action buttons
        await ctx.api.sendMessage(Number(adminId), reportHeader, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              // @ts-ignore
              [{ text: '🚫 حظر العميل', callback_data: `admin_ban_${userId}`, style: 'primary' as const }],
              [{ text: '🔒 تقييد العميل', callback_data: `admin_restrict_${userId}`, style: 'primary' as const }],
              // @ts-ignore
              [{ text: '💬 فتح محادثة دعم', callback_data: `admin_support_${userId}`, style: 'primary' as const }],
            ],
          },
        });

        // Forward the original message (works for ALL types)
        await ctx.api.forwardMessage(Number(adminId), sourceChatId, sourceMessageId);
        forwarded = true;
      } catch (e) {
        console.error('[Report Forward] Error for admin', adminId, e);
      }
    }

    // Update confirmation message
    try {
      await ctx.editMessageText(
        forwarded
          ? '✅ <b>تم إرسال بلاغك للمطور بنجاح!</b>\n\nسيتم الرد عليك في أقرب وقت ممكن 🌹'
          : '❌ حدث خطأ أثناء إرسال البلاغ. حاول مجدداً.',
        { parse_mode: 'HTML' }
      );
    } catch { }
    return;
  }

  // ══════════════════════════════════════
  // 💬 فتح جلسة دعم مع العميل
  // ══════════════════════════════════════
  if (data.startsWith('admin_support_')) {
    if (!isAdminUser) return;

    const targetUserId = data.replace('admin_support_', '');

    // Activate support session in DB
    await User.findOneAndUpdate(
      { telegramId: targetUserId },
      { $set: { supportSessionActive: true, supportSessionAdminId: ctx.from?.id.toString() } }
    );

    // Notify admin
    await ctx.answerCallbackQuery({ text: '✅ تم فتح المحادثة المباشرة' }).catch(() => { });
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.api.sendMessage(
      ctx.from!.id,
      `✅ <b>تم فتح المحادثة المباشرة مع العميل.</b>\n` +
      `أي رسالة أو صورة أو ملف ترسله الآن سيصل إليه مباشرة.\n` +
      `لإغلاق المحادثة، أرسل <code>/endchat</code> أو <b>اغلق المحادثة</b>`,
      { parse_mode: 'HTML' }
    );

    // Notify user
    await ctx.api.sendMessage(
      targetUserId,
      `🛠 <b>تنبيه من فريق الدعم</b>\n\nلقد وصلنا تنبيهاً بأنك تواجه مشكلة.\nأحد مطوري البوت معك الآن وسيتم حل مشكلتك في أسرع وقت 💙`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // ══════════════════════════════════════
  // 🛠 ADMIN PANEL HANDLERS
  // ══════════════════════════════════════


  // ── Stats ──
  if (data === 'admin_stats' && isAdminUser) {
    const totalUsers = await User.countDocuments();
    const bannedUsers = await User.countDocuments({ isBanned: true });
    const activeToday = await User.countDocuments({
      lastRewardDate: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });
    await ctx.answerCallbackQuery().catch(() => { });
    await ctx.reply(
      `📊 <b>إحصائيات البوت</b>\n\n` +
      `👥 إجمالي المستخدمين: <b>${totalUsers}</b>\n` +
      `🚫 المحظورون: <b>${bannedUsers}</b>\n` +
      `🟢 نشطون اليوم: <b>${activeToday}</b>`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // ── Edit Welcome Message ──
  if (data === 'admin_edit_welcome' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingReport: false, adminAwaitingInput: 'welcome_message' } }
    );
    await ctx.reply('✏️ أرسل الآن النص الجديد لرسالة الترحيب:');
    return;
  }

  // ── Edit Daily Reward Amount ──
  if (data === 'admin_edit_daily' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'daily_reward_amount' } }
    );
    await ctx.reply('🎁 أرسل العدد الجديد للمحاولات اليومية (مثال: 5):');
    return;
  }

  // ── Edit Low Attempts Warning ──
  if (data === 'admin_edit_low' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'low_attempts_warning' } }
    );
    await ctx.reply('⚠️ أرسل الآن نص رسالة انتهاء المحاولات:');
    return;
  }

  // ── Broadcast ──
  if (data === 'admin_broadcast' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'broadcast' } }
    );
    await ctx.reply('📢 أرسل الآن الرسالة التي تريد إرسالها لجميع المستخدمين:');
    return;
  }

  // ── Search User ──
  if (data === 'admin_search_user' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'search_user' } }
    );
    await ctx.reply('🔍 أرسل الـ ID أو username للمستخدم:');
    return;
  }

  // ── Maintenance Mode ──
  if (data === 'admin_maintenance' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    const current = await BotSettings.findOne({ key: 'maintenance_mode' });
    const currentVal = current?.value === 'true';
    await BotSettings.findOneAndUpdate(
      { key: 'maintenance_mode' },
      { value: currentVal ? 'false' : 'true' },
      { upsert: true }
    );
    await ctx.reply(
      currentVal
        ? '✅ تم إيقاف وضع الصيانة — البوت يعمل الآن'
        : '🔧 تم تفعيل وضع الصيانة — البوت متوقف مؤقتاً'
    );
    return;
  }

  // ── Unban user ──
  if (data.startsWith('admin_unban_') && isAdminUser) {
    const targetId = data.replace('admin_unban_', '');
    await User.findOneAndUpdate({ telegramId: targetId }, { isBanned: false });
    await ctx.answerCallbackQuery({ text: '✅ تم رفع الحظر' }).catch(() => { });
    await ctx.editMessageReplyMarkup(undefined);
    return;
  }

  // ── Add attempts to user ──
  if (data.startsWith('admin_addattempts_') && isAdminUser) {
    const targetId = data.replace('admin_addattempts_', '');
    await User.findOneAndUpdate({ telegramId: targetId }, { $inc: { dailyQuota: 5 } });
    await ctx.answerCallbackQuery({ text: '✅ تمت إضافة 5 محاولات' }).catch(() => { });
    return;
  }

  // ══════════════════════════════════════
  // 📢 تمويل أعضاء — بدء الحملة
  // ══════════════════════════════════════
  if (data === 'start_fund_campaign' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    startFundCampaignSetup(ctx.from!.id);
    await ctx.reply(
      '📢 <b>إنشاء حملة تمويل أعضاء</b>\n\nأرسل رابط القناة أو المجموعة المراد تمويلها:',
      {
        parse_mode: 'HTML',
        reply_markup: {
          // @ts-ignore
          inline_keyboard: [[{ text: '↩️ رجوع', callback_data: 'cancel_fund_campaign', style: 'danger' as const }]],
        },
      }
    );
    return;
  }

  if (data === 'cancel_fund_campaign' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    clearFundCampaignState(ctx.from!.id);
    await ctx.reply('❌ تم إلغاء إنشاء الحملة.');
    return;
  }

  // ══════════════════════════════════════
  // 🎁 claim_reward_{channelId}
  // ══════════════════════════════════════
  if (data.startsWith('claim_reward_')) {
    const channelId = data.replace('claim_reward_', '');
    const userId = ctx.from!.id;

    const result = await claimChannelReward(userId, channelId, ctx.api);

    if (result === 'REWARDED') {
      await ctx.answerCallbackQuery().catch(() => { });
      await ctx.reply('✅ تم التحقق! تم إضافة 5 محاولات لرصيدك 🎉\nاستمتع بتحسين صورك بجودة احترافية 🌟');
    } else if (result === 'ALREADY_CLAIMED') {
      await ctx.answerCallbackQuery({ text: 'لقد حصلت على مكافأة هذه القناة من قبل ✅', show_alert: true }).catch(() => { });
    } else if (result === 'PROCESSING') {
      await ctx.answerCallbackQuery({ text: 'جاري المعالجة، انتظر لحظة... ⏳', show_alert: false }).catch(() => { });
    } else if (result === 'NOT_MEMBER') {
      await ctx.answerCallbackQuery({
        text: 'عذراً! لم يتم التحقق من اشتراكك بعد ❌\nالرجاء الاشتراك في القناة أولاً عبر الرابط، ثم اضغط على الزر للحصول على مكافأتك 🎁',
        show_alert: true
      }).catch(() => { });
    } else if (result === 'ADMIN_BLOCKED') {
      await ctx.answerCallbackQuery({ text: '🚫 المشرف لا يمكنه المطالبة بمكافأة حملته.', show_alert: true }).catch(() => { });
    } else {
      await ctx.answerCallbackQuery({ text: '❌ الحملة غير موجودة أو انتهت.', show_alert: true }).catch(() => { });
    }
    return;
  }

  // ══════════════════════════════════════
  // 🗑 delete_broadcast_{campaignId}
  // ══════════════════════════════════════
  if (data.startsWith('delete_broadcast_') && isAdminUser) {
    await ctx.answerCallbackQuery({ text: 'جاري حذف الإذاعة... 🗑' }).catch(() => { });

    const campaignId = data.replace('delete_broadcast_', '');
    const campaign = await FundCampaign.findById(campaignId);

    if (!campaign) {
      await ctx.reply('❌ لم يتم العثور على الحملة.');
      return;
    }

    let deleted = 0;
    let deleteFailed = 0;

    for (const { userId: uid, messageId } of campaign.broadcastMessages) {
      try {
        await ctx.api.deleteMessage(uid, messageId);
        deleted++;
      } catch (e) {
        deleteFailed++;
      }
    }

    await FundCampaign.findByIdAndUpdate(campaignId, { isActive: false });

    await ctx.reply(`🗑 تم حذف الإذاعة:\n✅ حُذف: ${deleted}\n❌ فشل: ${deleteFailed}`);

    try { await ctx.deleteMessage(); } catch (e) { }
    return;
  }

  // ══════════════════════════════════════
  // 🚀 Pro Enhance — Step 1: Quality
  // ══════════════════════════════════════
  if (data === 'pro_enhance_start') {
    await ctx.answerCallbackQuery().catch(() => { });
    await ctx.reply(
      '🚀 <b>Pro Enhance</b>\n\n<b>الخطوة 1/3 — اختر جودة التحسين:</b>',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            // @ts-ignore
            [{ text: '⚡ سريع (جودة عالية)', callback_data: 'pro_q_fast', style: 'primary' as const }],
            [{ text: '💎 احترافي (جودة فائقة)', callback_data: 'pro_q_pro', style: 'primary' as const }],
            // @ts-ignore
            [{ text: '🏆 ماكس (أعلى جودة)', callback_data: 'pro_q_max', style: 'primary' as const }],
            [{ text: '❌ إلغاء', callback_data: 'pro_cancel', style: 'danger' as const }],
          ],
        },
      }
    );
    return;
  }

  // Step 1 answers → Step 2: Scale
  if (['pro_q_fast', 'pro_q_pro', 'pro_q_max'].includes(data)) {
    await ctx.answerCallbackQuery().catch(() => { });
    const qualityMap: Record<string, string> = {
      pro_q_fast: 'fast',
      pro_q_pro: 'pro',
      pro_q_max: 'max',
    };
    const quality = qualityMap[data];
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { 'proEnhanceSettings.quality': quality, 'proEnhanceSettings.scale': null, 'proEnhanceSettings.imageType': null } }
    );
    await ctx.reply(
      '🚀 <b>Pro Enhance</b>\n\n<b>الخطوة 2/3 — اختر مقياس التكبير:</b>',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            // @ts-ignore
            [{ text: '2x — تكبير مضاعف', callback_data: 'pro_s_2', style: 'primary' as const }],
            [{ text: '4x — تكبير رباعي (موصى به)', callback_data: 'pro_s_4', style: 'primary' as const }],
            // @ts-ignore
            [{ text: '❌ إلغاء', callback_data: 'pro_cancel', style: 'danger' as const }],
          ],
        },
      }
    );
    return;
  }

  // Step 2 answers → Step 3: Image Type
  if (['pro_s_2', 'pro_s_4'].includes(data)) {
    await ctx.answerCallbackQuery().catch(() => { });
    const scale = data === 'pro_s_2' ? '2' : '4';
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { 'proEnhanceSettings.scale': scale } }
    );
    await ctx.reply(
      '🚀 <b>Pro Enhance</b>\n\n<b>الخطوة 3/3 — نوع الصورة:</b>',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            // @ts-ignore
            [{ text: '🖼 صورة عادية', callback_data: 'pro_t_photo', style: 'primary' as const }],
            [{ text: '👤 وجه / بورتريه', callback_data: 'pro_t_face', style: 'primary' as const }],
            // @ts-ignore
            [{ text: '🎨 رسم / أنمي / فن', callback_data: 'pro_t_art', style: 'primary' as const }],
            [{ text: '❌ إلغاء', callback_data: 'pro_cancel', style: 'danger' as const }],
          ],
        },
      }
    );
    return;
  }

  // Step 3 answers → Process
  if (['pro_t_photo', 'pro_t_face', 'pro_t_art'].includes(data)) {
    await ctx.answerCallbackQuery().catch(() => { });

    const typeMap: Record<string, string> = {
      pro_t_photo: 'photo',
      pro_t_face: 'face',
      pro_t_art: 'art',
    };
    const imageType = typeMap[data];
    const telegramId = ctx.from!.id.toString();

    await User.findOneAndUpdate(
      { telegramId },
      { $set: { 'proEnhanceSettings.imageType': imageType } }
    );

    const freshUser = await User.findOne({ telegramId });
    const settings = freshUser?.proEnhanceSettings;

    // Smart cost calculation based on quality (Max = 3, others = 2)
    const enhanceCost = settings?.quality === 'max' ? 3 : 2;

    const costMsg = enhanceCost === 3
      ? `🏆 اخترت الجودة الفائقة (Max)\n⚠️ سيتم خصم <b>3 محاولات</b> من رصيدك.`
      : `💎 اخترت الجودة القوية\n⚠️ سيتم خصم <b>2 محاولة</b> من رصيدك.`;

    await ctx.reply(
      `🚀 <b>Pro Enhance — تأكيد</b>\n\n${costMsg}\n\nهل أنت موافق؟`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              // @ts-ignore
              { text: '✅ نعم، ابدأ التحسين', callback_data: 'pro_confirm_yes', style: 'success' as const },
              { text: '❌ لا، إلغاء', callback_data: 'pro_cancel', style: 'danger' as const },
            ],
          ],
        },
      }
    );
    return;
  }

  // ══════════════════════════════════════
  // ✅ Pro Enhance — Confirmed, start processing
  // ══════════════════════════════════════
  if (data === 'pro_confirm_yes') {
    await ctx.answerCallbackQuery().catch(() => { });

    const userId = ctx.from!.id;
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const isAdmin = adminIds.includes(userId.toString());

    const user = await User.findOne({ telegramId: userId.toString() });
    if (!user) return;

    const settings = user.proEnhanceSettings;
    if (!settings?.quality || !settings?.scale || !settings?.imageType) {
      await ctx.reply('❌ حدث خطأ في الإعدادات. يرجى البدء من جديد بالضغط على زر Pro Enhance.');
      return;
    }

    // Calculate cost
    const enhanceCost = settings.quality === 'max' ? 3 : 2;

    // Check quota (BUT DO NOT DEDUCT YET - wait for image)
    if (!isAdmin && user.dailyQuota < enhanceCost) {
      await ctx.reply(
        `⚠️ رصيدك غير كافٍ لهذا الخيار 🥺\n` +
        `تحتاج ${enhanceCost} محاولات، رصيدك الحالي: ${user.dailyQuota}\n\n` +
        `💎 لشراء محاولات إضافية تواصل مع الإدارة.`
      );
      return;
    }

    // Set awaiting image flag
    await User.findOneAndUpdate(
      { telegramId: userId.toString() },
      { $set: { 'proEnhanceSettings.isAwaitingImage': true } }
    );

    // Ask user to send image NOW
    await ctx.reply(
      `✅ تم حفظ إعداداتك بنجاح!\n\n` +
      `📸 أرسل <b>الصورة</b> الآن وسيبدأ التحسين فوراً 🚀\n` +
      `(يمكنك إرسالها كصورة عادية أو كملف للحفاظ على الجودة)\n\n` +
      `<i>ملاحظة: سيتم خصم ${isAdmin ? '0 (أدمن)' : enhanceCost} محاولات عند استلام الصورة.</i>`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // Cancel Pro Enhance
  if (data === 'pro_cancel') {
    await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' }).catch(() => { });
    return;
  }

  // ════════════════════════════════
  // Admin Panel
  // ════════════════════════════════

  if (data === 'admin_panel') {
    if (!isAdminUser) return;
    await ctx.answerCallbackQuery().catch(() => { });

    // ── [KILL-SWITCH BUTTON] ──
    const { isInternetFetcherEnabled: _ifePanel } = await import('../../utils/internetFetcherSettings');
    const _panelOn: boolean = _ifePanel();

    const buildAdminKeyboard = (l: typeof locks) => ({
      inline_keyboard: [
        // @ts-ignore
        [{ text: `${l.btn_2k ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 2K`, callback_data: 'atoggle_btn_2k', style: 'primary' as const }],
        [{ text: `${l.btn_4k ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 4K`, callback_data: 'atoggle_btn_4k', style: 'primary' as const }],
        // @ts-ignore
        [{ text: `${l.btn_8k ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 8K`, callback_data: 'atoggle_btn_8k', style: 'primary' as const }],
        [{ text: `${l.btn_4kai ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 4K-Ai`, callback_data: 'atoggle_btn_4kai', style: 'primary' as const }],
        // @ts-ignore
        [{ text: `${l.btn_8kai ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 8K-Ai`, callback_data: 'atoggle_btn_8kai', style: 'primary' as const }],
        [{ text: `${l.btn_nano ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} —  Nano AI`, callback_data: 'atoggle_btn_nano', style: 'primary' as const }],
        // @ts-ignore
        [{ text: `${l.btn_eraser ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} —  مُزيل العلامات المائية`, callback_data: 'atoggle_btn_eraser', style: 'primary' as const }],
        [{ text: `${l.btn_filters ? '🔴 مقفل' : '🟢 مفتوح'} — 🎨 فلاتر الصور`, callback_data: 'atoggle_btn_filters', style: 'primary' as const }],
        // @ts-ignore
        [{ text: '🔑 سماح لشخص باستخدام الميزات المقفلة', callback_data: 'admin_grant_vip', style: 'primary' as const }],
        [{ text: '📢 قنوات الاشتراك الإجباري', callback_data: 'admin_force_sub', style: 'primary' as const }],
        // @ts-ignore
        [{ text: '🌟 تفعيل الأحجام الكبيرة (15MB)', callback_data: 'admin_vip_size', style: 'primary' as const }],
        [{ text: '🎁 التوزيعات وعجلة الحظ', callback_data: 'admin_giveaway_start', style: 'primary' as const }],
        // @ts-ignore
        [{ text: `${l.btn_magic_enhance ? '🔴 مقفل' : '🟢 مفتوح'} — 🪄 تحسين الصورة (AI)`, callback_data: 'atoggle_btn_magic_enhance', style: 'primary' as const }],
        // @ts-ignore
        [{ text: `${l.btn_design ? '🔴 مقفل' : '🟢 مفتوح'} — 🟦 تصميم مجاني`, callback_data: 'atoggle_btn_design', style: 'primary' as const }],
        // @ts-ignore
        [{
          text: _panelOn
            ? '🟢 تحميل الإنترنت: مفعّل — اضغط لإيقافه'
            : '🔴 تحميل الإنترنت: موقوف — اضغط لتفعيله',
          callback_data: 'admin_toggle_internet_fetcher',
          style: 'primary' as const,
        }],
        // @ts-ignore
        [{ text: '❌ إغلاق', callback_data: 'admin_close', style: 'danger' as const }],
      ]
    });

    await ctx.reply(
      '<b>⚙️ لوحة تحكم الأدمن</b>\n🟢 = مفتوح للجميع | 🔴 = مقفل',
      { parse_mode: 'HTML', reply_markup: buildAdminKeyboard(locks) }
    );
    return;
  }


  if (data === 'admin_grant_vip' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    await User.findOneAndUpdate(
      { telegramId: ctx.from.id.toString() },
      { $set: { adminAwaitingInput: 'grant_vip_id', adminTargetUserId: null } }
    );
    await ctx.reply('🔑 <b>تجاوز أقفال الميزات</b>\n\nأرسل الـ ID الخاص بالمستخدم الذي تريد منحه صلاحية تجاوز الإغلاق:', { parse_mode: 'HTML' });
    return;
  }


  if (data === 'admin_grant_vip' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    await User.findOneAndUpdate(
      { telegramId: ctx.from.id.toString() },
      { $set: { adminAwaitingInput: 'grant_vip_id', adminTargetUserId: null } }
    );
    await ctx.reply('🔑 <b>تجاوز أقفال الميزات</b>\n\nأرسل الـ ID الخاص بالمستخدم الذي تريد منحه صلاحية تجاوز الإغلاق:', { parse_mode: 'HTML' });
    return;
  }



  if (data.startsWith('atoggle_') && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    const field = data.replace('atoggle_', '');
    const newSettings = await toggleLock(field);
    const newLocks = newSettings.locks;

    const buildAdminKeyboard = (l: typeof newLocks) => ({
      inline_keyboard: [
        // @ts-ignore
        [{ text: `${l.btn_2k ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 2K`, callback_data: 'atoggle_btn_2k', style: 'primary' as const }],
        [{ text: `${l.btn_4k ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 4K`, callback_data: 'atoggle_btn_4k', style: 'primary' as const }],
        // @ts-ignore
        [{ text: `${l.btn_8k ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 8K`, callback_data: 'atoggle_btn_8k', style: 'primary' as const }],
        [{ text: `${l.btn_4kai ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 4K-Ai`, callback_data: 'atoggle_btn_4kai', style: 'primary' as const }],
        // @ts-ignore
        [{ text: `${l.btn_8kai ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 8K-Ai`, callback_data: 'atoggle_btn_8kai', style: 'primary' as const }],
        [{ text: `${l.btn_nano ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} —  Nano AI`, callback_data: 'atoggle_btn_nano', style: 'primary' as const }],
        // @ts-ignore
        [{ text: `${l.btn_eraser ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} —  مُزيل العلامات المائية`, callback_data: 'atoggle_btn_eraser', style: 'primary' as const }],
        [{ text: `${l.btn_filters ? '🔴 مقفل' : '🟢 مفتوح'} — 🎨 فلاتر الصور`, callback_data: 'atoggle_btn_filters', style: 'primary' as const }],
        // @ts-ignore
        [{ text: '🔑 سماح لشخص باستخدام الميزات المقفلة', callback_data: 'admin_grant_vip', style: 'primary' as const }],
        [{ text: '📢 قنوات الاشتراك الإجباري', callback_data: 'admin_force_sub', style: 'primary' as const }],
        // @ts-ignore
        [{ text: '🌟 تفعيل الأحجام الكبيرة (15MB)', callback_data: 'admin_vip_size', style: 'primary' as const }],
        [{ text: '🎁 التوزيعات وعجلة الحظ', callback_data: 'admin_giveaway_start', style: 'primary' as const }],
        // @ts-ignore
        [{ text: `${l.btn_magic_enhance ? '🔴 مقفل' : '🟢 مفتوح'} — 🪄 تحسين الصورة (AI)`, callback_data: 'atoggle_btn_magic_enhance', style: 'primary' as const }],
        // @ts-ignore
        [{ text: `${l.btn_design ? '🔴 مقفل' : '🟢 مفتوح'} — 🟦 تصميم مجاني`, callback_data: 'atoggle_btn_design', style: 'primary' as const }],
        // @ts-ignore
        [{ text: '❌ إغلاق', callback_data: 'admin_close', style: 'danger' as const }],
      ]
    });

    await ctx.api.editMessageReplyMarkup(
      ctx.chat!.id,
      ctx.msgId!,
      { reply_markup: buildAdminKeyboard(newLocks) }
    );
    return;
  }

  if (data === 'admin_vip_size') {
    await ctx.answerCallbackQuery();
    await User.findOneAndUpdate({ telegramId: ctx.from!.id.toString() }, { $set: { adminAwaitingInput: 'vip_size_bypass' } });
    await ctx.reply('🌟 <b>تفعيل الأحجام الكبيرة (VIP)</b>\n\nأرسل الآن <b>ID</b> الخاص بالمستخدم لفتح الحد له إلى 15 ميجابايت:', { parse_mode: 'HTML' });
    return;
  }

  // ── Support Send Confirmation ─────────────────────────────────
  if (data.startsWith('confirm_support_send_') && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });

    const targetUserId = data.replace('confirm_support_send_', '');

    // The original message is the one this confirmation was replied to
    const originalMessage = ctx.callbackQuery?.message?.reply_to_message;

    if (!originalMessage) {
      await ctx.reply('❌ لم أتمكن من العثور على الرسالة الأصلية.');
      return;
    }

    try {
      // Copy the exact original message (text/photo/file) to the target user
      await ctx.api.copyMessage(
        targetUserId,
        originalMessage.chat.id,
        originalMessage.message_id
      );

      await ctx.editMessageReplyMarkup(undefined);
      await ctx.reply('✅ تم إرسال الرسالة للعميل بنجاح 💙');
    } catch (e) {
      await ctx.reply('❌ فشل إرسال الرسالة. ربما حظر العميل البوت.');
    }
    return;
  }

  if (data === 'cancel_support_send' && isAdminUser) {
    await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' }).catch(() => { });
    await ctx.editMessageReplyMarkup(undefined);
    return;
  }

  if (data === 'admin_close' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    await ctx.deleteMessage();
    return;
  }

  if (data === 'nano_banana_start') {
    await ctx.answerCallbackQuery().catch(() => { });

    // Fetch fresh user and check admin
    const nanoUser = await User.findOne({ telegramId: ctx.from!.id.toString() });
    if (!nanoUser) return;
    const nanoAdminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const isNanoAdmin = nanoAdminIds.includes(ctx.from!.id.toString());

    if (!isNanoAdmin && nanoUser.dailyQuota < 3) {
      await ctx.reply(
        `⚠️ رصيدك غير كافٍ!\n` +
        `تحتاج <b>3 محاولات</b> لاستخدام هذه الميزة \n` +
        `رصيدك الحالي: <b>${nanoUser.dailyQuota}</b> محاولة`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingNanoBananaImage: true } }
    );

    await ctx.reply(
      '🤖 <b>تحسين الصورة بتقنية NizoAI الخاصة</b>\n\n' +
      '📸 أرسل لي الصورة الآن وسأقوم بتحسينها احترافياً مع الحفاظ على هويتها الأصلية 100% 🚀\n\n' +
      '💎 <b>السعر: 3 محاولات</b>\n' +
      '⏱ <b>مدة المعالجة:</b> 60 - 120 ثانية حسب حجم الصورة\n\n' +
      '💡 <b>تفاصيل مهمة:</b>\n' +
      '• يعمل النموذج على خوادم متخصصة بتكلفة <b>0.5$ - 1$</b> لكل صورة\n' +
      '• نقدمه لك <b>مجاناً</b> ضمن رصيدك اليومي 🎁\n' +
      '• قد تستغرق المعالجة دقيقتين في أوقات الذروة\n' +
      '• يمكنك إرسالها كصورة عادية أو كملف للحفاظ على الجودة\n\n' +
      '⚠️ <b>ملاحظة:</b> الصور التي تتجاوز 10MB لن تُقبل',
      {
        parse_mode: 'HTML',
        reply_markup: {
          // @ts-ignore
          inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_nano_banana', style: 'danger' as const }]]
        }
      }
    );
    return;
  }

  if (data === 'cancel_nano_banana') {
    await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' }).catch(() => { });
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingNanoBananaImage: false } }
    );
    await ctx.deleteMessage().catch(() => { });
    return;
  }

  // ── Internet Image Fetcher Handlers ──────────────────────────────────────────

  if (data === 'menu_internet_download') {
    // ── [GUARD-A] Kill-Switch — Button Click ──
    const { isInternetFetcherEnabled: _ifeA } = await import('../../utils/internetFetcherSettings');
    const _adminIds: string[] = (process.env.ADMIN_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean);
    const _adminA: boolean = _adminIds.includes(ctx.from?.id?.toString() ?? '');
    if (!_ifeA() && !_adminA) {
      await ctx.answerCallbackQuery({
        text: '🔧 هذه الميزة تحت الصيانة حالياً\n\n✨ سيتم إعادة تفعيلها قريباً إن شاء الله 🌟\n💙 نعتذر عن الإزعاج',
        show_alert: true,
      }).catch(() => { });
      return;
    }
    // ── [END GUARD-A] ──
    await ctx.answerCallbackQuery().catch(() => { });
    await ctx.reply(
      '🧞‍♂️ <b>تحميل صورة من الإنترنت</b>\n\nاختر ما تريد:',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📥 تحميل صورة من رابط', callback_data: 'ask_internet_link', style: 'primary' as any }],
            [{ text: '🔍 بحث عن صورة 🔒', callback_data: 'locked_search_feature', style: 'primary' as any }],
            [{ text: '🔙 رجوع', callback_data: 'show_welcome', style: 'danger' as any }],
          ]
        }
      }
    );
    return;
  }

  if (data === 'locked_search_feature') {
    await ctx.answerCallbackQuery({
      text: 'هذه الميزة قيد التطوير حالياً ⏳',
      show_alert: true,
    }).catch(() => { });
    return;
  }

  if (data === 'ask_internet_link') {
    await ctx.answerCallbackQuery().catch(() => { });
    if (ctx.session) ctx.session.awaitingInternetLink = true;
    const replyOpts = {
      parse_mode: 'HTML' as const,
      reply_markup: {
        inline_keyboard: [[
          { text: '❌ إلغاء', callback_data: 'cancel_internet_download', style: 'danger' as any }
        ]]
      }
    };
    const replyText =
      '🔗 <b>أرسل رابط الصورة الآن</b>\n\n' +
      'أرسل لي رابط الصورة وسأقوم بسحبها بأعلى دقة ممكنة 🧞‍♂️\n\n' +
      '<i>مثال: https://example.com/image.jpg</i>';
    await ctx.editMessageText(replyText, replyOpts).catch(async () => {
      await ctx.reply(replyText, replyOpts);
    });
    return;
  }

  if (data === 'cancel_internet_download') {
    await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' }).catch(() => { });
    if (ctx.session) ctx.session.awaitingInternetLink = false;
    await ctx.deleteMessage().catch(() => { });
    return;
  }


  if (data === 'magic_enhance_start') {
    await ctx.answerCallbackQuery().catch(() => { });

    const magicUser = await User.findOne({ telegramId: ctx.from!.id.toString() });
    if (!magicUser) return;
    const magicAdminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const isMagicAdmin = magicAdminIds.includes(ctx.from!.id.toString());

    if (!isMagicAdmin && magicUser.dailyQuota < 5) {
      await ctx.reply(
        `⚠️ رصيدك غير كافٍ!\n` +
        `تحتاج 5 محاولات لاستخدام هذه الميزة.\n` +
        `رصيدك الحالي: ${magicUser.dailyQuota} محاولة`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingMagicEnhanceImage: true } }
    );

    await ctx.reply(
      '🪄 <b>تحسين الصورة (AI)</b>\n\n' +
      '📸 أرسل لي الصورة الآن وسأعيد توليدها بجودة استوديو احترافية مع الحفاظ على كل تفاصيلها الأصلية 🚀\n\n' +
      '💸 السعر: 5 محاولات\n' +
      'يمكنك إرسالها كصورة عادية أو كملف للحفاظ على الجودة',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_magic_enhance', style: 'danger' as any }]]
        }
      }
    );
    return;
  }

  if (data === 'cancel_magic_enhance') {
    await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' }).catch(() => { });
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingMagicEnhanceImage: false } }
    );
    await ctx.deleteMessage().catch(() => { });
    return;
  }

  if (data.startsWith('magic_fmt_')) {
    await ctx.answerCallbackQuery();

    const magicConvUser = await User.findOne({ telegramId: ctx.from!.id.toString() });
    if (!magicConvUser?.lastMagicEnhanceBuffer) {
      await ctx.reply('❌ انتهت صلاحية الملف. أرسل الصورة مجدداً.');
      return;
    }

    const formatMap: Record<string, string> = {
      magic_fmt_jpg: 'jpeg',
      magic_fmt_png: 'png',
      magic_fmt_webp: 'webp',
      magic_fmt_avif: 'avif',
      magic_fmt_tiff: 'tiff',
    };
    const targetFormat = formatMap[data];
    if (!targetFormat) return;

    const processingMsg = await ctx.reply(
      `⏳ جاري تحويل الصيغة إلى ${data.split('_')[2].toUpperCase()}...`
    );

    try {
      const inputBuffer = Buffer.from(magicConvUser.lastMagicEnhanceBuffer, 'base64');
      const convertedBuffer = await sharp(inputBuffer)
        .toFormat(targetFormat as any, { quality: 95 })
        .toBuffer();

      await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id).catch(() => { });

      const ext = targetFormat === 'jpeg' ? 'jpg' : targetFormat;
      await ctx.replyWithDocument(
        new InputFile(convertedBuffer, `NizoAI_${ext.toUpperCase()}_${Date.now()}.${ext}`),
        { caption: `✅ تم التحويل إلى ${ext.toUpperCase()} بنجاح` }
      );
    } catch (err: any) {
      await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id).catch(() => { });
      await ctx.reply('❌ فشل التحويل. حاول مرة أخرى.');
      console.error('[MagicFmt] Error:', err.message);
    }
    return;
  }

  // ══════════════════════════════════════
  // 🖼 تحويل صيغة الملف
  // ══════════════════════════════════════
  if (['conv_png', 'conv_jpg', 'conv_webp', 'conv_avif', 'conv_tiff', 'conv_pdf', 'conv_svg'].includes(data)) {
    await ctx.answerCallbackQuery({ text: 'جاري تحويل الصيغة... ⏳' });

    const format = data.replace('conv_', '') as 'png' | 'jpg' | 'webp' | 'avif' | 'tiff' | 'pdf' | 'svg';
    const document = (ctx.callbackQuery as any)?.message?.document;

    if (!document) {
      await ctx.reply('❌ لم أتمكن من العثور على الملف الأصلي. أرسل الصورة مجدداً.');
      return;
    }

    // Telegram Bot API hard limit: cannot download files > 20MB
    if (document.file_size && document.file_size > 20 * 1024 * 1024) {
      await ctx.reply(
        '❌ عذراً، حجم الملف يتجاوز 20 ميجابايت.\n' +
        'قيود تيليجرام تمنع تحويل الملفات الكبيرة جداً.'
      );
      return;
    }

    const loadingMsg = await ctx.reply(`🔄 جاري التحويل إلى ${format.toUpperCase()}...`);

    try {
      // Download file from Telegram
      const tgFile = await ctx.api.getFile(document.file_id);
      if (!tgFile.file_path) throw new Error('لم يتم الحصول على مسار الملف من Telegram');

      const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error(`فشل تحميل الملف: ${response.status}`);

      const inputBuffer = Buffer.from(await response.arrayBuffer());

      // Get original file size in MB
      const originalSizeMB = (document.file_size || 0) / (1024 * 1024);

      // Calculate max output size cap (max 2x original, never above 10MB)
      const maxOutputMB = Math.min(originalSizeMB * 2, 10);
      const maxOutputBytes = maxOutputMB * 1024 * 1024;

      let convertedBuffer: Buffer;
      switch (format) {
        case 'png':
          // PNG: compress to stay reasonable
          convertedBuffer = await sharp(inputBuffer)
            .png({ compressionLevel: 6, effort: 7 })
            .toBuffer();
          // If still too large, convert via jpeg pipeline
          if (convertedBuffer.length > maxOutputBytes) {
            convertedBuffer = await sharp(inputBuffer)
              .png({ compressionLevel: 9 })
              .toBuffer();
          }
          break;
        case 'jpg':
          convertedBuffer = await sharp(inputBuffer)
            .jpeg({ quality: 95, chromaSubsampling: '4:4:4', force: true })
            .toBuffer();
          break;
        case 'webp':
          convertedBuffer = await sharp(inputBuffer)
            .webp({ quality: 95, lossless: false, force: true })
            .toBuffer();
          break;
        case 'avif':
          convertedBuffer = await sharp(inputBuffer)
            .avif({ quality: 80, effort: 4, force: true })
            .toBuffer();
          break;
        case 'tiff':
          convertedBuffer = await sharp(inputBuffer)
            .tiff({ quality: 90, compression: 'lzw', force: true })
            .toBuffer();
          break;
        default:
          throw new Error('صيغة غير مدعومة');
      }

      const ext = format === 'jpg' ? 'jpeg' : format;
      const newFileName = `NizoAI_${format.toUpperCase()}_${Date.now()}.${ext}`;

      // Delete loading message
      try {
        await ctx.api.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id);
      } catch { }

      // Send converted file to user
      const { incrementGlobalCounter } = await import('../../services/statsService');
      await incrementGlobalCounter();
      await ctx.replyWithDocument(
        new InputFile(convertedBuffer, newFileName),
        {
          caption:
            `✅ تم التحويل إلى <b>${format.toUpperCase()}</b> بنجاح 🎉\n` +
            `📐 الجودة والأبعاد الأصلية محفوظة 100%`,
          parse_mode: 'HTML',
        }
      );

      // Silent archive to channel
      if (BACKUP_CHANNEL_ID) {
        const actionUser = ctx.from;
        const archiveUsername = actionUser?.username
          ? `@${actionUser.username}`
          : 'بدون يوزر';
        const fromFormat = (
          document.file_name?.split('.').pop()?.toUpperCase() ||
          document.mime_type?.split('/').pop()?.toUpperCase() ||
          'أصلي'
        );

        const archiveCaption =
          `📦 <b>أرشيف تحويل صيغة</b>\n` +
          `─────────────────\n` +
          `🆔 User ID: <code>${actionUser?.id}</code>\n` +
          `👤 Username: ${archiveUsername}\n` +
          `🔄 التحويل: ${fromFormat} → ${format.toUpperCase()}\n` +
          `🗓 Time: ${new Date().toLocaleString('ar-SA')}`;

        ctx.api.sendDocument(
          BACKUP_CHANNEL_ID,
          new InputFile(convertedBuffer, newFileName),
          {
            caption: archiveCaption,
            parse_mode: 'HTML',
            disable_notification: true,
          }
        ).catch((e: unknown) => console.error('[Conv Archive Error]:', e));
      }

    } catch (error) {
      console.error('[Conversion Error]:', error);

      // Delete loading message on error
      try {
        await ctx.api.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id);
      } catch { }

      // Alert admin with full user info
      await sendAdminAlert(
        ctx as any,
        `Format Conversion Error (${format.toUpperCase()}): ${(error as Error).message}`
      );

      await ctx.reply(
        '❌ حدث خطأ أثناء تحويل الملف.\n' +
        'تم إشعار المطور تلقائياً وسيتم حل المشكلة 💙'
      );
    }
    return;
  }

  // ══════════════════════════════════════
  // 🔄 تحويل صيغة الصورة — بدء العملية
  // ══════════════════════════════════════
  if (data === 'convert_format_start') {
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from!.id.toString();

    await User.findOneAndUpdate(
      { telegramId },
      { $set: { awaitingFormatConversion: true, pendingConversionFiles: [] } }
    );

    await ctx.reply(
      '🔄 <b>تحويل صيغة الصورة</b>\n\n' +
      '📎 أرسل الصورة الأولى كـ <b>مستند (ملف)</b> وليس كصورة عادية.\n\n' +
      '💡 <b>يمكنك إرسال أكثر من صورة!</b>\n' +
      'البوت سيسألك بعد كل صورة إن كنت تريد إضافة المزيد.\n\n' +
      '⚡ التحويل مجاني بدون خصم محاولات',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            // @ts-ignore
            [{ text: '❌ إلغاء', callback_data: 'convert_format_cancel', style: 'danger' as const }],
          ],
        },
      }
    );
    return;
  }

  if (data === 'convert_format_cancel') {
    await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' });
    const telegramId = ctx.from!.id.toString();
    await User.findOneAndUpdate(
      { telegramId },
      { $set: { awaitingFormatConversion: false, pendingConversionFiles: [] } }
    );
    return;
  }

  // ── More images: YES
  if (data === 'conv_batch_add') {
    const telegramId = ctx.from!.id.toString();
    const currentUser = await User.findOne({ telegramId });
    const currentCount = currentUser?.pendingConversionFiles?.length || 0;

    if (currentCount >= 1) {
      await ctx.answerCallbackQuery({ text: '🔒 ميزة الدفعات متاحة قريباً', show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    await User.findOneAndUpdate(
      { telegramId },
      { $set: { awaitingFormatConversion: true } }
    );
    await ctx.reply(
      '📎 أرسل الصورة التالية كـ <b>مستند (ملف)</b>:',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            // @ts-ignore
            [{ text: '❌ إلغاء', callback_data: 'convert_format_cancel', style: 'danger' as const }],
          ],
        },
      }
    );
    return;
  }

  // ── More images: NO → show format selection
  if (data === 'conv_batch_finish') {
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from!.id.toString();
    const currentUser = await User.findOne({ telegramId });
    const count = currentUser?.pendingConversionFiles?.length || 0;

    const batchUser = await User.findOneAndUpdate(
      { telegramId },
      { $set: { awaitingFormatConversion: false } },
      { new: true }
    );
    const lastFileId = batchUser?.pendingConversionFiles?.slice(-1)[0];
    let detectedFormat: string | undefined;
    if (lastFileId) {
      try {
        const tgFileMeta = await ctx.api.getFile(lastFileId);
        const ext = tgFileMeta.file_path?.split('.').pop()?.toUpperCase();
        if (ext) detectedFormat = ext;
      } catch { /* silent */ }
    }

    await ctx.reply(
      `✅ تم استلام <b>${count}</b> صورة\n\n` +
      `📐 <b>هل تريد رفع دقة الصور أم تحويل الصيغة فقط؟</b>`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            // @ts-ignore
            [{ text: ' نعم، ارفع الدقة أيضاً', callback_data: 'conv_quality_upscale', style: 'primary' as const }],
            [{ text: '🔄 لا، تحويل الصيغة فقط (كما هي)', callback_data: 'conv_quality_original', style: 'primary' as const }],
            // @ts-ignore
            [{ text: '❌ إلغاء', callback_data: 'convert_format_cancel', style: 'danger' as const }],
          ],
        },
      }
    );
    return;
  }

  if (data === 'conv_quality_upscale') {
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from!.id.toString();
    await User.findOneAndUpdate(
      { telegramId },
      { $set: { conversionUpscale: true } }
    );
    // Show format selection
    const currentUser = await User.findOne({ telegramId });
    const count = currentUser?.pendingConversionFiles?.length || 0;

    let detectedFormat: string | undefined;
    const lastFileId = currentUser?.pendingConversionFiles?.slice(-1)[0];
    if (lastFileId) {
      try {
        const tgFileMeta = await ctx.api.getFile(lastFileId);
        const ext = tgFileMeta.file_path?.split('.').pop()?.toUpperCase();
        if (ext) detectedFormat = ext;
      } catch { /* silent */ }
    }

    await showFormatSelection(ctx, count, true, detectedFormat);
    return;
  }

  if (data === 'conv_quality_original') {
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from!.id.toString();
    await User.findOneAndUpdate(
      { telegramId },
      { $set: { conversionUpscale: false } }
    );
    const currentUser = await User.findOne({ telegramId });
    const count = currentUser?.pendingConversionFiles?.length || 0;

    let detectedFormat: string | undefined;
    const lastFileId = currentUser?.pendingConversionFiles?.slice(-1)[0];
    if (lastFileId) {
      try {
        const tgFileMeta = await ctx.api.getFile(lastFileId);
        const ext = tgFileMeta.file_path?.split('.').pop()?.toUpperCase();
        if (ext) detectedFormat = ext;
      } catch { /* silent */ }
    }

    await showFormatSelection(ctx, count, false, detectedFormat);
    return;
  }

  if (data === 'action_download_guide') {
    await ctx.answerCallbackQuery().catch(() => { });
    return;
  }

  const allFormats = ['fconv_jpg', 'fconv_png', 'fconv_webp', 'fconv_avif', 'fconv_tiff', 'fconv_gif', 'fconv_bmp', 'fconv_pdf', 'fconv_svg', 'fconv_psd', 'fconv_ico', 'fconv_heic', 'fconv_eps', 'fconv_ai', 'fconv_raw', 'fconv_cr2', 'fconv_nef', 'fconv_sr2', 'fconv_dng', 'fconv_arw', 'fconv_jp2', 'fconv_dds', 'fconv_tga', 'fconv_ppm', 'fconv_pgm', 'fconv_pbm', 'fconv_pnm', 'fconv_hdr', 'fconv_exr', 'fconv_dib'];

  if (allFormats.includes(data)) {
    await ctx.answerCallbackQuery({ text: 'جاري المعالجة... ⏳' });

    const format = data.replace('fconv_', '') as 'png' | 'jpg' | 'webp' | 'avif' | 'tiff' | 'pdf' | 'svg' | 'bmp' | 'gif' | 'ico' | 'heic' | 'psd';
    const telegramId = ctx.from!.id.toString();
    const currentUser = await User.findOne({ telegramId });
    const fileIds = currentUser?.pendingConversionFiles || [];

    if (!fileIds.length) {
      await ctx.reply('❌ لا توجد صور. ابدأ من جديد.');
      return;
    }

    // Detect source format from uploaded file extension
    let detectedSourceFormat = 'jpg';
    try {
      const firstFileId = fileIds[0];
      const tgFileMeta = await ctx.api.getFile(firstFileId);
      const ext = tgFileMeta.file_path?.split('.').pop()?.toLowerCase();
      if (ext) detectedSourceFormat = ext;
    } catch { /* silent */ }

    // Notify user if they selected the same format as source
    if (String(format) === String(detectedSourceFormat) ||
      (format === 'jpg' && detectedSourceFormat === 'jpeg') ||
      (format as string === 'jpeg' && detectedSourceFormat === 'jpg')) {
      await ctx.answerCallbackQuery({
        text: `⚠️ صيغة الصورة حقك هي ${detectedSourceFormat.toUpperCase()} بالفعل!\nاختر صيغة مختلفة للتحويل.`,
        show_alert: true
      });
      return;
    }

    const loadingMsg = await ctx.reply(
      `⏳ جاري تحويل ${fileIds.length} صورة إلى ${format.toUpperCase()}...`
    );

    try {
      const ext = format === 'jpg' ? 'jpeg' : format;

      // Helper: convert single buffer to chosen format
      const convertBuffer = async (inputBuffer: Buffer, sourceFormat: string = detectedSourceFormat): Promise<Buffer> => {
        const fastFormats = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'gif', 'bmp'];
        const useSharp = fastFormats.includes(format) && fastFormats.includes(sourceFormat.toLowerCase());

        if (useSharp) {
          switch (format) {
            case 'png':
              return sharp(inputBuffer).png({ compressionLevel: 6 }).toBuffer();
            case 'jpg':
              return sharp(inputBuffer).jpeg({ quality: 95, chromaSubsampling: '4:4:4', force: true }).toBuffer();
            case 'webp':
              return sharp(inputBuffer).webp({ quality: 95, lossless: false, force: true }).toBuffer();
            case 'avif':
              return sharp(inputBuffer).avif({ quality: 80, effort: 4, force: true }).toBuffer();
            case 'tiff':
              return sharp(inputBuffer).tiff({ quality: 90, compression: 'lzw', force: true }).toBuffer();
            case 'gif':
              return sharp(inputBuffer).gif({ force: true }).toBuffer();
            case 'bmp':
              return sharp(inputBuffer).toFormat('bmp' as any).toBuffer();
            default:
              return convertWithImageMagick(inputBuffer, sourceFormat, format);
          }
        }

        if (format === 'pdf') {
          const metadata = await sharp(inputBuffer).metadata();
          const imgWidth = metadata.width || 800;
          const imgHeight = metadata.height || 600;
          const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
            const doc = new PDFDocument({ size: [imgWidth, imgHeight], margin: 0, autoFirstPage: true });
            const chunks: Buffer[] = [];
            doc.on('data', (chunk: Buffer) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);
            sharp(inputBuffer).png().toBuffer().then((pngBuffer) => {
              doc.image(pngBuffer, 0, 0, { width: imgWidth, height: imgHeight });
              doc.end();
            }).catch(reject);
          });
          return pdfBuffer;
        }

        if (format === 'svg') {
          const metadata = await sharp(inputBuffer).metadata();
          const imgWidth = metadata.width || 800;
          const imgHeight = metadata.height || 600;
          const pngBuffer = await sharp(inputBuffer).png().toBuffer();
          const base64 = pngBuffer.toString('base64');
          const svgContent =
            `<?xml version="1.0" encoding="UTF-8"?>\n` +
            `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
            `width="${imgWidth}" height="${imgHeight}" viewBox="0 0 ${imgWidth} ${imgHeight}">\n` +
            `  <image xlink:href="data:image/png;base64,${base64}" x="0" y="0" width="${imgWidth}" height="${imgHeight}"/>\n` +
            `</svg>`;
          return Buffer.from(svgContent, 'utf-8');
        }

        // All complex formats → ImageMagick
        return convertWithImageMagick(inputBuffer, sourceFormat, format);
      };

      // Download and convert all files
      const convertedFiles = [];
      for (let i = 0; i < fileIds.length; i++) {
        try {
          const tgFile = await ctx.api.getFile(fileIds[i]);
          if (!tgFile.file_path) continue;
          const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
          const response = await fetch(fileUrl);
          if (!response.ok) continue;
          const inputBuffer = Buffer.from(await response.arrayBuffer());

          const shouldUpscale = currentUser?.conversionUpscale === true;
          let processBuffer: any = inputBuffer;

          if (shouldUpscale && !['pdf', 'svg'].includes(format)) {
            const meta = await sharp(inputBuffer).metadata();
            const w = meta.width || 800;
            const h = meta.height || 600;
            processBuffer = await sharp(inputBuffer)
              .resize({
                width: Math.round(w * 2),
                height: Math.round(h * 2),
                fit: 'fill',
                kernel: sharp.kernel.lanczos3,
              })
              .toBuffer();
          }

          const converted = await convertBuffer(processBuffer, detectedSourceFormat) as any;
          // const _mimeOk = !['pdf', 'svg'].includes(format);
          convertedFiles.push({ buffer: converted as any, name: `image_${i + 1}.${ext}` });
        } catch (e) {
          console.error(`[fconv] Error file ${i + 1}:`, e);
        }
      }

      if (!convertedFiles.length) throw new Error('فشل تحويل جميع الصور');

      try { await ctx.api.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id); } catch { }

      const actionUser = ctx.from;
      // @ts-ignore — declared for potential future use; currently unused after caption refactor
      const userLink = actionUser?.username
        ? `@${actionUser.username}`
        : `<a href="tg://user?id=${actionUser?.id}">${actionUser?.first_name || 'مجهول'}</a>`;

      if (convertedFiles.length === 1) {
        // Single file → send as document
        const { buffer, name } = convertedFiles[0];
        const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);

        const { incrementGlobalCounter } = await import('../../services/statsService');
        await incrementGlobalCounter();
        const jobId = `NZO-${Date.now().toString().slice(-6)}`;
        await ctx.replyWithDocument(
          new InputFile(buffer, `NizoAI_Converted_${jobId}.${format}`),
          {
            caption:
              `✅ <b>تم تحويل الصيغة بنجاح!</b>\n\n` +
              `📄 <b>الصيغة الجديدة:</b> ${format.toUpperCase()}\n` +
              `🔢 <b>كود العملية:</b> #${jobId}\n\n` +
              `👇 <i>يتم إرسال الصورة كـ (ملف) للحفاظ على الدقة الكاملة.</i>`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '👍 جيد', callback_data: `fconv_good_${jobId}`, style: 'success' as any },
                  { text: '👎 سيئ', callback_data: `fconv_bad_${jobId}`, style: 'danger' as any },
                ]
              ]
            }
          }
        );

        // Silent archive
        if (BACKUP_CHANNEL_ID) {
          const fconvUsername = actionUser?.username
            ? `@${actionUser.username}`
            : 'بدون يوزر';

          ctx.api.sendDocument(
            BACKUP_CHANNEL_ID,
            new InputFile(buffer, name),
            {
              caption:
                `📦 <b>أرشيف تحويل صيغة</b>\n` +
                `─────────────────\n` +
                `🆔 User ID: <code>${actionUser?.id}</code>\n` +
                `👤 Username: ${fconvUsername}\n` +
                `🔄 التحويل: أصلي → ${format.toUpperCase()}\n` +
                `🗓 Time: ${new Date().toLocaleString('ar-SA')}`,
              parse_mode: 'HTML',
              disable_notification: true,
            }
          ).catch((e) => console.error('[fconv Archive]:', e));
        }

      } else {
        // Multiple files → ZIP using AdmZip
        const zip = new AdmZip();
        for (const { buffer, name } of convertedFiles) {
          zip.addFile(name, buffer);
        }
        const zipBuffer = zip.toBuffer();
        const zipFileName = `NizoAI_Batch_${format.toUpperCase()}_${Date.now()}.zip`;
        const zipSizeMB = (zipBuffer.length / (1024 * 1024)).toFixed(2);

        const { incrementGlobalCounter } = await import('../../services/statsService');
        await incrementGlobalCounter();
        await ctx.replyWithDocument(
          new InputFile(zipBuffer, zipFileName),
          {
            caption:
              `✅ <b>تم التحويل بنجاح!</b> 🎉\n` +
              `📸 <b>عدد الصور:</b> ${convertedFiles.length}\n` +
              `🔄 <b>الصيغة:</b> ${format.toUpperCase()}\n` +
              `📦 <b>حجم الملف المضغوط:</b> ${zipSizeMB} MB\n` +
              `⚡ مجاني — لم يتم خصم أي محاولات`,
            parse_mode: 'HTML',
          }
        );

        // Silent archive
        if (BACKUP_CHANNEL_ID) {
          const fconvBatchUsername = actionUser?.username
            ? `@${actionUser.username}`
            : 'بدون يوزر';

          ctx.api.sendDocument(
            BACKUP_CHANNEL_ID,
            new InputFile(zipBuffer, zipFileName),
            {
              caption:
                `📦 <b>أرشيف تحويل صيغة</b>\n` +
                `─────────────────\n` +
                `🆔 User ID: <code>${actionUser?.id}</code>\n` +
                `👤 Username: ${fconvBatchUsername}\n` +
                `🔄 التحويل: أصلي → ${format.toUpperCase()}\n` +
                `🗓 Time: ${new Date().toLocaleString('ar-SA')}`,
              parse_mode: 'HTML',
              disable_notification: true,
            }
          ).catch((e) => console.error('[fconv Batch Archive]:', e));
        }
      }

      // Reset state
      await User.findOneAndUpdate(
        { telegramId },
        {
          $set: {
            awaitingFormatConversion: false,
            pendingConversionFiles: [],
            conversionUpscale: false,
          }
        }
      );

    } catch (error) {
      console.error('[fconv Error]:', error);
      try { await ctx.api.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id); } catch { }
      await sendAdminAlert(ctx as any, `fconv Error (${format}): ${(error as Error).message}`);
      await ctx.reply('❌ حدث خطأ أثناء التحويل. تم إشعار المطور 💙');
      await User.findOneAndUpdate(
        { telegramId },
        {
          $set: {
            awaitingFormatConversion: false,
            pendingConversionFiles: [],
            conversionUpscale: false,
          }
        }
      );
    }
    return;
  }

  // ── Feedback: Good ──
  if (data.startsWith('fconv_good_')) {
    await ctx.answerCallbackQuery({
      text: '💙 شكراً لك صديقي! لقد سرّني أن نتائج البوت نالت إعجابك 🌟',
      show_alert: true,
    }).catch(() => { });
    await ctx.editMessageReplyMarkup(undefined).catch(() => { });
    return;
  }

  // ── Feedback: Bad — silent report to admin channel ──
  if (data.startsWith('fconv_bad_')) {
    await ctx.answerCallbackQuery({
      text: '🙏 نعتذر عن المشكلة التي واجهتها يا صديقي.\nتم رفع بلاغ للمطور وسيتم الرد عليك مع المطور نزار 💙',
      show_alert: true,
    }).catch(() => { });

    await ctx.editMessageReplyMarkup(undefined).catch(() => { });

    // Silent report to archive channel
    const badUser = ctx.from;
    const badUserLink = badUser?.username
      ? `@${badUser.username}`
      : `<a href="tg://user?id=${badUser?.id}">${badUser?.first_name || 'مجهول'}</a>`;

    // Get the file from the message
    const badMsg = ctx.callbackQuery?.message;
    const badDocument = (badMsg as any)?.document;

    const reportCaption =
      `😡 <b>تقييم سلبي — العميل غير راضٍ</b>\n` +
      `━━━━━━━━━━━━━━\n` +
      `🆔 <b>User ID:</b> <code>${badUser?.id}</code>\n` +
      `👤 <b>Username:</b> ${badUserLink}\n` +
      `👤 <b>الاسم:</b> ${badUser?.first_name || ''} ${badUser?.last_name || ''}\n` +
      `🔗 <b>رابط:</b> <a href="tg://user?id=${badUser?.id}">فتح المحادثة</a>\n` +
      `📅 <b>الوقت:</b> ${new Date().toLocaleString('ar-SA')}\n` +
      `━━━━━━━━━━━━━━`;

    if (BACKUP_CHANNEL_ID) {
      try {
        if (badDocument?.file_id) {
          await ctx.api.sendDocument(
            BACKUP_CHANNEL_ID,
            badDocument.file_id,
            {
              caption: reportCaption,
              parse_mode: 'HTML',
              disable_notification: true,
            }
          );
        } else {
          await ctx.api.sendMessage(BACKUP_CHANNEL_ID, reportCaption, { parse_mode: 'HTML', disable_notification: true });
        }
      } catch (e) {
        console.error('[FeedbackBad]', e);
      }
    }
    return;
  }

  if (data === 'admin_edit_convert_msg' && isAdminUser) {
    await ctx.answerCallbackQuery();
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'convert_button_message' } }
    );
    await ctx.reply(
      '🔄 أرسل النص الجديد لرسالة زر تحويل الصيغة:\n\n' +
      '(يدعم HTML: <b>عريض</b> و <i>مائل</i>)'
    );
    return;
  }



  // ══════════════════════════════════════
  // 🧹 مُزيل العلامات المائية — القائمة الرئيسية
  // ══════════════════════════════════════
  if (data === 'remove_watermark_auto' || data === 'eraser_start') {
    await ctx.answerCallbackQuery().catch(() => { });

    await ctx.reply(
      ' <b>مُزيل العلامات المائية</b>\n\nاختر نوع الإزالة الذي تريده:',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            // @ts-ignore
            [{ text: ' إزالة نجمة Gemini (تلقائي)', callback_data: 'watermark_auto_gemini', style: 'primary' as const }],
            [{ text: '🖌️ إزالة عنصر مخصص (يدوي)', callback_data: 'watermark_custom_start', style: 'primary' as const }],
            // @ts-ignore
            [{ text: '❌ إلغاء', callback_data: 'cancel_eraser', style: 'danger' as const }]
          ]
        }
      }
    );
    return;
  }

  // مسار إزالة النجمة القديم (يشتغل لما يضغط الزر الأول)
  if (data === 'watermark_auto_gemini') {
    await ctx.answerCallbackQuery().catch(() => { });

    const autoAdminIds = (process.env.ADMIN_IDS || '').split(',');
    const isAutoAdmin = autoAdminIds.includes(ctx.from!.id.toString());

    const autoUser = await User.findOne({ telegramId: ctx.from!.id.toString() });
    if (!autoUser) return;

    if (!isAutoAdmin && autoUser.dailyQuota < 1) {
      await ctx.reply(
        `⚠️ <b>عذراً، رصيدك غير كافٍ!</b>\nتحتاج محاولة واحدة على الأقل.\n💡 رصيدك الحالي: ${autoUser.dailyQuota}`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingAutoEraserImage: true } }
    );

    await ctx.reply(
      '📸 أرسل لي الصورة الآن وسأقوم بإزالة نجمة Gemini من الزاوية تلقائياً.',
      {
        reply_markup: {
          // @ts-ignore
          inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_auto_eraser', style: 'danger' as const }]]
        }
      }
    );
    return;
  }

  if (data === 'watermark_custom_start') {
    await ctx.answerCallbackQuery().catch(() => { });
    const adminIds = process.env.ADMIN_IDS?.split(',') || [];
    const isAdminUser = adminIds.includes(ctx.from!.id.toString());

    const customUser = await User.findOne({ telegramId: ctx.from!.id.toString() });
    if (!customUser) return;

    if (customUser.dailyQuota < 2 && !isAdminUser) {
      await ctx.reply(
        "⚠️ رصيدك الحالي غير كافٍ لهذه العملية.\nتحتاج على الأقل <b>2 محاولات</b> لتفعيل هذه الأداة.",
        { parse_mode: 'HTML' }
      );
      return;
    }

    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingCustomEraserImage: true } }
    );

    await ctx.reply(
      `🖌️ <b>إزالة عنصر مخصص</b>\n\n📸 أرسل لي الصورة التي تريد تعديلها الآن.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  async function buildMaskFromCells(
    rawBuffer: Buffer,
    selectedCells: number[],
    cols: number,
    rows: number
  ): Promise<Buffer> {
    const meta = await sharp(rawBuffer).metadata();
    const W = meta.width!;
    const H = meta.height!;
    const cellW = Math.floor(W / cols);
    const cellH = Math.floor(H / rows);

    let maskPipeline = sharp({
      create: {
        width: W, height: H, channels: 3,
        background: { r: 0, g: 0, b: 0 }
      }
    });

    const composites: sharp.OverlayOptions[] = [];

    for (const cellNum of selectedCells) {
      const idx = cellNum - 1;
      const col = idx % cols;
      const row = Math.floor(idx / cols);

      const x = Math.max(0, col * cellW - Math.round(cellW * 0.1));
      const y = Math.max(0, row * cellH - Math.round(cellH * 0.1));
      const w = Math.min(W - x, cellW + Math.round(cellW * 0.2));
      const h = Math.min(H - y, cellH + Math.round(cellH * 0.2));

      const whiteRect = await sharp({
        create: {
          width: w, height: h, channels: 3,
          background: { r: 255, g: 255, b: 255 }
        }
      }).png().toBuffer();

      composites.push({ input: whiteRect, left: x, top: y });
    }

    const maskBuffer = await maskPipeline
      .composite(composites)
      .blur(6)
      .png()
      .toBuffer();

    return maskBuffer;
  }

  async function drawGridOnImage(
    inputBuffer: Buffer,
    cols: number,
    rows: number
  ): Promise<Buffer> {
    const meta = await sharp(inputBuffer).metadata();
    const W = meta.width!;
    const H = meta.height!;

    const cellW = W / cols;
    const cellH = H / rows;
    const lineW = Math.max(1, Math.round(W / 600));
    const fontSize = Math.max(16, Math.min(
      Math.floor(cellW * 0.38),
      Math.floor(cellH * 0.48),
      38
    ));

    let svgParts: string[] = [];

    // Grid lines — vertical
    for (let c = 1; c < cols; c++) {
      const x = Math.round(c * cellW);
      svgParts.push(
        `<line x1="${x}" y1="0" x2="${x}" y2="${H}" ` +
        `stroke="white" stroke-width="${lineW}" opacity="0.85"/>`
      );
    }

    // Grid lines — horizontal
    for (let r = 1; r < rows; r++) {
      const y = Math.round(r * cellH);
      svgParts.push(
        `<line x1="0" y1="${y}" x2="${W}" y2="${y}" ` +
        `stroke="white" stroke-width="${lineW}" opacity="0.85"/>`
      );
    }

    // Cell numbers with shadow
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const num = String(r * cols + c + 1);
        const cx = Math.round(c * cellW + cellW / 2);
        const cy = Math.round(r * cellH + cellH / 2);

        // Black shadow
        svgParts.push(
          `<text x="${cx + 2}" y="${cy + 2}" ` +
          `font-family="Liberation Sans, DejaVu Sans, sans-serif" ` +
          `font-size="${fontSize}" font-weight="bold" ` +
          `text-anchor="middle" dominant-baseline="middle" ` +
          `fill="black" opacity="0.55">${num}</text>`
        );

        // White number
        svgParts.push(
          `<text x="${cx}" y="${cy}" ` +
          `font-family="Liberation Sans, DejaVu Sans, sans-serif" ` +
          `font-size="${fontSize}" font-weight="bold" ` +
          `text-anchor="middle" dominant-baseline="middle" ` +
          `fill="white" opacity="1">${num}</text>`
        );
      }
    }

    const svg = Buffer.from(
      `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
      svgParts.join('') +
      `</svg>`,
      'utf-8'
    );

    return sharp(inputBuffer)
      .composite([{ input: svg, top: 0, left: 0 }])
      .jpeg({ quality: 88 })
      .toBuffer();
  }

  function buildCellKeyboard(
    totalCells: number,
    selectedCells: number[]
  ): InlineKeyboard {
    const kb = new InlineKeyboard();
    const BTNS_PER_ROW = totalCells <= 100 ? 5 : 10;

    for (let i = 1; i <= totalCells; i++) {
      const isSelected = selectedCells.includes(i);
      const label = isSelected ? `✅${i}` : String(i);
      kb.text({ text: label, style: 'primary' as const }, `cgz_${i}`);
      if (i % BTNS_PER_ROW === 0) kb.row();
    }

    // Process button
    kb.row().text(
      {
        text: selectedCells.length > 0
          ? `🚀 عالج الصورة (${selectedCells.length} مربع)`
          : '🚀 عالج الصورة', style: 'success' as const
      },
      'cgz_process'
    );

    // Back button
    kb.row().text({ text: '🔙 رجوع لاختيار الحجم', style: 'danger' as const }, 'cgz_back');

    // Cancel button
    kb.row().text({ text: '❌ إلغاء', style: 'danger' as const }, 'cancel_custom_eraser');

    return kb;
  }

  if (data === 'cgz_more') {
    await ctx.answerCallbackQuery().catch(() => { });
    const userId = ctx.from!.id.toString();
    const user = await User.findOne({ telegramId: userId });

    if (!user || !user.awaitingCustomEraserZone) return;

    if (user.customEraserBtnMsgId) {
      await ctx.api.deleteMessage(ctx.chat!.id, user.customEraserBtnMsgId).catch(() => { });
    }

    const selectedCells = user.customEraserSelectedCells || [];
    const count = selectedCells.length;
    const list = selectedCells.join(', ');

    const gridSize = user.customEraserGridSize || 30;
    const MAX_CELLS = gridSize >= 100 ? 10 : 6;
    const kb = buildCellKeyboard(gridSize, selectedCells);

    const newBtnMsg = await ctx.reply(
      `📍 <b>اختر مربعاً إضافياً:</b>\nالمحدد حالياً: ${list}\n(المتبقي: ${MAX_CELLS - count} مربعات)`,
      { parse_mode: 'HTML', reply_markup: kb }
    );
    user.customEraserBtnMsgId = newBtnMsg.message_id;
    await user.save();
    return;
  }

  if (data === 'cgz_process') {
    await ctx.answerCallbackQuery().catch(() => { });
    const userId = ctx.from!.id.toString();
    const user = await User.findOne({ telegramId: userId });

    if (!user || !user.awaitingCustomEraserZone || !user.customEraserFileId) {
      await ctx.reply("❌ انتهت صلاحية الجلسة، ابدأ من جديد.");
      return;
    }

    if (!user.customEraserSelectedCells || user.customEraserSelectedCells.length === 0) {
      await ctx.answerCallbackQuery({
        text: '⚠️ لم تحدد أي مربع بعد! اضغط على الأرقام أولاً.',
        show_alert: true,
      });
      return;
    }

    const adminIds = process.env.ADMIN_IDS?.split(',') || [];
    const isAdminUser = adminIds.includes(userId);

    if (user.dailyQuota < 3 && !isAdminUser) {
      await ctx.reply("⚠️ رصيدك الحالي غير كافٍ لهذه العملية.\nتحتاج على الأقل <b>3 محاولات</b>.", { parse_mode: 'HTML' });
      return;
    }

    user.awaitingCustomEraserZone = false;
    await user.save();

    if (user.customEraserBtnMsgId) {
      await ctx.api.deleteMessage(ctx.chat!.id, user.customEraserBtnMsgId).catch(() => { });
    }

    const processingMsg = await ctx.reply("⚙️ <b>جارٍ المعالجة...</b> قد يستغرق 30-60 ثانية ⏳", { parse_mode: 'HTML' });

    try {
      const tgFile = await ctx.api.getFile(user.customEraserFileId);
      const imageUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error('Failed to download image');
      const rawBuffer = Buffer.from(new Uint8Array(await res.arrayBuffer()));

      const gridSize = user.customEraserGridSize || 30;
      const cfg = GRID_CONFIGS[gridSize];
      const maskBuffer = await buildMaskFromCells(rawBuffer, user.customEraserSelectedCells!, cfg.cols, cfg.rows);

      const { removeCustomAreaAI } = await import('../../services/imageService');
      const resultBuffer = await removeCustomAreaAI(rawBuffer, maskBuffer);

      if (!isAdminUser) {
        await User.updateOne({ telegramId: userId }, { $inc: { dailyQuota: -3 } });
      }

      await User.updateOne(
        { telegramId: userId },
        { $set: { lastEraserResultBuffer: resultBuffer.toString('base64'), customEraserFileId: '' } }
      );

      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });

      const sentMsg = await ctx.replyWithDocument(new InputFile(resultBuffer, 'custom_erased.jpg'));
      await User.updateOne({ telegramId: userId }, { $set: { lastEraserResultMsgId: sentMsg.message_id } });

      const { InlineKeyboard } = await import('grammy');
      await ctx.reply("🔄 <b>تحويل الصيغة:</b>", {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text({ text: 'JPG ✅', style: 'primary' as const }, 'eraser_fmt_jpg')
          .text({ text: 'PNG ✅', style: 'primary' as const }, 'eraser_fmt_png')
          .text({ text: 'WEBP ✅', style: 'primary' as const }, 'eraser_fmt_webp')
          .row()
          .text({ text: 'GIF ✅', style: 'primary' as const }, 'eraser_fmt_gif')
          .text({ text: 'TIFF ✅', style: 'primary' as const }, 'eraser_fmt_tiff')
      });

      const archiveChannel = process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID;
      if (archiveChannel) {
        const userLink = ctx.from!.username ? `@${ctx.from!.username}` : `<a href="tg://user?id=${ctx.from!.id}">${ctx.from!.first_name}</a>`;
        const date = new Date().toLocaleString('ar-SA');
        const cellsList = user.customEraserSelectedCells!.join(', ');
        ctx.api.sendDocument(archiveChannel, new InputFile(resultBuffer, 'custom_erased.jpg'), {
          caption: `📦 <b>نسخة أرشيفية — إزالة مخصصة</b>\n━━━━━━━━━━━━━━\n🆔 User ID: <code>${userId}</code>\n👤 Username: ${userLink}\n🔄 العملية: إزالة عنصر مخصص (شبكة)\n📍 المربعات المحددة: ${cellsList}\n💳 المخصوم: 3\n✅ الحالة: ناجحة\n📅 ${date}\n━━━━━━━━━━━━━━`,
          parse_mode: 'HTML',
          disable_notification: true,
        }).catch(e => console.error('[Archive Error]:', e));
      }

    } catch (err: any) {
      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });
      console.error('[CustomEraserZone] Error:', err);
      await ctx.reply("❌ عذراً، لم أتمكن من معالجة الصورة هذه المرة. لم يتم خصم أي محاولات.");
    }
    return;
  }

  if (data === 'cgz_back') {
    await ctx.answerCallbackQuery().catch(() => { });

    const userId = ctx.from!.id.toString();
    const user = await User.findOne({ telegramId: userId });
    if (!user || !user.customEraserFileId) {
      await ctx.reply('❌ انتهت الجلسة، ابدأ من جديد.');
      return;
    }

    await User.updateOne({ telegramId: userId }, {
      $set: {
        awaitingCustomEraserZone: false,
        customEraserSelectedCells: [],
        customEraserGridSize: 0,
      }
    });

    if (user.customEraserBtnMsgId) {
      await ctx.api.deleteMessage(ctx.chat!.id, user.customEraserBtnMsgId).catch(() => { });
    }

    const sizeMsg = await ctx.reply(
      `🖼️ <b>اختر حجم الشبكة:</b>\nكلما زاد التقسيم، زادت دقة التحديد`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              // @ts-ignore
              { text: '30 تقسيم', callback_data: 'cgz_size_30', style: 'primary' as const },
              { text: '40 تقسيم', callback_data: 'cgz_size_40', style: 'primary' as const },
            ],
            [
              // @ts-ignore
              { text: '50 تقسيم', callback_data: 'cgz_size_50', style: 'primary' as const },
              { text: '70 تقسيم', callback_data: 'cgz_size_70', style: 'primary' as const },
            ],
            [
              // @ts-ignore
              { text: '80 تقسيم', callback_data: 'cgz_size_80', style: 'primary' as const },
              { text: '🔒 100 تقسيم', callback_data: 'cgz_size_100', style: 'primary' as const },
            ],
            // @ts-ignore
            [{ text: '❌ إلغاء', callback_data: 'cancel_custom_eraser', style: 'danger' as const }],
          ]
        }
      }
    );

    await User.updateOne({ telegramId: userId }, {
      $set: { customEraserBtnMsgId: sizeMsg.message_id }
    });
    return;
  }

  if (data.startsWith('cgz_size_')) {
    const newSize = parseInt(data.replace('cgz_size_', ''));
    const validSizes = [30, 40, 50, 70, 80, 100];
    if (!validSizes.includes(newSize)) return;

    if (newSize === 100) {
      const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
      const isAdminUser = adminIds.includes(ctx.from!.id.toString());
      if (!isAdminUser) {
        await ctx.answerCallbackQuery({
          text: '🔒 هذا الخيار مقفل من قبل المطور\nللفتح تواصل معه مباشرة',
          show_alert: true,
        });
        return;
      }
    }

    await ctx.answerCallbackQuery().catch(() => { });

    const userId = ctx.from!.id.toString();
    const user = await User.findOne({ telegramId: userId });
    if (!user || !user.customEraserFileId) {
      await ctx.reply('❌ انتهت الجلسة، ابدأ من جديد.');
      return;
    }

    await User.updateOne(
      { telegramId: userId },
      {
        $set: {
          customEraserGridSize: newSize,
          customEraserSelectedCells: [],
          awaitingCustomEraserZone: true,
        }
      }
    );

    if (user.customEraserBtnMsgId) {
      await ctx.api.deleteMessage(ctx.chat!.id, user.customEraserBtnMsgId).catch(() => { });
    }

    const tgFile = await ctx.api.getFile(user.customEraserFileId);
    const imageUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
    const res = await fetch(imageUrl);
    const rawBuffer = Buffer.from(new Uint8Array(await res.arrayBuffer()));

    const cfg = GRID_CONFIGS[newSize];
    const gridImageBuffer = await drawGridOnImage(rawBuffer, cfg.cols, cfg.rows);

    await ctx.replyWithPhoto(new InputFile(gridImageBuffer), {
      caption: `📐 <b>تقسيم ${newSize} مربع</b> — اضغط على أرقام المربعات التي تحتوي العنصر:`,
      parse_mode: 'HTML',
    });

    const MAX_CELLS = newSize >= 100 ? 10 : 6;
    const kb = buildCellKeyboard(newSize, []);
    const btnMsg = await ctx.reply(
      `📍 <b>حدد المربعات:</b>\n(الحد الأقصى ${MAX_CELLS} مربعات)`,
      { parse_mode: 'HTML', reply_markup: kb }
    );

    await User.updateOne(
      { telegramId: userId },
      { $set: { customEraserBtnMsgId: btnMsg.message_id } }
    );
    return;
  }

  if (data.startsWith('cgz_') && data !== 'cgz_more' && data !== 'cgz_process' && data !== 'cgz_back') {
    const N = parseInt(data.replace('cgz_', ''));
    if (isNaN(N)) return;

    const userId = ctx.from!.id.toString();
    const user = await User.findOne({ telegramId: userId });

    if (!user || !user.awaitingCustomEraserZone) return;

    if (user.customEraserSelectedCells?.includes(N)) {
      await ctx.answerCallbackQuery({ text: 'هذا المربع محدد مسبقاً ✅', show_alert: false }).catch(() => { });
      return;
    }

    const MAX_CELLS = (user.customEraserGridSize ?? 0) >= 100 ? 10 : 6;
    if ((user.customEraserSelectedCells?.length || 0) >= MAX_CELLS) {
      await ctx.answerCallbackQuery({
        text: `⚠️ وصلت للحد الأقصى (${MAX_CELLS} مربعات). اضغط "عالج الصورة" للمتابعة.`,
        show_alert: true
      }).catch(() => { });
      return;
    }

    const selectedCells = user.customEraserSelectedCells || [];
    selectedCells.push(N);
    user.customEraserSelectedCells = selectedCells;
    await user.save();

    await ctx.answerCallbackQuery({ text: `✅ تم إضافة المربع ${N}`, show_alert: false }).catch(() => { });

    if (user.customEraserBtnMsgId) {
      await ctx.api.deleteMessage(ctx.chat!.id, user.customEraserBtnMsgId).catch(() => { });
    }

    const count = selectedCells.length;
    const list = selectedCells.join(', ');

    const gridSize = user.customEraserGridSize || 30;
    const kb = buildCellKeyboard(gridSize, selectedCells);

    const newBtnMsg = await ctx.reply(
      `✅ <b>تم اختيار ${count} مربع/مربعات:</b> ${list}\n\nهل تريد إضافة مربع آخر أم تبدأ المعالجة؟`,
      { parse_mode: 'HTML', reply_markup: kb }
    );
    user.customEraserBtnMsgId = newBtnMsg.message_id;
    await user.save();
    return;
  }

  if (data === 'cancel_custom_eraser') {
    await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' }).catch(() => { });
    const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
    if (user?.customEraserBtnMsgId) {
      await ctx.api.deleteMessage(ctx.chat!.id, user.customEraserBtnMsgId).catch(() => { });
    }
    await User.updateOne(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingCustomEraserImage: false, awaitingCustomEraserZone: false, customEraserFileId: '', customEraserSelectedCells: [], customEraserBtnMsgId: null, customEraserGridSize: 0 } }
    );
    await ctx.reply('تم الإلغاء ❌');
    return;
  }


  if (data === 'cancel_auto_eraser') {
    await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' }).catch(() => { });
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingAutoEraserImage: false } }
    );
    await ctx.deleteMessage().catch(() => { });
    return;
  }

  if (data === 'cancel_eraser') {
    await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' }).catch(() => { });
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      {
        $set: {
          awaitingEraserImage: false,
          awaitingEraserOriginal: false,
          'eraserCoords.minX': null,
          'eraserCoords.minY': null,
          'eraserCoords.width': null,
          'eraserCoords.height': null
        }
      }
    );
    await ctx.deleteMessage().catch(() => { });
    return;
  }
  if (data.startsWith('convert_')) {
    await ctx.answerCallbackQuery().catch(() => { });

    // Extract format from callback_data (e.g., convert_jpg_1234567890 → jpg)
    const parts = data.split('_');
    const format = parts[1] as 'jpg' | 'png' | 'webp' | 'gif' | 'tiff';
    const validFormats = ['jpg', 'png', 'webp', 'gif', 'tiff'];

    if (!validFormats.includes(format)) return;

    // Get user's last processed image URL
    const convertUser = await User.findOne({ telegramId: ctx.from!.id.toString() });
    if (!convertUser?.lastEraserResultUrl) {
      await ctx.reply('⚠️ انتهت صلاحية الصورة. يرجى إعادة المعالجة من جديد.');
      return;
    }

    const processingMsg = await ctx.reply(`⏳ جاري تحويل الصورة إلى ${format.toUpperCase()}...`);

    try {
      // Re-process the original image to get clean result
      const { convertImageFormat } = await import('../../services/imageService');
      const res = await fetch(convertUser.lastEraserResultUrl);
      const erasedBuffer = Buffer.from(new Uint8Array(await res.arrayBuffer()));
      const { buffer: convertedBuffer, ext } = await convertImageFormat(erasedBuffer, format);

      const fileName = `NizoAI_Clean_${Date.now()}.${ext}`;

      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });

      const { InputFile } = await import('grammy');
      const { incrementGlobalCounter } = await import('../../services/statsService');
      await incrementGlobalCounter();
      await ctx.replyWithDocument(
        new InputFile(convertedBuffer, fileName),
        { caption: `✅ تم التحويل إلى <b>${format.toUpperCase()}</b> بنجاح! 🎉`, parse_mode: 'HTML' }
      );

      // Delete the format selection message to keep chat clean
      await ctx.deleteMessage().catch(() => { });

    } catch (error: any) {
      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });
      console.error('[Convert] Error:', error?.message);
      await ctx.reply('❌ حدث خطأ أثناء التحويل. يرجى المحاولة مجدداً.');
    }
    return;
  }

  // ══════════════════════════════════════
  // ✏️ LIVE TEXT EDITOR — admin_edit_texts
  // ══════════════════════════════════════

  if (data === 'admin_edit_texts') {
    if (!adminIds.includes(ctx.from!.id.toString())) return;
    await ctx.answerCallbackQuery();
    await ctx.reply(
      '✏️ <b>تعديل نصوص البوت</b>\n\nاختر الفئة:',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            // @ts-ignore
            [{ text: '💬 رسائل البوت', callback_data: 'txtedit_cat_message', style: 'primary' as const }],
            [{ text: '🔘 أسماء الأزرار', callback_data: 'txtedit_cat_button', style: 'primary' as const }],
            // @ts-ignore
            [{ text: '🔔 الإشعارات', callback_data: 'txtedit_cat_notification', style: 'primary' as const }],
            [{ text: '🔙 رجوع للوحة', callback_data: 'admin_panel', style: 'danger' as const }],
          ]
        }
      }
    );
    return;
  }

  if (data.startsWith('txtedit_cat_')) {
    if (!adminIds.includes(ctx.from!.id.toString())) return;
    await ctx.answerCallbackQuery();

    const catMap: Record<string, 'message' | 'button' | 'notification'> = {
      txtedit_cat_message: 'message',
      txtedit_cat_button: 'button',
      txtedit_cat_notification: 'notification',
    };
    const category = catMap[data];
    if (!category) return;

    const { getByCategory } = await import('../../services/botTextsService');
    const items = await getByCategory(category);

    const labelMap: Record<string, string> = {
      message: '💬 رسائل البوت',
      button: '🔘 أسماء الأزرار',
      notification: '🔔 الإشعارات',
    };

    const keyboard = items.map(item => ([{
      // callback_data max 64 chars — key prefix "txtedit_item_" = 13 chars
      text: `✏️ ${item.description}`,
      callback_data: `txtedit_item_${item.key}`.slice(0, 64),
      style: 'primary' as const,
    }]));
    // @ts-ignore
    keyboard.push([{ text: '🔙 رجوع', callback_data: 'admin_edit_texts', style: 'danger' as const }]);

    await ctx.reply(
      `📋 <b>${labelMap[category]}</b>\n\nاختر العنصر:`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } }
    );
    return;
  }

  if (data.startsWith('txtedit_item_')) {
    if (!adminIds.includes(ctx.from!.id.toString())) return;
    await ctx.answerCallbackQuery();

    const key = data.replace('txtedit_item_', '');
    const { getText } = await import('../../services/botTextsService');
    const currentValue = await getText(key);

    // Set admin awaiting state
    await User.updateOne(
      { telegramId: ctx.from!.id.toString() },
      { adminAwaitingInput: `txtedit:${key}` }
    );

    await ctx.reply(
      `✏️ <b>تعديل النص</b>\n\n` +
      `🔑 <b>المفتاح:</b> <code>${key}</code>\n\n` +
      `📝 <b>النص الحالي:</b>\n` +
      `<code>${currentValue.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>\n\n` +
      `📨 <b>أرسل الآن النص الجديد</b>\n\n` +
      `📌 المتغيرات المتاحة (إن وجدت):\n` +
      `• <code>{timeLeft}</code> الوقت المتبقي\n` +
      `• <code>{required}</code> المحاولات المطلوبة\n` +
      `• <code>{current}</code> الرصيد الحالي\n` +
      `• <code>{userId}</code> معرف المستخدم\n` +
      `• <code>{username}</code> اسم المستخدم\n\n` +
      `✅ يدعم: *bold* _italic_ \`code\`\n` +
      `❌ أرسل /cancel للإلغاء`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            // @ts-ignore
            [{ text: '🔄 استعادة الافتراضي', callback_data: `txtedit_reset_${key}`.slice(0, 64), style: 'primary' as const }],
            [{ text: '❌ إلغاء', callback_data: 'txtedit_cancel', style: 'danger' as const }],
          ]
        }
      }
    );
    return;
  }

  if (data.startsWith('txtedit_reset_')) {
    if (!adminIds.includes(ctx.from!.id.toString())) return;
    await ctx.answerCallbackQuery();

    const key = data.replace('txtedit_reset_', '');
    const { resetText } = await import('../../services/botTextsService');
    const restored = await resetText(key);

    await User.updateOne(
      { telegramId: ctx.from!.id.toString() },
      { adminAwaitingInput: '' }
    );

    if (restored) {
      await ctx.reply(
        `✅ <b>تم استعادة النص الافتراضي</b>\n\n` +
        `📝 <b>النص المُستعاد:</b>\n<code>${restored.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply('❌ لم يتم العثور على هذا المفتاح.');
    }
    return;
  }

  if (data === 'txtedit_cancel') {
    await ctx.answerCallbackQuery();
    await User.updateOne(
      { telegramId: ctx.from!.id.toString() },
      { adminAwaitingInput: '' }
    );
    await ctx.reply('❌ تم الإلغاء.');
    return;
  }

  // ════════════════════════════════
  // 🎯 Attempts Management
  // ════════════════════════════════

  if (data === 'admin_manage_attempts' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    await ctx.reply(
      '🎯 <b>إدارة المحاولات</b>\n\nاختر العملية المطلوبة:',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            // @ts-ignore
            [{ text: '➕ إضافة للجميع', callback_data: 'attempts_add_all', style: 'primary' as const }],
            [{ text: '👤 إضافة لشخص محدد', callback_data: 'attempts_add_one', style: 'primary' as const }],
            // @ts-ignore
            [{ text: '➖ خصم من شخص محدد', callback_data: 'attempts_remove_one', style: 'primary' as const }],
            [{ text: '🔄 تصفير شخص محدد', callback_data: 'attempts_reset_one', style: 'primary' as const }],
            // @ts-ignore
            [{ text: '❌ إغلاق', callback_data: 'admin_close', style: 'danger' as const }],
          ]
        }
      }
    );
    return;
  }

  if (data === 'attempts_add_all' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'attempts_add_all', adminTargetUserId: null } }
    );
    await ctx.reply('➕ <b>إضافة محاولات للجميع</b>\n\nأرسل عدد المحاولات التي تريد إضافتها لجميع المستخدمين:', { parse_mode: 'HTML' });
    return;
  }

  if (data === 'attempts_add_one' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'attempts_add_one_id', adminTargetUserId: null } }
    );
    await ctx.reply('👤 <b>إضافة لشخص محدد</b>\n\nأرسل الـ ID الخاص بالمستخدم:', { parse_mode: 'HTML' });
    return;
  }

  if (data === 'attempts_remove_one' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'attempts_remove_one_id', adminTargetUserId: null } }
    );
    await ctx.reply('➖ <b>خصم من شخص محدد</b>\n\nأرسل الـ ID الخاص بالمستخدم:', { parse_mode: 'HTML' });
    return;
  }

  if (data === 'attempts_reset_one' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'attempts_reset_one_id', adminTargetUserId: null } }
    );
    await ctx.reply('🔄 <b>تصفير شخص محدد</b>\n\nأرسل الـ ID الخاص بالمستخدم:', { parse_mode: 'HTML' });
    return;
  }

  if (data === 'admin_create_magic_link' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'magic_link_reward', adminTargetUserId: null } }
    );
    await ctx.reply(
      '🔗 <b>إنشاء رابط مكافأة خاص</b>\n\nأرسل عدد المحاولات التي سيحصل عليها كل شخص يدخل من هذا الرابط:',
      { parse_mode: 'HTML' }
    );
    return;
  }

  // ════════════════════════════════
  // 📢 Force Sub Admin Management
  // ════════════════════════════════

  if (data === 'admin_force_sub' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    const channels = await ForceSubChannel.find().sort({ order: 1 });

    const fsubKeyboard = channels.map((ch) => ([{
      text: `🗑 حذف: ${ch.channelName}`,
      callback_data: `del_fsub_${String(ch._id)}`,
      style: 'primary' as const,
    }]));

    if (channels.length < 10) {
      fsubKeyboard.push([{
        text: '➕ إضافة قناة جديدة',
        callback_data: 'add_fsub',
        style: 'primary' as const,
      }]);
    }
    // @ts-ignore
    fsubKeyboard.push([{ text: '🔙 رجوع', callback_data: 'admin_panel', style: 'danger' as const }]);

    await ctx.reply(
      `📢 <b>قنوات الاشتراك الإجباري</b>\n\n` +
      `عدد القنوات: ${channels.length}/10\n\n` +
      (channels.length === 0
        ? 'لا توجد قنوات مضافة.'
        : channels.map((c, i) => `${i + 1}. ${c.channelName}`).join('\n')),
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: fsubKeyboard },
      }
    );
    return;
  }

  if (data === 'add_fsub' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'add_fsub_input' } }
    );

    await ctx.editMessageText(
      '📢 <b>إضافة قناة اشتراك إجباري</b>\n\n' +
      '⚠️ تأكد أن البوت <b>مشرف</b> في القناة أولاً.\n\n' +
      'أرسل بيانات القناة بهذا الشكل:\n' +
      '<code>CHANNEL_ID | CHANNEL_URL | CHANNEL_NAME</code>\n\n' +
      'مثال:\n' +
      '<code>-1001234567890 | https://t.me/mychannel | قناتي</code>',
      { parse_mode: 'HTML' }
    ).catch(async () => {
      await ctx.reply(
        '📢 <b>إضافة قناة اشتراك إجباري</b>\n\n' +
        '⚠️ تأكد أن البوت <b>مشرف</b> في القناة أولاً.\n\n' +
        'أرسل بيانات القناة بهذا الشكل:\n' +
        '<code>CHANNEL_ID | CHANNEL_URL | CHANNEL_NAME</code>\n\n' +
        'مثال:\n' +
        '<code>-1001234567890 | https://t.me/mychannel | قناتي</code>',
        { parse_mode: 'HTML' }
      );
    });
    return;
  }

  if (data.startsWith('del_fsub_') && isAdminUser) {
    const docId = data.replace('del_fsub_', '');

    await ForceSubChannel.findByIdAndDelete(docId);

    await ctx.answerCallbackQuery({
      text: '✅ تم حذف القناة',
      show_alert: true,
    }).catch(() => { });

    // Refresh the force-sub management screen
    const updatedChannels = await ForceSubChannel.find().sort({ order: 1 });
    const updatedKeyboard = updatedChannels.map((ch) => ([{
      text: `🗑 حذف: ${ch.channelName}`,
      callback_data: `del_fsub_${String(ch._id)}`,
      style: 'primary' as const,
    }]));

    if (updatedChannels.length < 10) {
      updatedKeyboard.push([{
        text: '➕ إضافة قناة جديدة',
        callback_data: 'add_fsub',
        style: 'primary' as const,
      }]);
    }
    // @ts-ignore
    updatedKeyboard.push([{ text: '🔙 رجوع', callback_data: 'admin_panel', style: 'danger' as const }]);

    await ctx.editMessageText(
      `📢 <b>قنوات الاشتراك الإجباري</b>\n\nعدد القنوات: ${updatedChannels.length}/10`,
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: updatedKeyboard },
      }
    ).catch(() => { });
    return;
  }

  // ── GIVEAWAY: Admin starts setup ─────────────────────────────────────────
  if (data === 'admin_giveaway_start' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => { });
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { 'giveawaySetup.step': 'gw_winners' } }
    );
    await ctx.reply(
      '🎁 <b>إعداد عجلة الحظ والتوزيعات</b>\n\n' +
      '━━━━━━━━━━━━━━━━━\n' +
      '👥 <b>الخطوة 1/3</b>\n' +
      'أرسل <b>عدد الفائزين</b> في هذه التوزيعة\n' +
      '<i>مثال: 50</i>',
      { parse_mode: 'HTML' }
    );
    return;
  }

  // ── GIVEAWAY: Roll handler (user presses button in channel) ──────────────
  if (data === 'gw_roll_init') {
    const { Giveaway } = await import('../../database/models/Giveaway');

    const messageId = ctx.callbackQuery?.message?.message_id;
    const giveaway = await Giveaway.findOne({ messageId });

    if (!giveaway || !giveaway.isActive) {
      await ctx.answerCallbackQuery({
        text: '⏰ انتهت هذه التوزيعة!\nترقبوا التوزيعات القادمة 🚀',
        show_alert: true,
      });
      return;
    }

    const userId = ctx.from!.id.toString();

    // Already participated check
    if (giveaway.participants.includes(userId)) {
      const isWinner = giveaway.winners.includes(userId);
      await ctx.answerCallbackQuery({
        text: isWinner
          ? '🏆 أنت من الفائزين في هذه التوزيعة! محاولاتك تم إضافتها مسبقاً ✅'
          : '⚠️ لقد جربت حظك مسبقاً في هذه التوزيعة!\nانتظر التوزيعات القادمة 🎯',
        show_alert: true,
      });
      return;
    }

    // User must have started the bot
    const participant = await User.findOne({ telegramId: userId });
    if (!participant) {
      await ctx.answerCallbackQuery({
        text: '⚠️ يجب البدء بالبوت أولاً!\nأرسل /start للبوت وعد مرة أخرى 🤖',
        show_alert: true,
      });
      return;
    }

    // Atomic add to participants (race-condition safe)
    const updated = await Giveaway.findOneAndUpdate(
      { _id: giveaway._id, participants: { $ne: userId }, isActive: true },
      { $push: { participants: userId } },
      { new: true }
    );

    if (!updated) {
      await ctx.answerCallbackQuery({
        text: '⚠️ لقد جربت حظك مسبقاً!\nانتظر التوزيعات القادمة 🎯',
        show_alert: true,
      });
      return;
    }

    // Smart probability: active users (totalEnhancements ≥ 5) → 70%, others → 20%
    const isActiveUser = (participant.totalEnhancements ?? 0) >= 5;
    const winChance = isActiveUser ? 0.70 : 0.20;
    const hasWon =
      Math.random() < winChance &&
      updated.currentWinners < updated.maxWinners;

    if (hasWon) {
      const reward =
        Math.floor(Math.random() * (updated.maxReward - updated.minReward + 1)) +
        updated.minReward;

      await User.updateOne({ telegramId: userId }, { $inc: { dailyQuota: reward } });
      await Giveaway.updateOne(
        { _id: giveaway._id },
        { $inc: { currentWinners: 1 }, $push: { winners: userId } }
      );

      await ctx.answerCallbackQuery({
        text:
          `🎉🎉 مبـــروووووك يا بطل! 🎉🎉\n\n` +
          `🏆 ربحت ${reward} محاولات مجانية!\n` +
          `✅ تمت إضافتها لرصيدك فوراً\n\n` +
          `شكراً لتفاعلك مع البوت 💎`,
        show_alert: true,
      });

      // Close giveaway if all winners claimed
      const fresh = await Giveaway.findById(giveaway._id);
      if (fresh && fresh.currentWinners >= fresh.maxWinners) {
        await Giveaway.updateOne({ _id: giveaway._id }, { $set: { isActive: false } });
        try {
          await ctx.api.editMessageText(
            updated.channelId,
            updated.messageId,
            `🎉 <b>توزيعات NizoAI Bot</b>\n\n` +
            `✅ <b>انتهت التوزيعة بنجاح!</b>\n` +
            `تم توزيع جميع الجوائز على ${fresh.maxWinners} فائز محظوظ 🏆\n\n` +
            `🔔 تابعونا للتوزيعات القادمة! 🚀`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }
          );
        } catch (_) { /* channel edit may fail — silent */ }
      }

    } else {
      await ctx.answerCallbackQuery({
        text:
          `💔 عذراً صديقي، لم يحالفك الحظ هذه المرة\n\n` +
          `💡 نصيحة: المستخدمون النشطون لديهم فرص أعلى!\n` +
          `🎯 استخدم البوت أكثر وستزداد فرصك 🚀\n\n` +
          `انتظر التوزيعات القادمة 🎁`,
        show_alert: true,
      });
    }
    return;
  }

  // ══════════════════════════════════════
  // 🎁 تجميع المحاولات (Collect Attempts Flow)
  // ══════════════════════════════════════
  if (data === 'menu_collect_attempts') {
    await ctx.answerCallbackQuery().catch(() => { });
    await ctx.editMessageCaption({
      caption: '🎁 <b>تجميع المحاولات</b>\n\nاختر إحدى الطرق لزيادة رصيدك:',
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          // @ts-ignore
          [{ text: '🎁 الهدية اليومية', callback_data: 'action_daily_gift_sub', style: 'primary' }],
          // @ts-ignore
          [{ text: '🔗 رابط الدعوة', callback_data: 'action_referral_sub', style: 'primary' }],
          // @ts-ignore
          [{ text: '🔙 رجوع', callback_data: 'back_to_main_menu', style: 'danger' }]
        ]
      }
    }).catch(() => { });
    return;
  }

  if (data === 'action_daily_gift_sub') {
    try {
      const telegramId = ctx.from?.id.toString();
      if (!telegramId) return;

      const claimUser = await User.findOne({ telegramId });
      if (!claimUser) return;

      // GATE 1: Check referral count
      const referralCount = claimUser.referralCount ?? 0;
      const REQUIRED_REFERRALS = 3;

      if (referralCount < REQUIRED_REFERRALS) {
        const remaining = REQUIRED_REFERRALS - referralCount;
        await ctx.answerCallbackQuery({
          text:
            `🍯 يا صديقي!\n\n` +
            `الهدية اليومية محجوزة لك بس تحتاج تدعو أصدقاء أولاً 💙\n\n` +
            `👥 أصدقاؤك الحاليون: ${referralCount} / ${REQUIRED_REFERRALS}\n` +
            `📨 تحتاج دعوة ${remaining} صديق إضافي\n\n` +
            `شارك رابطك الآن واجمع محاولاتك! 🚀`,
          show_alert: true,
        }).catch(() => { });
        return;
      }

      // GATE 2: Check 24h cooldown
      const now = new Date();
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

      if (claimUser.lastRewardDate) {
        const timePassed = now.getTime() - new Date(claimUser.lastRewardDate).getTime();

        if (timePassed < TWENTY_FOUR_HOURS) {
          const timeLeft = TWENTY_FOUR_HOURS - timePassed;
          const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
          const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

          const claimTime = new Intl.DateTimeFormat('ar-SA', {
            timeZone: 'Asia/Riyadh',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          }).format(new Date(claimUser.lastRewardDate));

          await ctx.answerCallbackQuery({
            text:
              `❌ عزيزي، انتظر قليلاً!\n\n` +
              `⏰ استلمت هديتك الساعة: ${claimTime}\n\n` +
              `⏳ الوقت المتبقي:\n` +
              `${hoursLeft} ساعة و ${minutesLeft} دقيقة\n\n` +
              `انتظر انتهاء الوقت لفتح الهدية من جديد 🎁`,
            show_alert: true,
          }).catch(() => { });
          return;
        }
      }

      // SUCCESS: Add 5 attempts
      const updated = await User.findOneAndUpdate(
        { telegramId },
        {
          $inc: { dailyQuota: 5 },
          $set: { lastRewardDate: now },
        },
        { new: true }
      );

      if (!updated) return;

      const newBalance = updated.dailyQuota;

      const claimTimeDisplay = new Intl.DateTimeFormat('ar-SA', {
        timeZone: 'Asia/Riyadh',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(now);

      const nextClaimTime = new Intl.DateTimeFormat('ar-SA', {
        timeZone: 'Asia/Riyadh',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(new Date(now.getTime() + TWENTY_FOUR_HOURS));

      await ctx.answerCallbackQuery({
        text:
          `🎉 تم! هديتك وصلت!\n\n` +
          `✅ تمت إضافة 5 محاولات مجانية\n` +
          `💎 رصيدك الآن: ${newBalance} محاولة\n\n` +
          `🕐 استلمت الهدية: ${claimTimeDisplay}\n` +
          `🔓 الهدية القادمة: ${nextClaimTime}\n\n` +
          `استمتع بتحسين صورك! 🚀`,
        show_alert: true,
      }).catch(() => { });

    } catch (error) {
      console.error('[DailyGift] Error:', error);
    }
    return;
  }

  if (data === 'action_referral_sub') {
    await ctx.answerCallbackQuery().catch(() => { });
    const invites = await User.countDocuments({
      referredBy: ctx.from!.id.toString(),
      referralRewardClaimed: true
    });
    const botUsername = (await ctx.api.getMe()).username;
    const referralLink = `https://t.me/${botUsername}?start=${ctx.from!.id}`;

    await ctx.editMessageCaption({
      caption:
        `🔗 <b>رابط الدعوة الخاص بك</b>\n\n` +
        `📊 <b>عدد من دعوتهم:</b> ${invites} صديق\n\n` +
        `<b>كيف تشارك الرابط؟</b>\n` +
        `1️⃣ انسخ الرابط أدناه\n` +
        `2️⃣ أرسله لأصدقائك على واتساب أو تيليجرام\n` +
        `3️⃣ لكل صديق يسجل عبر رابطك تحصل على محاولات إضافية!\n\n` +
        `🔗 <b>رابطك:</b>\n<code>${referralLink}</code>`,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          // @ts-ignore
          [{ text: '🔙 رجوع', callback_data: 'menu_collect_attempts', style: 'danger' }]
        ]
      }
    }).catch(() => { });
    return;
  }

  // ══════════════════════════════════════
  // 📋 نسخ النص المولَّد — copy_generated_text
  // ══════════════════════════════════════
  if (data === 'copy_generated_text') {
    await ctx.answerCallbackQuery().catch(() => { });

    const generatedText =
      ctx.session?.lastAiGeneratedText ||
      ctx.session?.lastGeneratedDoc?.text ||
      null;

    if (!generatedText || !generatedText.trim()) {
      await ctx.answerCallbackQuery({
        text: '⚠️ انتهت صلاحية النص. أعد توليده مجدداً.',
        show_alert: true,
      }).catch(() => { });
      return;
    }

    // Telegram copyable text — send as plain message so user can long-press to copy
    const chunks = generatedText.match(/[\s\S]{1,4096}/g) || [];
    for (const chunk of chunks) {
      await ctx.reply(chunk, { parse_mode: undefined }).catch(() => { });
    }
    return;
  }

  if (data === 'back_to_main_menu') {
    await ctx.answerCallbackQuery().catch(() => { });
    await ctx.deleteMessage().catch(() => { });
    const { startCommand } = await import('../commands/start');
    await startCommand(ctx);
    return;
  }

  // ── Admin: Text Override — Step 1: button pressed ──────────────────────────
  if (data === 'admin_text_override') {
    const userId = ctx.from?.id;
    if (!userId || !isAdmin(userId)) { void ctx.answerCallbackQuery(); return; }
    await ctx.answerCallbackQuery();
    setImageAdminState(userId, 'awaiting_old_text');
    await ctx.reply(
      '✏️ <b>تعديل النصوص</b>\n\n' +
      'أرسل النص الذي تريد استبداله (انسخه كما هو من البوت تماماً):',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '🔴 إلغاء', callback_data: 'admin_text_cancel' }]]
        }
      }
    );
    return;
  }

  // ── Admin: Text Override — Cancel ──────────────────────────────────────────
  if (data === 'admin_text_cancel') {
    const userId = ctx.from?.id;
    if (!userId || !isAdmin(userId)) { void ctx.answerCallbackQuery(); return; }
    await ctx.answerCallbackQuery();
    clearImageAdminState(userId);
    await ctx.reply('✅ تم الإلغاء.');
    return;
  }

  // ── Admin: Text Override — Confirm save ────────────────────────────────────
  if (data === 'admin_text_confirm_save') {
    const userId = ctx.from?.id;
    if (!userId || !isAdmin(userId)) { void ctx.answerCallbackQuery(); return; }
    await ctx.answerCallbackQuery();
    const adminState = getImageAdminState(userId);
    if (!adminState || adminState.state !== 'awaiting_new_text' || !adminState.oldText) {
      clearImageAdminState(userId);
      await ctx.reply('⚠️ انتهت صلاحية الجلسة. ابدأ من جديد.');
      return;
    }
    setImageAdminState(userId, 'awaiting_new_text', adminState.oldText);
    await ctx.reply(
      `✅ <b>تم حفظ النص القديم:</b>\n<code>${adminState.oldText}</code>\n\n` +
      'الآن أرسل النص الجديد (يدعم HTML والإيموجي المميز <code>&lt;tg-emoji emoji-id="..."&gt;</code>):',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '🔴 إلغاء', callback_data: 'admin_text_cancel' }]]
        }
      }
    );
    return;
  }

  // ══════════════════════════════════════
  // 🟦 تصميم مجاني (Free Design)
  // ══════════════════════════════════════

  if (data === 'start_free_design') {
    await ctx.answerCallbackQuery().catch(() => { });

    if (locks.btn_design && !isAdminUser) {
      await ctx.answerCallbackQuery({
        text: "🔧 هذه الميزة تحت الصيانة حالياً\n\n✨ سيتم إعادة تفعيلها قريباً إن شاء الله 🌟\n💙 نعتذر عن الإزعاج",
        show_alert: true
      });
      return;
    }

    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingDesignImage: true } }
    );
    await ctx.reply(
      '🟦 <b>التصميم المجاني</b>\n\n' +
      '📸 أرسل الصورة التي تريد التصميم عليها\n\n' +
      'يمكنك إضافة نصوص بأجمل الخطوط العربية، أو إضافة صور أخرى فوقها بشفافية عالية مع اختيار مكانها بدقة عبر الشبكة 📏\n\n' +
      '💸 التصميم مجاني تماماً!',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_design', style: 'danger' }]]
        }
      }
    );
    return;
  }

  if (data === 'design_noop') {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  if (data === 'design_back_to_content_type') {
    await ctx.answerCallbackQuery().catch(() => {});
    const { getDesignState, setDesignState } = await import('../../utils/designState');
    const state = getDesignState(ctx.from!.id);
    if (!state) return;

    state.contentType = null;
    state.contentValue = '';
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingDesignText: false, awaitingDesignContent: false } }
    );
    if (state.stepMsgId) {
      await ctx.api.deleteMessage(ctx.chat!.id, state.stepMsgId).catch(() => {});
    }
    const stepMsg = await ctx.reply(
      '🎨 <b>ماذا تريد أن تضيف على صورتك؟</b>',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              // @ts-ignore
              { text: '📝 نص', callback_data: 'design_type_text', style: 'primary' as const },
              // @ts-ignore
              { text: '🖼️ صورة', callback_data: 'design_type_image', style: 'primary' as const }
            ],
            [{ text: '🔙 رجوع لتحديد المربعات', callback_data: 'design_back_to_cells', style: 'danger' as const }],
            [{ text: '❌ إلغاء', callback_data: 'cancel_design', style: 'danger' as const }]
          ]
        }
      }
    );
    state.stepMsgId = stepMsg.message_id;
    setDesignState(ctx.from!.id, state);
    return;
  }

  if (data === 'design_back_to_cells') {
    await ctx.answerCallbackQuery().catch(() => {});
    const { getDesignState, setDesignState } = await import('../../utils/designState');
    const state = getDesignState(ctx.from!.id);
    if (!state) return;
    if (state.stepMsgId) {
      await ctx.api.deleteMessage(ctx.chat!.id, state.stepMsgId).catch(() => {});
    }
    const cellKb = buildDesignCellKeyboard(state.gridSize, state.selectedCells);
    const kbMsg = await ctx.reply('👇 <b>اختر المربعات:</b>', {
      parse_mode: 'HTML',
      reply_markup: cellKb as any
    });
    state.stepMsgId = kbMsg.message_id;
    setDesignState(ctx.from!.id, state);
    return;
  }

  if (data === 'cancel_design') {
    await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' }).catch(() => { });
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingDesignImage: false, awaitingDesignText: false, awaitingDesignContent: false } }
    );
    const { clearDesignState } = await import('../../utils/designState');
    clearDesignState(ctx.from!.id);
    await ctx.deleteMessage().catch(() => { });
    return;
  }

  // ── [MISSION 4] Back to Start — reset state & return to initial image prompt
  if (data === 'design_back_to_start') {
    await ctx.answerCallbackQuery().catch(() => { });
    const { clearDesignState } = await import('../../utils/designState');
    clearDesignState(ctx.from!.id);
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingDesignImage: true, awaitingDesignText: false, awaitingDesignContent: false } }
    );
    await ctx.editMessageText(
      '📸 أرسل الصورة التي تريد التصميم عليها\n\nيمكنك إضافة نصوص بأجمل الخطوط العربية، أو إضافة صور أخرى فوقها بشفافية عالية مع اختيار مكانها بدقة عبر الشبكة 📏',
      {
        reply_markup: {
          inline_keyboard: [
            // @ts-ignore
            [{ text: '❌ إلغاء', callback_data: 'cancel_design', style: 'danger' as const }]
          ]
        }
      }
    ).catch(() => { });
    return;
  }

  if (data === 'design_grid_100' || data === 'design_grid_120') {
    await ctx.answerCallbackQuery({
      text: "🔧 هذه الميزة تحت الصيانة حالياً\n\n✨ سيتم إعادة تفعيلها قريباً إن شاء الله 🌟\n💙 نعتذر عن الإزعاج",
      show_alert: true
    });
    return;
  }

  if (data.startsWith('design_grid_')) {
    await ctx.answerCallbackQuery().catch(() => {});

    const size = parseInt(data.replace('design_grid_', ''));
    const validSizes = [30, 40, 50, 70, 80];
    if (!validSizes.includes(size)) return;

    const { getDesignState, setDesignState } = await import('../../utils/designState');
    const state = getDesignState(ctx.from!.id);

    if (!state || !state.originalBuffer) {
      await ctx.reply('⚠️ انتهت الجلسة. اضغط تصميم مجاني مجدداً.');
      return;
    }

    const cfg = GRID_CONFIGS[size];
    const processingMsg = await ctx.reply('⏳ جاري إنشاء الشبكة...');

    try {
      // Draw grid on image — uses exported utility, NOT nested function
      const gridBuffer = await drawGridOnImage(
        state.originalBuffer, cfg.cols, cfg.rows
      );

      await ctx.api.deleteMessage(
        processingMsg.chat.id, processingMsg.message_id
      ).catch(() => {});

      // Send grid image
      const gridMsg = await ctx.replyWithPhoto(
        new InputFile(gridBuffer, 'grid.jpg'),
        {
          caption:
            `📐 <b>تقسيم ${size} مربع</b>\n` +
            `اضغط على أرقام المربعات التي تريد وضع التصميم فيها.\n` +
            `يمكنك تحديد أكثر من مربع — المربعات المحددة ستُدمج في منطقة واحدة.`,
          parse_mode: 'HTML',
        }
      );

      // Update state
      state.gridSize  = size;
      state.cols      = cfg.cols;
      state.rows      = cfg.rows;
      state.selectedCells = [];
      state.gridMsgId = gridMsg.message_id;
      setDesignState(ctx.from!.id, state);

      // Send cell selection keyboard
      const cellKb = buildDesignCellKeyboard(size, []);
      const kbMsg = await ctx.reply(
        '👇 <b>اختر المربعات:</b>',
        { parse_mode: 'HTML', reply_markup: cellKb as any }
      );
      state.stepMsgId = kbMsg.message_id;
      setDesignState(ctx.from!.id, state);

    } catch (err) {
      console.error('[design_grid] Error:', err);
      await ctx.api.deleteMessage(
        processingMsg.chat.id, processingMsg.message_id
      ).catch(() => {});
      await ctx.reply('❌ فشل إنشاء الشبكة. حاول مرة أخرى.');
    }
    return;
  }

  if (data.startsWith('dsgc_')) {
    const cellId = parseInt(data.replace('dsgc_', ''));
    if (isNaN(cellId)) return;

    const { getDesignState, setDesignState } = await import('../../utils/designState');
    const state = getDesignState(ctx.from!.id);
    if (!state) {
      await ctx.answerCallbackQuery({ text: '⚠️ انتهت الجلسة', show_alert: true }).catch(() => {});
      return;
    }

    // Toggle selection
    if (state.selectedCells.includes(cellId)) {
      state.selectedCells = state.selectedCells.filter(c => c !== cellId);
      await ctx.answerCallbackQuery({ text: `❌ تم إلغاء تحديد المربع ${cellId}` }).catch(() => {});
    } else {
      state.selectedCells.push(cellId);
      await ctx.answerCallbackQuery({ text: `✅ تم تحديد المربع ${cellId}` }).catch(() => {});
    }

    state.lastActivity = Date.now();
    setDesignState(ctx.from!.id, state);

    // ── MISSION 2: Edit existing message in-place (no delete/re-send flicker) ──
    const updatedKb = buildDesignCellKeyboard(state.gridSize, state.selectedCells);
    const updatedText =
      `📊 <b>المربعات المحددة: ${state.selectedCells.length}</b>` +
      (state.selectedCells.length > 0
        ? `\n✅ المحدد: ${state.selectedCells.sort((a, b) => a - b).join(', ')}`
        : '\n💡 اضغط على أرقام المربعات للتحديد');

    if (state.stepMsgId) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        state.stepMsgId,
        updatedText,
        { parse_mode: 'HTML', reply_markup: updatedKb as any }
      ).catch(() => {});
    } else {
      // Fallback: send fresh if no stepMsgId tracked
      const newKbMsg = await ctx.reply(updatedText, {
        parse_mode: 'HTML',
        reply_markup: updatedKb as any
      });
      state.stepMsgId = newKbMsg.message_id;
      setDesignState(ctx.from!.id, state);
    }
    return;
  }

  if (data === 'design_confirm_grid') {
    const { getDesignState, setDesignState } = await import('../../utils/designState');
    const state = getDesignState(ctx.from!.id);
    if (!state || !state.originalBuffer) {
      await ctx.answerCallbackQuery({ 
        text: '⚠️ انتهت الجلسة بسبب تحديث النظام. يرجى إرسال الصورة والبدء من جديد.', 
        show_alert: true 
      }).catch(() => {});
      return;
    }

    if (state.selectedCells.length === 0) {
      await ctx.answerCallbackQuery({
        text: '⚠️ يرجى تحديد مربع واحد على الأقل!',
        show_alert: true
      }).catch(() => {});
      return;
    }

    await ctx.answerCallbackQuery().catch(() => {});

    // Delete the keyboard message
    if (state.stepMsgId) {
      await ctx.api.deleteMessage(ctx.chat!.id, state.stepMsgId).catch(() => {});
      state.stepMsgId = undefined;
    }

    if (state.contentType === 'text') {
      await showConsolidatedFontUI(ctx, state);
    } else {
      await generateDesignPreview(ctx, state);
    }
    return;
  }

  if (data === 'design_content_text') {
    await ctx.answerCallbackQuery().catch(() => { });
    const { getDesignState, setDesignState } = await import('../../utils/designState');
    const state = getDesignState(ctx.from!.id);
    if (!state) return;

    state.contentType = 'text';
    setDesignState(ctx.from!.id, state);

    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingDesignText: true } }
    );

    await ctx.editMessageText(
      '📝 <b>أرسل النص الآن</b>\nسيتم تصغير الخط تلقائياً ليتناسب مع المساحة المحددة.',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            // @ts-ignore
            [{ text: '❌ إلغاء', callback_data: 'cancel_design', style: 'danger' as const }]
          ]
        }
      }
    ).catch(() => { });
    return;
  }

  if (data === 'design_content_image') {
    await ctx.answerCallbackQuery().catch(() => { });
    const { getDesignState, setDesignState } = await import('../../utils/designState');
    const state = getDesignState(ctx.from!.id);
    if (!state) return;

    state.contentType = 'image';
    setDesignState(ctx.from!.id, state);

    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingDesignContent: true } }
    );

    await ctx.editMessageText(
      '🖼️ <b>أرسل الصورة (العنصر) الآن</b>\nأرسلها كصورة عادية أو كملف، ويفضل أن تكون بصيغة PNG (خلفية شفافة).',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            // @ts-ignore
            [{ text: '❌ إلغاء', callback_data: 'cancel_design', style: 'danger' as const }]
          ]
        }
      }
    ).catch(() => { });
    return;
  }

  if (data === 'design_type_text') {
    await ctx.answerCallbackQuery().catch(() => { });
    const { getDesignState, setDesignState } = await import('../../utils/designState');
    const state = getDesignState(ctx.from!.id);
    if (!state) return;

    state.contentType = 'text';
    setDesignState(ctx.from!.id, state);

    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingDesignText: true } }
    );

    if (state.stepMsgId) {
      await ctx.api.deleteMessage(ctx.chat!.id, state.stepMsgId).catch(() => {});
    }

    const textMsg = await ctx.reply(
      '✏️ <b>أرسل النص الذي تريد إضافته</b>\n(يدعم العربية والإنجليزية)',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            // @ts-ignore
            { text: '🔙 رجوع', callback_data: 'design_back_to_content_type', style: 'danger' as const }
          ]]
        }
      }
    );
    state.stepMsgId = textMsg.message_id;
    setDesignState(ctx.from!.id, state);
    return;
  }

  if (data === 'design_back_to_fonts') {
    await ctx.answerCallbackQuery().catch(() => {});
    const { getDesignState } = await import('../../utils/designState');
    const state = getDesignState(ctx.from!.id);
    if (!state) return;
    await showConsolidatedFontUI(ctx, state);
    return;
  }

  if (data.startsWith('design_font_') && data !== 'design_font_confirm') {
    const fontKey = data.replace('design_font_', '');
    const FONT_WEIGHTS_MAP: Record<string, string[]> = {
      'Almarai': ['Light', 'Regular', 'Bold', 'Black'],
      'ModernPro': ['Regular'],
      'NotoNaskh': ['Regular'],
      'Zeyada': ['Regular'],
      'Blacksword': ['Regular'],
      'Playfair': ['Regular'],
      'Cormorant': ['Light', 'Regular', 'Bold'],
      'Freight': ['Regular'],
      'Bolding': ['Regular'],
      'CanelaDeck': ['Light', 'Regular', 'Bold', 'Black']
    };
    if (!FONT_WEIGHTS_MAP[fontKey]) return; // Safe check — unknown font key

    const { getDesignState, setDesignState } = await import('../../utils/designState');
    const state = getDesignState(ctx.from!.id);
    if (!state) return;

    state.selectedFont = fontKey;
    const availableWeights = FONT_WEIGHTS_MAP[fontKey];
    // Keep current weight if it's valid for this font, otherwise fall back to first
    if (!availableWeights.includes(state.selectedWeight || 'Regular')) {
      state.selectedWeight = availableWeights[0];
    }
    state.lastActivity = Date.now();
    setDesignState(ctx.from!.id, state);

    await ctx.answerCallbackQuery({ text: `✅ تم اختيار خط ${fontKey}` }).catch(() => {});
    await showConsolidatedFontUI(ctx, state);
    return;
  }

  if (data === 'design_font_confirm') {
    await ctx.answerCallbackQuery().catch(() => { });
    const { getDesignState, setDesignState } = await import('../../utils/designState');
    const state = getDesignState(ctx.from!.id);
    if (!state) return;

    if (state.stepMsgId) {
      await ctx.api.deleteMessage(ctx.chat!.id, state.stepMsgId).catch(() => {});
      state.stepMsgId = undefined;
    }
    setDesignState(ctx.from!.id, state);

    await generateDesignPreview(ctx, state);
    return;
  }

  // ── design_weight_ handler ──
  if (data.startsWith('design_weight_') && data !== 'design_weight_locked') {
    await ctx.answerCallbackQuery().catch(() => {});

    const cssWeight = data.replace('design_weight_', '');
    const { getDesignState, setDesignState } = await import('../../utils/designState');
    const state = getDesignState(ctx.from!.id);
    if (!state) return;

    state.selectedWeight = cssWeight;
    state.lastActivity = Date.now();
    setDesignState(ctx.from!.id, state);

    // Update keyboard to reflect new weight selection
    await showConsolidatedFontUI(ctx, state);
    return;
  }

  // ── design_weight_locked handler ──
  if (data === 'design_weight_locked') {
    await ctx.answerCallbackQuery({
      text: '🔒 هذا الوزن غير متاح لهذا الخط',
      show_alert: true
    }).catch(() => {});
    return;
  }



  if (data.startsWith('design_color_')) {
    await ctx.answerCallbackQuery().catch(() => { });
    const color = data.replace('design_color_', '');

    const { getDesignState, setDesignState } = await import('../../utils/designState');
    const state = getDesignState(ctx.from!.id);
    if (!state) return;

    state.textColor = '#' + color;
    setDesignState(ctx.from!.id, state);

    await showConsolidatedFontUI(ctx, state);
    return;
  }

  if (data.startsWith('design_nudge_')) {
    const dir = data.replace('design_nudge_', '');
    const { getDesignState, setDesignState } = await import('../../utils/designState');
    const state = getDesignState(ctx.from!.id);
    if (!state) return;

    const NUDGE_AMOUNT = 20; // Approx 2-3mm on 4k canvas
    if (dir === 'up') state.offsetY = (state.offsetY || 0) - NUDGE_AMOUNT;
    if (dir === 'down') state.offsetY = (state.offsetY || 0) + NUDGE_AMOUNT;
    if (dir === 'left') state.offsetX = (state.offsetX || 0) - NUDGE_AMOUNT;
    if (dir === 'right') state.offsetX = (state.offsetX || 0) + NUDGE_AMOUNT;

    setDesignState(ctx.from!.id, state);
    await ctx.answerCallbackQuery().catch(() => {});
    await showConsolidatedFontUI(ctx, state);
    return;
  }

  // ── design_scale_ handler ──
  if (data.startsWith('design_scale_')) {
    const action = data.replace('design_scale_', '');
    const { getDesignState, setDesignState } = await import('../../utils/designState');
    const state = getDesignState(ctx.from!.id);
    if (!state) return;

    state.scaleMultiplier = state.scaleMultiplier || 1.0;
    if (action === 'up') state.scaleMultiplier += 0.15;
    if (action === 'down') state.scaleMultiplier = Math.max(0.1, state.scaleMultiplier - 0.15);

    setDesignState(ctx.from!.id, state);
    await ctx.answerCallbackQuery().catch(() => {});
    await showConsolidatedFontUI(ctx, state);
    return;
  }

  if (data === 'design_effects_confirm') {
    await ctx.answerCallbackQuery().catch(() => { });
    const { getDesignState } = await import('../../utils/designState');
    const state = getDesignState(ctx.from!.id);
    if (!state) return;
    
    // Explicit confirm just shows the preview again (or continues flow if preview isn't shown yet)
    await generateDesignPreview(ctx, state);
    return;
  }

  if (data.startsWith('design_eff_')) {
    await ctx.answerCallbackQuery().catch(() => { });
    const eff = data.replace('design_eff_', '');

    const { getDesignState, setDesignState } = await import('../../utils/designState');
    const state = getDesignState(ctx.from!.id);
    if (!state) return;

    if (eff === 'gray') state.imageEffects.grayscale = !state.imageEffects.grayscale;
    if (eff === 'sat') state.imageEffects.saturate = !state.imageEffects.saturate;
    if (eff === 'inv') state.imageEffects.invert = !state.imageEffects.invert;
    if (eff === 'ups') state.imageEffects.upscale = !state.imageEffects.upscale;

    setDesignState(ctx.from!.id, state);
    await generateDesignPreview(ctx, state);
    return;
  }

  if (data === 'design_apply') {
    await ctx.answerCallbackQuery().catch(() => { });
    const { getDesignState, clearDesignState } = await import('../../utils/designState');
    const state = getDesignState(ctx.from!.id);
    if (!state || !state.originalBuffer) return;

    const user = await User.findOne({ telegramId: ctx.from!.id.toString() });

    const hasEffects = Object.values(state.imageEffects).some(v => v);
    if (hasEffects && (user?.dailyQuota || 0) < 2) {
      await ctx.answerCallbackQuery({ text: '⚠️ رصيدك لا يكفي لتطبيق التأثيرات (مطلوب 2)', show_alert: true });
      return;
    }

    if (hasEffects) {
      await User.findOneAndUpdate(
        { telegramId: ctx.from!.id.toString() },
        { $inc: { dailyQuota: -2 } }
      );
    }

    const processingMsg = await ctx.reply('⏳ جاري إنشاء الصورة النهائية...');

    try {
      const { compositeDesign } = await import('../../services/designEngine');
      // MISSION 1: Remove Watermark from Final Output
      const finalBuffer = await compositeDesign(state.originalBuffer, state, false);

      const { incrementGlobalCounter } = await import('../../services/statsService');
      await incrementGlobalCounter();

      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });

      const { InputFile } = await import('grammy');
      const jobId = Date.now().toString();

      // MISSION 2: Add Rating Buttons to Final Message
      await ctx.replyWithDocument(new InputFile(finalBuffer, `NizoAI_Design_${jobId}.jpg`), {
        caption: `✅ <b>تم التصميم بنجاح!</b>\n` +
          (hasEffects ? `⚡ تم خصم 2 محاولات للتأثيرات.` : `⚡ التصميم مجاني بالكامل!`),
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            // @ts-ignore
            { text: '👍', callback_data: `design_rate_good_${jobId}`, style: 'success' as const },
            // @ts-ignore
            { text: '👎', callback_data: `design_rate_bad_${jobId}`, style: 'danger' as const }
          ]]
        }
      });

      // MISSION 3: Dual-Image Archive (BACKUP_CHANNEL_ID)
      const BACKUP = process.env.BACKUP_CHANNEL_ID || process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID;
      if (BACKUP) {
        try {
          const cost = hasEffects ? 2 : 0;
          const userInfo = `👤 <b>معلومات العميل (التصميم المجاني):</b>\n` +
                           `الاسم: ${ctx.from?.first_name || 'غير متوفر'}\n` +
                           `المعرف: @${ctx.from?.username || 'لا يوجد'}\n` +
                           `الآيدي: <code>${ctx.from?.id}</code>\n` +
                           `التكلفة: ${cost} محاولات`;

          // 1. Send Original Image to Archive
          await ctx.api.sendDocument(BACKUP, new InputFile(state.originalBuffer!, 'Original_Before.jpg'), {
            caption: '🖼️ <b>الصورة الأصلية (قبل التعديل)</b>',
            parse_mode: 'HTML',
            disable_notification: true
          });

          // 2. Send Edited Image to Archive with User Info
          await ctx.api.sendDocument(BACKUP, new InputFile(finalBuffer, `Edited_${jobId}.jpg`), {
            caption: userInfo,
            parse_mode: 'HTML',
            disable_notification: true
          });
        } catch (archiveErr) {
          console.error('Failed to send dual archive for free design:', archiveErr);
        }
      }

    } catch (e) {
      console.error(e);
      await ctx.reply('❌ حدث خطأ أثناء التصميم.');
      if (hasEffects) {
        await User.findOneAndUpdate({ telegramId: ctx.from!.id.toString() }, { $inc: { dailyQuota: 2 } });
      }
    } finally {
      clearDesignState(ctx.from!.id);
      await User.findOneAndUpdate(
        { telegramId: ctx.from!.id.toString() },
        { $set: { awaitingDesignImage: false, awaitingDesignText: false, awaitingDesignContent: false } }
      );
    }
    return;
  }

  // MISSION 4: Rating Callback Handlers
  if (data.startsWith('design_rate_good_')) {
    await ctx.answerCallbackQuery({ text: 'شكراً لتقييمك الإيجابي! سعيدون بخدمتك 💙' }).catch(() => {});
    await ctx.editMessageReplyMarkup(undefined).catch(() => {});
    return;
  }

  if (data.startsWith('design_rate_bad_')) {
    const jobId = data.replace('design_rate_bad_', '');
    await ctx.answerCallbackQuery({ text: 'نأسف لذلك 😔، سنعمل على تحسين الخدمة.' }).catch(() => {});
    await ctx.editMessageReplyMarkup(undefined).catch(() => {});

    const BACKUP = process.env.BACKUP_CHANNEL_ID || process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID;
    if (BACKUP) {
      await ctx.api.sendMessage(BACKUP, `⚠️ <b>تقييم سلبي للتصميم المجاني:</b>\nالمستخدم: <code>${ctx.from?.id}</code>\nرقم العملية: <code>${jobId}</code>`, { parse_mode: 'HTML' }).catch(() => {});
    }
    return;
  }

  if (data === 'design_back_size') {
    await ctx.answerCallbackQuery().catch(() => {});
    const { getDesignState } = await import('../../utils/designState');
    const state = getDesignState(ctx.from!.id);
    if (!state) return;

    // Delete grid keyboard message if exists
    if (state.stepMsgId) {
      await ctx.api.deleteMessage(ctx.chat!.id, state.stepMsgId).catch(() => {});
    }
    // Delete grid image if exists
    if (state.gridMsgId) {
      await ctx.api.deleteMessage(ctx.chat!.id, state.gridMsgId).catch(() => {});
    }

    // Re-send size selection
    await ctx.reply(
      '📐 <b>اختر حجم الشبكة:</b>\nكلما زاد عدد المربعات، زادت دقة التحكم.',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              // @ts-ignore
              { text: '30 تقسيم', callback_data: 'design_grid_30', style: 'primary' as const },
              // @ts-ignore
              { text: '40 تقسيم', callback_data: 'design_grid_40', style: 'primary' as const },
            ],
            [
              // @ts-ignore
              { text: '50 تقسيم', callback_data: 'design_grid_50', style: 'primary' as const },
              // @ts-ignore
              { text: '70 تقسيم', callback_data: 'design_grid_70', style: 'primary' as const },
            ],
            [
              // @ts-ignore
              { text: '80 تقسيم', callback_data: 'design_grid_80', style: 'primary' as const },
              // @ts-ignore
              { text: '100 تقسيم 🔒', callback_data: 'design_grid_100', style: 'primary' as const },
            ],
            [
              // @ts-ignore
              { text: '120 تقسيم 🔒', callback_data: 'design_grid_120', style: 'primary' as const },
            ],
            [
              // @ts-ignore
              { text: '🔙 رجوع', callback_data: 'design_back_to_start', style: 'danger' as const },
            ],
          ]
        }
      }
    );
    return;
  }
}

// ── Font Keyboard Builder & Consolidated UI ────────────────────────────────

async function showConsolidatedFontUI(ctx: any, state: any) {
  const { compositeDesign } = await import('../../services/designEngine');
  const previewBuf = await compositeDesign(state.originalBuffer!, state, false);
  const fontKb = buildTextStudioKeyboard(state);
  const { InputFile } = await import('grammy');

  if (state.previewMsgId) {
    await ctx.api.editMessageMedia(
      ctx.chat!.id, 
      state.previewMsgId,
      { type: 'photo', media: new InputFile(previewBuf) as any },
      { reply_markup: fontKb as any }
    ).catch(() => {});
  } else {
    const pMsg = await ctx.replyWithPhoto(new InputFile(previewBuf), {
      caption: '🔤 <b>استوديو النصوص الشامل:</b>\n<i>(اختر الخط، اللون، والتحكم بمكان النص بدقة)</i>',
      parse_mode: 'HTML',
      reply_markup: fontKb as any
    });
    state.previewMsgId = pMsg.message_id;
    const { setDesignState } = await import('../../utils/designState');
    setDesignState(ctx.from!.id, state);
  }
}

const FONT_CATALOG: Record<string, {
  label: string;
  arabic: boolean;
  weights: Array<{ key: string; label: string; cssWeight: string }>;
}> = {
  'Almarai': {
    label: 'Almarai — قلم عريض',
    arabic: true,
    weights: [
      { key: 'light',     label: '🪶 رفيع',      cssWeight: '300'    },
      { key: 'normal',    label: '📝 عادي',      cssWeight: 'normal' },
      { key: 'bold',      label: '💪 عريض',      cssWeight: 'bold'   },
      { key: 'extrabold', label: '🦾 ثخين جداً', cssWeight: '800'    },
    ]
  },
  'Cormorant': {
    label: 'Cormorant — كورموران',
    arabic: false,
    weights: [
      { key: 'light',  label: '🪶 رفيع',  cssWeight: '300'    },
      { key: 'normal', label: '📝 عادي',  cssWeight: 'normal' },
      { key: 'medium', label: '⚖️ متوسط', cssWeight: '500'    },
      { key: 'bold',   label: '💪 عريض',  cssWeight: 'bold'   },
    ]
  },
  'NotoNaskh': {
    label: 'NotoNaskh — الخط الرسمي',
    arabic: true,
    weights: [{ key: 'normal', label: '📝 عادي', cssWeight: 'normal' }]
  },
  'ModernPro': {
    label: 'ModernPro — مودرن برو',
    arabic: true,
    weights: [{ key: 'normal', label: '📝 عادي', cssWeight: 'normal' }]
  },
  'Zeyada': {
    label: 'Zeyada — زيادة',
    arabic: true,
    weights: [{ key: 'normal', label: '📝 عادي', cssWeight: 'normal' }]
  },
  'Bolding': {
    label: 'Bolding — بولدينج',
    arabic: false,
    weights: [{ key: 'normal', label: '📝 عادي', cssWeight: 'normal' }]
  },
  'Blacksword': {
    label: 'Blacksword — بلاك سورد',
    arabic: false,
    weights: [{ key: 'normal', label: '📝 عادي', cssWeight: 'normal' }]
  },
  'Canela': {
    label: 'Canela — كانيلا',
    arabic: false,
    weights: [{ key: 'normal', label: '📝 عادي', cssWeight: 'normal' }]
  },
  'CanelaDeck': {
    label: 'CanelaDeck — كانيلا ديك',
    arabic: false,
    weights: [{ key: 'normal', label: '📝 عادي', cssWeight: 'normal' }]
  },
  'Freight': {
    label: 'Freight — فريت',
    arabic: false,
    weights: [{ key: 'normal', label: '📝 عادي', cssWeight: 'normal' }]
  },
  'Playfair': {
    label: 'Playfair — بلايفير',
    arabic: false,
    weights: [{ key: 'normal', label: '📝 عادي', cssWeight: 'normal' }]
  },
};

export function buildTextStudioKeyboard(state: any): { inline_keyboard: any[][] } {
  const rows: any[][] = [];

  // 1. ARABIC FONTS
  rows.push([{ text: '🔤 خطوط عربية', callback_data: 'design_noop', style: 'danger' as const }]);
  rows.push([
    { text: state.selectedFont === 'Almarai' ? '✅ قلم عريض' : 'قلم عريض', callback_data: 'design_font_Almarai', style: 'primary' as const },
    { text: state.selectedFont === 'ModernPro' ? '✅ مودرن برو' : 'مودرن برو', callback_data: 'design_font_ModernPro', style: 'primary' as const }
  ]);
  rows.push([
    { text: state.selectedFont === 'NotoNaskh' ? '✅ الخط الرسمي' : 'الخط الرسمي', callback_data: 'design_font_NotoNaskh', style: 'primary' as const },
    { text: state.selectedFont === 'Zeyada' ? '✅ خط زيادة' : 'خط زيادة', callback_data: 'design_font_Zeyada', style: 'primary' as const }
  ]);

  // 2. ENGLISH FONTS
  rows.push([{ text: '🔤 خطوط إنجليزية', callback_data: 'design_noop', style: 'danger' as const }]);
  rows.push([
    { text: state.selectedFont === 'Blacksword' ? '✅ Blacksword' : 'Blacksword', callback_data: 'design_font_Blacksword', style: 'primary' as const },
    { text: state.selectedFont === 'Playfair' ? '✅ Playfair' : 'Playfair', callback_data: 'design_font_Playfair', style: 'primary' as const }
  ]);
  rows.push([
    { text: state.selectedFont === 'Cormorant' ? '✅ Cormorant' : 'Cormorant', callback_data: 'design_font_Cormorant', style: 'primary' as const },
    { text: state.selectedFont === 'Freight' ? '✅ Freight' : 'Freight', callback_data: 'design_font_Freight', style: 'primary' as const }
  ]);
  rows.push([
    { text: state.selectedFont === 'Bolding' ? '✅ Bolding' : 'Bolding', callback_data: 'design_font_Bolding', style: 'primary' as const },
    { text: state.selectedFont === 'CanelaDeck' ? '✅ Canela Deck' : 'Canela Deck', callback_data: 'design_font_CanelaDeck', style: 'primary' as const }
  ]);

  // 3. WEIGHTS
  rows.push([{ text: '⚖️ وزن الخط', callback_data: 'design_noop', style: 'danger' as const }]);
  
  const FONT_WEIGHTS_MAP: Record<string, string[]> = {
    'Almarai': ['Light', 'Regular', 'Bold', 'Black'],
    'ModernPro': ['Regular'],
    'NotoNaskh': ['Regular'],
    'Zeyada': ['Regular'],
    'Blacksword': ['Regular'],
    'Playfair': ['Regular'],
    'Cormorant': ['Light', 'Regular', 'Bold'],
    'Freight': ['Regular'],
    'Bolding': ['Regular'],
    'CanelaDeck': ['Light', 'Regular', 'Bold', 'Black']
  };

  const weights = FONT_WEIGHTS_MAP[state.selectedFont] || ['Regular'];
  const weightLabels = ['Light', 'Regular', 'Bold', 'Black'];
  const weightLabelsArabic = ['🪶 رفيع', '📝 عادي', '⚖️ متوسط/عريض', '💪 عريض جداً']; // Just a rough mapping for UX

  const weightRow1: any[] = [];
  const weightRow2: any[] = [];
  for (let i = 0; i < 4; i++) {
    const wKey = weightLabels[i];
    const availableWeight = weights.includes(wKey);
    const isCurrentWeight = state.selectedWeight === wKey;
    const btn: any = availableWeight
      ? {
          text: isCurrentWeight ? `✅ ${wKey}` : wKey,
          callback_data: `design_weight_${wKey}`,
          style: 'primary' as const
        }
      : {
          text: `🔒 ${wKey}`,
          callback_data: 'design_weight_locked',
          // @ts-ignore
          style: 'default' as const
        };

    if (i < 2) weightRow1.push(btn);
    else weightRow2.push(btn);
  }
  rows.push(weightRow1);
  rows.push(weightRow2);

  // 4. COLORS (12 Colors in 4 rows of 3)
  rows.push([{ text: '🎨 لون النص', callback_data: 'design_noop', style: 'danger' as const }]);
  const colors = [
    { name: 'أبيض', hex: '#FFFFFF' }, { name: 'أسود', hex: '#000000' }, { name: 'أحمر', hex: '#FF0000' },
    { name: 'أزرق', hex: '#0000FF' }, { name: 'أخضر', hex: '#00CC44' }, { name: 'أصفر', hex: '#FFD700' },
    { name: 'برتقالي', hex: '#FF6600' }, { name: 'بنفسجي', hex: '#8B00FF' }, { name: 'وردي', hex: '#FF69B4' },
    { name: 'سماوي', hex: '#00BFFF' }, { name: 'بني', hex: '#8B4513' }, { name: 'رمادي', hex: '#808080' }
  ];
  for (let i = 0; i < colors.length; i += 3) {
    const row = colors.slice(i, i + 3).map(c => ({
      text: state.textColor === c.hex ? `✅ ${c.name}` : c.name,
      callback_data: `design_color_${c.hex.replace('#', '')}`,
      style: 'primary' as const
    }));
    rows.push(row);
  }

  // 5. NUDGE (MOVEMENT) CONTROLS
  rows.push([{ text: '🎛️ تحريك النص', callback_data: 'design_noop', style: 'danger' as const }]);
  rows.push([
    { text: '⬆️ أعلى', callback_data: 'design_nudge_up', style: 'primary' as const },
    { text: '⬇️ أسفل', callback_data: 'design_nudge_down', style: 'primary' as const },
    { text: '➡️ يمين', callback_data: 'design_nudge_right', style: 'primary' as const },
    { text: '⬅️ يسار', callback_data: 'design_nudge_left', style: 'primary' as const }
  ]);

  // 5.5 SCALE (ZOOM) CONTROLS
  rows.push([{ text: '🔍 تكبير وتصغير', callback_data: 'design_noop', style: 'danger' as const }]);
  rows.push([
    { text: '➖ تصغير', callback_data: 'design_scale_down', style: 'primary' as const },
    { text: '➕ تكبير', callback_data: 'design_scale_up', style: 'primary' as const }
  ]);

  // 6. ACTIONS
  rows.push([{ text: '✅ موافق', callback_data: 'design_font_confirm', style: 'success' as const }]);
  rows.push([{ text: '🔙 رجوع لتحديد المربعات', callback_data: 'design_back_to_cells', style: 'danger' as const }]);

  return { inline_keyboard: rows };
}



function buildDesignCellKeyboard(
  totalCells: number,
  selectedCells: number[]
): { inline_keyboard: any[][] } {
  const rows: any[][] = [];
  let currentRow: any[] = [];

  // ── MISSION 1: Number buttons — style: 'primary' (Blue) ──
  for (let i = 1; i <= totalCells; i++) {
    const isSelected = selectedCells.includes(i);
    currentRow.push({
      text: isSelected ? `✅ ${i}` : String(i),
      callback_data: `dsgc_${i}`,
      // @ts-ignore
      style: 'primary' as const,
    });
    if (currentRow.length === 5) {
      rows.push(currentRow);
      currentRow = [];
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);

  // ── MISSION 1: Action buttons — API 9.4 styles ──
  rows.push([{
    text: `✅ موافق (${selectedCells.length} مربع محدد)`,
    callback_data: 'design_confirm_grid',
    // @ts-ignore
    style: 'success' as const,   // Green
  }]);
  rows.push([{
    text: '🔙 رجوع لاختيار الحجم',
    callback_data: 'design_back_size',
    // @ts-ignore
    style: 'danger' as const,    // Red
  }]);
  rows.push([{
    text: '❌ إلغاء',
    callback_data: 'cancel_design',
    // @ts-ignore
    style: 'danger' as const,    // Red
  }]);

  return { inline_keyboard: rows };
}

async function generateDesignPreview(ctx: any, state: any) {
  const processingMsg = await ctx.reply('⏳ جاري تحضير المعاينة...');
  try {
    const { compositeDesign } = await import('../../services/designEngine');
    const previewBuffer = await compositeDesign(state.originalBuffer, state, false);

    await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });

    const { InputFile } = await import('grammy');
    const textMarkup = state.contentType === 'text'
      ? `\n🎨 <b>اللون الحالي:</b> ${state.textColor}`
      : '';

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: state.imageEffects.grayscale ? '✅ رمادي' : '🔲 رمادي', callback_data: 'design_eff_gray', style: 'primary' },
          { text: state.imageEffects.saturate ? '✅ تشبع' : '🔆 تشبع', callback_data: 'design_eff_sat', style: 'primary' },
        ],
        [
          { text: state.imageEffects.invert ? '✅ عكس' : '🔄 عكس الألوان', callback_data: 'design_eff_inv', style: 'primary' },
          { text: state.imageEffects.upscale ? '✅ 2x' : '🚀 تكبير (2x)', callback_data: 'design_eff_ups', style: 'primary' },
        ],
        [
          { text: '✅ تطبيق وحفظ', callback_data: 'design_apply', style: 'success' }
        ],
        [
          { text: '❌ إلغاء', callback_data: 'cancel_design', style: 'danger' }
        ]
      ]
    };

    if (state.previewMsgId) {
      // Just edit photo
      await ctx.api.editMessageMedia(
        ctx.chat!.id,
        state.previewMsgId,
        {
          type: 'photo',
          media: new InputFile(previewBuffer, 'preview.jpg') as any,
          caption: `👁️ <b>معاينة التصميم</b>${textMarkup}\n\nيمكنك تطبيق تأثيرات قبل الحفظ (يخصم محاولتين)`,
          parse_mode: 'HTML'
        },
        { reply_markup: replyMarkup }
      ).catch(() => { });
    } else {
      const pMsg = await ctx.replyWithPhoto(new InputFile(previewBuffer, 'preview.jpg'), {
        caption: `👁️ <b>معاينة التصميم</b>${textMarkup}\n\nيمكنك تطبيق تأثيرات قبل الحفظ (يخصم محاولتين)`,
        parse_mode: 'HTML',
        reply_markup: replyMarkup as any
      });
      state.previewMsgId = pMsg.message_id;
      const { setDesignState } = await import('../../utils/designState');
      setDesignState(ctx.from!.id, state);
    }
  } catch (e) {
    console.error(e);
    await ctx.reply('❌ فشل إنشاء المعاينة.');
  }
}

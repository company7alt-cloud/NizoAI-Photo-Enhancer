// src/services/botTextsService.ts
import { BotText, IBotText } from '../database/models/BotTexts'

export const DEFAULT_TEXTS: Record<string, {
  category: 'message' | 'button' | 'notification'
  value: string
  description: string
}> = {
  // ── MESSAGES ──────────────────────────────────────
  msg_start: {
    category: 'message',
    value: 'مرحباً بك في NizoAI Bot! 🎉\nاختر ما تريد:',
    description: 'رسالة الترحيب /start'
  },
  msg_eraser_ask: {
    category: 'message',
    value: '📸 أرسل الصورة التي تريد إزالة العلامة المائية من أسفلها اليمين.\n\n سيتم المعالجة تلقائياً بالذكاء الاصطناعي.\n💎 السعر: نقطة واحدة (1)',
    description: 'رسالة طلب الصورة — مُزيل العلامة التلقائي'
  },
  msg_eraser_processing: {
    category: 'message',
    value: '⏳ جاري تحليل الصورة وإزالة العلامة المائية بالذكاء الاصطناعي...\n⏱ قد يستغرق 30-60 ثانية',
    description: 'رسالة جاري المعالجة — مُزيل العلامة'
  },
  msg_eraser_success: {
    category: 'message',
    value: '✅ *تمت إزالة العلامة المائية بنجاح*\n\n📐 الحجم والمقاس الأصلي محفوظ بالكامل\n💎 الجودة: نسخة كاملة بدون ضغط',
    description: 'رسالة نجاح إزالة العلامة'
  },
  msg_eraser_error: {
    category: 'notification',
    value: '❌ عذراً، حدث خطأ. تم إعادة نقطتيك تلقائياً ',
    description: 'رسالة خطأ مُزيل العلامة'
  },
  msg_pro_ask: {
    category: 'message',
    value: '🚀 أرسل الصورة لبدء Pro Enhance',
    description: 'رسالة طلب صورة Pro Enhance'
  },
  msg_nano_ask: {
    category: 'message',
    value: '⏳ جاري تحسين صورتك بالذكاء الاصطناعي... \nالرجاء الانتظار 🌟',
    description: 'رسالة معالجة Nano AI'
  },
  msg_nano_success: {
    category: 'message',
    value: ' تم تحسين صورتك بنجاح! 🚀\n📁 تم الإرسال كملف للحفاظ على أعلى دقة',
    description: 'رسالة نجاح Nano AI'
  },
  msg_format_ask: {
    category: 'message',
    value: '🔄 أرسل الصورة كـ <b>مستند (ملف)</b> لتحويل صيغتها\nاضغط 📎 ← اختر "ملف" ← اختر صورتك',
    description: 'رسالة طلب ملف تحويل الصيغة'
  },
  msg_support_open: {
    category: 'message',
    value: '💬 تم فتح جلسة الدعم. يمكنك الآن إرسال رسائلك.',
    description: 'رسالة فتح جلسة الدعم'
  },
  msg_cancel: {
    category: 'message',
    value: '❌ تم الإلغاء.',
    description: 'رسالة الإلغاء العامة'
  },
  // ── NOTIFICATIONS ─────────────────────────────────
  notif_daily_reward: {
    category: 'notification',
    value: '🎁 تم منحك 5 محاولات مجانية! استمتع بتحسين صورك ',
    description: 'إشعار الهدية اليومية'
  },
  notif_quota_empty: {
    category: 'notification',
    value: '🌙 عذراً، انتهت محاولاتك اليومية 🥺\n⏳ الوقت المتبقي للتجديد: {timeLeft}\n🎁 ستحصل على 5 محاولات جديدة تلقائياً ',
    description: 'إشعار انتهاء المحاولات — {timeLeft} متغير'
  },
  notif_referral_reward: {
    category: 'notification',
    value: '🎉 يا هلا! دخل صديق جديد عن طريق رابطك!\n 💎 تمت إضافة 5 محاولات مجانية لرصيدك\nاستمر في مشاركة رابطك واكسب أكثر!',
    description: 'إشعار مكافأة الإحالة'
  },
  notif_channel_reward: {
    category: 'notification',
    value: '✅ تم التحقق! تم إضافة 5 محاولات مجانية لرصيدك 🎁',
    description: 'إشعار مكافأة الاشتراك في القناة'
  },
  notif_banned: {
    category: 'notification',
    value: '🚫 تم حظرك من استخدام البوت.',
    description: 'إشعار الحظر'
  },
  notif_insufficient_quota: {
    category: 'notification',
    value: '❌ رصيدك غير كافٍ.\n\n• المطلوب: {required} محاولات\n• رصيدك الحالي: {current} محاولة\n\nاستخدم 🎁 الهدية اليومية لزيادة رصيدك.',
    description: 'إشعار رصيد غير كافٍ — {required} و {current} متغيرات'
  },
  notif_error_generic: {
    category: 'notification',
    value: '❌ حدث خطأ أثناء المعالجة. حاول مرة أخرى.',
    description: 'إشعار خطأ عام'
  },
  // ── BUTTONS ───────────────────────────────────────
  btn_pro_enhance: {
    category: 'button',
    value: '⚙️ تحسين الصور (Pro)',
    description: 'نص زر Pro Enhance'
  },
  btn_eraser_auto: {
    category: 'button',
    value: '🧹 مُزيل النجمة التلقائي',
    description: 'نص زر مُزيل العلامة التلقائي'
  },
  btn_format_convert: {
    category: 'button',
    value: '🔄 تحويل صيغة الصورة',
    description: 'نص زر تحويل الصيغة'
  },
  btn_daily_reward: {
    category: 'button',
    value: '🎁 الهدية اليومية',
    description: 'نص زر الهدية اليومية'
  },
  btn_nano_ai: {
    category: 'button',
    value: ' تحسين الصورة بالذكاء',
    description: 'نص زر Nano AI'
  },
  btn_report: {
    category: 'button',
    value: '🚨 إبلاغ المطور',
    description: 'نص زر الإبلاغ'
  },
  btn_cancel: {
    category: 'button',
    value: '❌ إلغاء',
    description: 'نص زر الإلغاء'
  },
}

// ── Initialize on startup (never overwrites edited values) ─────────
export async function initBotTexts(): Promise<void> {
  for (const [key, data] of Object.entries(DEFAULT_TEXTS)) {
    await BotText.findOneAndUpdate(
      { key },
      {
        $setOnInsert: {
          key,
          category: data.category,
          value: data.value,
          defaultValue: data.value,
          description: data.description,
        }
      },
      { upsert: true }
    )
  }
  console.log('[BotTexts] ✅ Initialized')
}

// ── Get text — never throws ────────────────────────────────────────
export async function getText(key: string): Promise<string> {
  try {
    const doc = await BotText.findOne({ key }).lean()
    return doc?.value ?? DEFAULT_TEXTS[key]?.value ?? key
  } catch {
    return DEFAULT_TEXTS[key]?.value ?? key
  }
}

// ── Replace placeholders ──────────────────────────────────────────
export function parsePlaceholders(
  text: string,
  vars: Record<string, string>
): string {
  let result = text
  for (const [k, v] of Object.entries(vars)) {
    result = result.replaceAll(`{${k}}`, v)
  }
  return result
}

// ── Update text value ─────────────────────────────────────────────
export async function updateText(key: string, newValue: string): Promise<boolean> {
  const result = await BotText.findOneAndUpdate(
    { key },
    { $set: { value: newValue } }
  )
  return !!result
}

// ── Reset to default ──────────────────────────────────────────────
export async function resetText(key: string): Promise<string | null> {
  const doc = await BotText.findOne({ key })
  if (!doc) return null
  await BotText.updateOne({ key }, { $set: { value: doc.defaultValue } })
  return doc.defaultValue
}

// ── Search by content ─────────────────────────────────────────────
export async function searchByContent(query: string): Promise<IBotText[]> {
  return BotText.find({
    $or: [
      { value:        { $regex: query, $options: 'i' } },
      { defaultValue: { $regex: query, $options: 'i' } },
      { description:  { $regex: query, $options: 'i' } },
      { key:          { $regex: query, $options: 'i' } },
    ]
  }).limit(5).lean() as any
}

// ── Get all by category ───────────────────────────────────────────
export async function getByCategory(
  category: 'message' | 'button' | 'notification'
): Promise<IBotText[]> {
  return BotText.find({ category }).sort({ key: 1 }).lean() as any
}

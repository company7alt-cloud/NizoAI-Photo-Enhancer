export type DocumentType = 'medical_academic' | 'financial_business' | 'legal' | 'general';

export interface PromptAnalysisResult {
  enhancedPrompt: string;
  detectedPages: number;
  documentType: DocumentType;
  needsTables: boolean;
  hasExplicitPageRequest: boolean;
}

const ARABIC_WORD_NUMBERS: Record<string, number> = {
  واحد: 1,
  واحدة: 1,
  صفحة: 1,
  صفحتين: 2,
  صفحتان: 2,
  اثنين: 2,
  اثنتين: 2,
  ثنتين: 2,
  ثلاث: 3,
  ثلاثة: 3,
  اربع: 4,
  اربعة: 4,
  أربع: 4,
  أربعة: 4,
  خمس: 5,
  خمسة: 5,
  ست: 6,
  ستة: 6,
  سبع: 7,
  سبعة: 7,
  ثمان: 8,
  ثمانية: 8,
  تسع: 9,
  تسعة: 9,
  عشر: 10,
  عشرة: 10,
};

const DOCUMENT_TYPE_INSTRUCTIONS: Record<DocumentType, string> = {
  medical_academic: 'استخدم مصطلحات طبية أو أكاديمية دقيقة، مع تنظيم علمي واضح.',
  financial_business: 'استخدم لغة مهنية مناسبة للأعمال والمال والتقارير التنفيذية.',
  legal: 'استخدم بنية قانونية رسمية، وتعابير دقيقة ومنظمة.',
  general: 'استخدم عربية مهنية نظيفة وواضحة ومباشرة.',
};

export function analyzeAndEnhancePrompt(userRawPrompt: string): PromptAnalysisResult {
  const rawPrompt = userRawPrompt.trim();
  const detectedPages = detectRequestedPages(rawPrompt);
  const documentType = detectDocumentType(rawPrompt);
  const needsTables = detectTableNeed(rawPrompt);
  const hasExplicitPageRequest = hasPageMention(rawPrompt);

  const enhancedPrompt = [
    'SYSTEM INSTRUCTION (injected automatically):',
    '',
    'You are a professional document generator.',
    'ABSOLUTE RULES — NEVER VIOLATE:',
    '① Write ONLY the document. No preamble.',
    '② Use strict Markdown: #, ##, ###, bold.',
    '③ Tables: use ONLY | col | col | format.',
    '④ NEVER use LaTeX, math symbols, or code.',
    '⑤ NEVER write in any language except Arabic (and English technical terms inline).',
    '⑥ Complete EVERY sentence and table fully.',
    '⑦ End with: ---\\n**إعداد: [user_name]**',
    '',
    `Document style: ${DOCUMENT_TYPE_INSTRUCTIONS[documentType]}`,
    `Target length: ${detectedPages} page(s).`,
    'اكتب محتوى متماسكاً، كاملاً، وقابلاً للتحويل مباشرة إلى PDF بدون تداخل نصي.',
    '',
    'USER ORIGINAL REQUEST (unchanged):',
    userRawPrompt,
    ...(needsTables ? ['', buildTableTemplateInjection()] : []),
  ].join('\n');

  return {
    enhancedPrompt,
    detectedPages,
    documentType,
    needsTables,
    hasExplicitPageRequest,
  };
}

export function buildPageLimitGuardMessage(pageLimit: number): string {
  return (
    `⚠️ *الحد الأقصى المسموح به هو ${pageLimit} صفحات.*\n\n` +
    'إذا كنت تحتاج وثيقة أطول، تواصل مع المطور لفتح ' +
    'صلاحية الاشتراك الممتد:\n👉 @NizarDeveloper'
  );
}

function detectDocumentType(prompt: string): DocumentType {
  const normalized = normalizeArabic(prompt).toLowerCase();

  if (containsAny(normalized, [
    'طبي', 'طبية', 'طب', 'مرض', 'علاج', 'مريض', 'سريري', 'دواء',
    'اكاديمي', 'أكاديمي', 'بحث', 'دراسة', 'جامعة', 'منهجي',
    'medical', 'academic', 'research', 'clinical',
  ])) {
    return 'medical_academic';
  }

  if (containsAny(normalized, [
    'مالي', 'مالية', 'تمويل', 'ميزانية', 'ارباح', 'أرباح', 'خسائر',
    'شركة', 'اعمال', 'أعمال', 'تجاري', 'استثمار', 'business',
    'finance', 'financial', 'market', 'marketing',
  ])) {
    return 'financial_business';
  }

  if (containsAny(normalized, [
    'قانون', 'قانوني', 'قانونية', 'عقد', 'اتفاقية', 'محكمة',
    'دعوى', 'شرط', 'بنود', 'legal', 'contract', 'agreement',
  ])) {
    return 'legal';
  }

  return 'general';
}

function detectRequestedPages(prompt: string): number {
  const normalized = normalizeDigits(normalizeArabic(prompt));
  const pageUnit = '(?:صفحه|صفحات|page|pages)';
  const digitMatch = normalized.match(new RegExp(`(\\d{1,3})\\s*${pageUnit}`, 'i'));
  if (digitMatch) return Math.max(1, parseInt(digitMatch[1], 10));

  for (const [word, value] of Object.entries(ARABIC_WORD_NUMBERS)) {
    const normalizedWord = normalizeArabic(word);
    const pattern = new RegExp(`(?:${normalizedWord})\\s*${pageUnit}`, 'i');
    if (pattern.test(normalized)) return value;
  }

  return 2;
}

function hasPageMention(prompt: string): boolean {
  const normalized = normalizeDigits(normalizeArabic(prompt));
  return /(?:\d{1,3}|واحد|واحده|صفحتين|صفحتان|اثنين|اثنتين|ثنتين|ثلاث|ثلاثه|اربع|اربعه|خمس|خمسه|ست|سته|سبع|سبعه|ثمان|ثمانيه|تسع|تسعه|عشر|عشره)\s*(?:صفحه|صفحات|page|pages)/i.test(normalized);
}

function detectTableNeed(prompt: string): boolean {
  return /(?:جدول|مقارنه|table|compare)/i.test(normalizeArabic(prompt));
}

function buildTableTemplateInjection(): string {
  return [
    'اكتب الجدول التالي واملأ كل خانة [اكتب] بالمعلومات الدقيقة:',
    '| العنوان 1 | العنوان 2 | العنوان 3 |',
    '|---|---|---|',
    '| [اكتب] | [اكتب] | [اكتب] |',
    '| [اكتب] | [اكتب] | [اكتب] |',
  ].join('\n');
}

function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(normalizeArabic(keyword).toLowerCase()));
}

function normalizeArabic(text: string): string {
  return text
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\u0640/g, '');
}

function normalizeDigits(text: string): string {
  const digitMap: Record<string, string> = {
    '٠': '0',
    '١': '1',
    '٢': '2',
    '٣': '3',
    '٤': '4',
    '٥': '5',
    '٦': '6',
    '٧': '7',
    '٨': '8',
    '٩': '9',
    '۰': '0',
    '۱': '1',
    '۲': '2',
    '۳': '3',
    '۴': '4',
    '۵': '5',
    '۶': '6',
    '۷': '7',
    '۸': '8',
    '۹': '9',
  };

  return text.replace(/[٠-٩۰-۹]/g, (digit) => digitMap[digit] ?? digit);
}

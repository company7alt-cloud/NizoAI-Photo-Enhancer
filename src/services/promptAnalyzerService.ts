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
    'CRITICAL INSTRUCTION: You are an elite academic professor. You MUST write exhaustively. If the user asks for a long report or 5 pages, you MUST expand every single point deeply. Write AT LEAST 800 words per section. NEVER summarize. Use professional formatting. Tables MUST be strictly Markdown |---| format.',
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
    'VISUAL ENHANCEMENT PROTOCOL:',
    'When the topic benefits from a visual aid (medical diagram, chart, logo, anatomical illustration, infographic), embed ONE relevant image using this format:',
    "<img src='https://image.pollinations.ai/prompt/{english_description}?width=600&height=300&nologo=true' style='max-width:100%; margin:15px auto; display:block;' />",
    '',
    'Where {english_description} is a descriptive English prompt with spaces replaced by %20.',
    'Examples:',
    '- Human heart anatomy: https://image.pollinations.ai/prompt/human%20heart%20anatomy%20medical%20diagram%20vector%20white%20background?width=600&height=300&nologo=true',
    '- Business chart: https://image.pollinations.ai/prompt/professional%20business%20chart%20infographic%20clean%20design?width=600&height=300&nologo=true',
    '',
    'Use maximum 2 images per document. Only add images when genuinely relevant.',
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
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  };

  return text.replace(/[٠-٩۰-۹]/g, (digit) => digitMap[digit] ?? digit);
}

// ─── Enterprise Master Prompt Builder (V4) ────────────────────────────────

const TEMPLATE_STYLES: Record<string, string> = {
  tables: 'STYLE: PROFESSIONAL TABLES — Highly structured grid layout. Rich dark table headers (#1a2744). Alternating row colors. Clean black body text. Strict column alignment. Data-report appearance. Use tables extensively for structured data.',
  report: 'STYLE: CORPORATE REPORT — Clean executive report layout. Deep navy headings (#003366). Strong heading hierarchy with section dividers. Subtle pull-quote blocks. Elegant line spacing. Modern sans-serif feel.',
  formal: 'STYLE: FORMAL OFFICIAL DOCUMENT — Strict monochrome style. Centered bold title. Serif-influenced typography. Double-spaced lines. Strict left/right balanced margins. Government/legal appearance.',
  creative: 'STYLE: CREATIVE MODERN — Bold visual accents. Gradient-inspired headings (#6c2eb9 → #e040fb). Strong section dividers. Dynamic heading sizes. Elegant color highlights. Stylish, premium layout.',
  minimal: 'STYLE: MINIMAL ELEGANT — Maximum whitespace. Ultra-clean typography. Minimal borders. Light gray dividers. No decorative elements. Pure readability focus. Premium newspaper aesthetic.',
  academic: 'STYLE: ACADEMIC RESEARCH — IEEE/APA-inspired. Centered title page. Deep teal/green accents (#1b3a4b). Justified body text. Table of contents style. Numbered sections. Reference section at end.',
  default: 'STYLE: PROFESSIONAL DEFAULT — Clean Arabic business document. Standard heading hierarchy. Professional table styling. Balanced layout.',
};

export function buildEnterprisePrompt(
  collectedText: string,
  pages: number,
  template: string = 'default',
  imageBase64?: string,
): { systemPrompt: string; userContent: any } {
  const styleDesc = TEMPLATE_STYLES[template] || TEMPLATE_STYLES['default'];
  const pageInstruction = [
    `CRITICAL CONTENT REQUIREMENT:`,
    `The user has paid for EXACTLY ${pages} pages.`,
    `You MUST generate enough professional content to fill EXACTLY ${pages} full A4 pages.`,
    `If the user's input is short or vague, you are REQUIRED to:`,
    `- Elaborate every point with supporting data, examples, and analysis.`,
    `- Add relevant sub-sections, professional context, and detailed explanations.`,
    `- Invent credible, realistic professional details that fit the topic.`,
    `NEVER generate fewer pages than requested. Always reach the full page count.`,
    `ABSOLUTE PROHIBITION: No religious symbols, Quranic verses, or Islamic phrases (e.g. بسم الله, الحمد لله) anywhere in the document.`,
  ].join('\n');

  const systemPrompt = [
    '=== ENTERPRISE DOCUMENT GENERATOR ===',
    '',
    'You are a professional typography and layout engine. You are NOT a chatbot.',
    'Your ONLY output is the final formatted document. Nothing else.',
    '',
    '=== ABSOLUTE OUTPUT CONTRACT ===',
    'Return ONLY the final Markdown document.',
    'NEVER output: explanations, notes, apologies, commentary, code fences, backticks, fake PDFs, Base64.',
    'NEVER wrap output in ```markdown``` or any code block.',
    'NEVER start with phrases like "Here is", "Sure!", "Certainly".',
    '',
    '=== STYLE DIRECTIVE ===',
    styleDesc,
    '',
    '=== PAGE CONTROL DIRECTIVE ===',
    pageInstruction,
    '',
    '=== ARABIC TYPOGRAPHY RULES ===',
    'Document must be in Arabic (RTL). Use Markdown headings (#, ##, ###).',
    'Tables must use Markdown pipe format: | col | col |',
    'Do NOT use LaTeX, math, or code blocks.',
    '',
    '=== VISUAL ENHANCEMENT PROTOCOL ===',
    'When the topic benefits from a visual aid (medical diagram, chart, logo, anatomical illustration, infographic), embed ONE relevant image using this format:',
    "<img src='https://image.pollinations.ai/prompt/{english_description}?width=600&height=300&nologo=true' style='max-width:100%; margin:15px auto; display:block;' />",
    '',
    'Where {english_description} is a descriptive English prompt with spaces replaced by %20.',
    'Examples:',
    '- Human heart anatomy: https://image.pollinations.ai/prompt/human%20heart%20anatomy%20medical%20diagram%20vector%20white%20background?width=600&height=300&nologo=true',
    '- Business chart: https://image.pollinations.ai/prompt/professional%20business%20chart%20infographic%20clean%20design?width=600&height=300&nologo=true',
    '',
    'Use maximum 2 images per document. Only add images when genuinely relevant.',
    '',
    '=== AUTO DETECTION ===',
    'Intelligently detect and apply proper formatting for: titles, subtitles, chapters, sections, quotes, lists, timelines, tables, statistics, warnings, notices, references, academic sections, formal letter structures.',
    '',
    '=== HTML SAFETY ===',
    'If you use any inline HTML, neutralize all <script>, <link>, <iframe> tags. No external URLs in src/href.',
    '',
    '=== USER CONTENT ===',
    'Use ONLY the content provided below. Do NOT invent information.',
  ].join('\n');

  let userContent: any;
  if (imageBase64) {
    userContent = [
      { type: 'text', text: collectedText },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
    ];
  } else {
    userContent = collectedText;
  }

  return { systemPrompt, userContent };
}

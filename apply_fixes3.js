const fs = require('fs');
const path = require('path');

const indexFile = path.join(__dirname, 'src', 'index.ts');
let indexCode = fs.readFileSync(indexFile, 'utf8');

// 1. Buttons
indexCode = indexCode.replace(
  "[{ text: 'تلقائي',  callback_data: 'free_pdf_auto', style: 'primary' }],",
  "[{ text: '✏️ تلقائي',  callback_data: 'free_pdf_auto', style: 'primary' }],"
);
indexCode = indexCode.replace(
  "[{ text: 'احترافي', callback_data: 'free_pdf_pro',  style: 'primary' }],",
  "[{ text: '🖼✏️ احترافي', callback_data: 'free_pdf_pro',  style: 'primary' }],"
);
indexCode = indexCode.replace(
  "[{ text: 'تلقائي',  callback_data: 'nizo_pdf_auto', style: 'primary' }],",
  "[{ text: '✏️ تلقائي',  callback_data: 'nizo_pdf_auto', style: 'primary' }],"
);
indexCode = indexCode.replace(
  "[{ text: 'احترافي', callback_data: 'nizo_pdf_pro',  style: 'primary' }],",
  "[{ text: '🖼✏️ احترافي', callback_data: 'nizo_pdf_pro',  style: 'primary' }],"
);

// 2. Limit Message Call Sites
const limitMsgReplacement = `await ctx.reply(
        '⚠️ الحد الأقصى المسموح به هو 5 صفحات.\\n' +
        'إذا كنت تحتاج وثيقة أطول، تواصل مع المطور لفتح صلاحية الاشتراك الممتد.',
        {
          reply_markup: {
            inline_keyboard: [[
              // @ts-ignore
              {
                text: '💬 تواصل مع المطور',
                url: 'https://t.me/NizarDeveloper',
                style: 'primary' as any
              }
            ]]
          }
        }
      );`;

indexCode = indexCode.replace(
  "await ctx.reply(buildPageLimitGuardMessage(pageLimit), { parse_mode: 'Markdown' });",
  limitMsgReplacement
);
// replace second occurrence too
indexCode = indexCode.replace(
  "await ctx.reply(buildPageLimitGuardMessage(pageLimit), { parse_mode: 'Markdown' });",
  limitMsgReplacement
);


// 3. nizo_auto generate
indexCode = indexCode.replace(
  "const pdfPath = await generateAiPDF(cleanMarkdown, template);",
  "ctx.session.isAutoMode = true;\n      const pdfPath = await generateAiPDF(cleanMarkdown, template, ctx.session.isAutoMode);\n      ctx.session.isAutoMode = false;"
);

// 4. free_auto generate
indexCode = indexCode.replace(
  "const pdfBuffer = await generateAiPDF(cleanMarkdown);",
  "ctx.session.isAutoMode = true;\n      const pdfBuffer = await generateAiPDF(cleanMarkdown, undefined, ctx.session.isAutoMode);\n      ctx.session.isAutoMode = false;"
);


// 5. lastPageCount for nizo_auto (around 2200)
const nizoCaptionOld = "📄 الصفحات الفعّالة: ${finalPages}`";
const nizoCaptionNew = "📄 عدد الصفحات: ${ctx.session.lastPageCount}`";

indexCode = indexCode.replace(
  "await ctx.replyWithDocument(\n        new InputFile(pdfPath, `NizoAI_Doc_${Date.now()}.pdf`),",
  `const _pageBreaks = (cleanMarkdown.match(/page-break-after|page-break-before|class="page"/g) ?? []).length;
      const _actualPageCount = _pageBreaks > 0 ? _pageBreaks + 1 : 1;
      ctx.session.lastPageCount = _actualPageCount;

      await ctx.replyWithDocument(
        new InputFile(pdfPath, \`NizoAI_Doc_\${Date.now()}.pdf\`),`
);

indexCode = indexCode.replace(nizoCaptionOld, nizoCaptionNew);


// 6. lastPageCount for free_auto
indexCode = indexCode.replace(
  "ctx.session.lastImageCountPerPage = parseImageSections(cleanMarkdown);",
  "const _pageBreaksFree = (cleanMarkdown.match(/page-break-after|page-break-before|class=\"page\"/g) ?? []).length;\n      const _actualPageCountFree = _pageBreaksFree > 0 ? _pageBreaksFree + 1 : 1;\n      ctx.session.lastPageCount = _actualPageCountFree;\n      ctx.session.lastImageCountPerPage = parseImageSections(cleanMarkdown);"
);

indexCode = indexCode.replace(
  "{ caption: '✅ مستندك المجاني جاهز! 📄\\n\\nمدعوم بـ AI Free PDF ⚡' }",
  "{ caption: '✅ مستندك المجاني جاهز! 📄\\n\\nعدد الصفحات: ' + ctx.session.lastPageCount + '\\nمدعوم بـ AI Free PDF ⚡' }"
);


// 7. Image guard for free_auto
const freeAutoGuardRegex = /if\s*\(\s*ctx\.session\.awaitingFreeAiTopic\s*\)\s*\{/g;
let matchFree = freeAutoGuardRegex.exec(indexCode);
const guardCode = `
    // ── Image Request Guard ──────────────────────
    if (ctx.session.proImageMode !== true) {
      const _imageKeywords = [
        'صورة','صور','صوره','صوري','صورتي','الصورة','الصور',
        'صورك','اضف صورة','ضف صورة','أضف صورة',
        'مع صورة','فيه صورة','يحتوي صورة','تضمين صورة',
        'صور احترافية','صور توضيحية','صور للمستند',
        'ادرج صورة','أدرج صورة','ارفق صورة',
        'حط صورة','خلي فيه صورة','ابغا صورة',
        'image','images','photo','photos','picture','pictures',
        'img','add image','with image','include image',
        'صورة لكل','صور لكل','صورة في كل',
      ];
      const _lowerText = (ctx.message?.text || '').toLowerCase();
      const _foundKeyword = _imageKeywords.find(kw => _lowerText.includes(kw.toLowerCase()));
      if (_foundKeyword) {
        await ctx.reply(
          '⚠️ تنبيه مهم\\n\\n' +
          'رسالتك تحتوي على طلب صور: "' + _foundKeyword + '"\\n\\n' +
          '✏️ زر التلقائي مخصص للنصوص فقط ولا يدعم الصور.\\n\\n' +
          'لديك خياران:\\n' +
          '1️⃣ احذف الكلمات المتعلقة بالصور وأعد الإرسال\\n' +
          '2️⃣ اذهب لأحد هذين الزرين لمستند يدعم الصور:\\n' +
          '   • 🤖 NizoAI PDF\\n' +
          '   • FREE Ai Free PDF\\n' +
          'ثم اختر "🖼✏️ احترافي"',
          {
            reply_markup: {
              inline_keyboard: [
                // @ts-ignore
                [{ text: '🤖 NizoAI PDF',    callback_data: 'start_nizo_pdf', style: 'primary' as any }],
                // @ts-ignore
                [{ text: 'FREE Ai Free PDF', callback_data: 'start_free_pdf', style: 'primary' as any }],
                // @ts-ignore
                [{ text: '❌ إلغاء',          callback_data: 'cancel',         style: 'danger'  as any }],
              ]
            }
          }
        );
        return;
      }
    }
    // ─────────────────────────────────────────────
`;
if (matchFree) {
  indexCode = indexCode.substring(0, matchFree.index + matchFree[0].length) + guardCode + indexCode.substring(matchFree.index + matchFree[0].length);
}

// 8. Image guard for nizo_auto
const nizoAutoGuardStr = "if (ctx.session.awaitingMoreText && ctx.message?.text) {";
indexCode = indexCode.replace(nizoAutoGuardStr, nizoAutoGuardStr + guardCode);

fs.writeFileSync(indexFile, indexCode);
console.log('done');

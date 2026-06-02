const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'bot', 'handlers', 'docMakerHandler.ts');
const raw = fs.readFileSync(filePath, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.split(/\r?\n/);

// ─── Verify anchors ───────────────────────────────────────────────────────────
if (!lines[329].includes('typo_letter'))         { console.error('BAD anchor L330'); process.exit(1); }
if (!lines[532].includes('inline_keyboard'))     { console.error('BAD anchor L533'); process.exit(1); }
if (!lines[534].includes('Omnia'))               { console.error('BAD anchor L535'); process.exit(1); }
if (!lines[549].includes('doc_font_'))           { console.error('BAD anchor L550'); process.exit(1); }
if (!lines[550].includes('answerCallbackQuery')) { console.error('BAD anchor L551'); process.exit(1); }
if (!lines[551].includes('selectedFont'))        { console.error('BAD anchor L552'); process.exit(1); }
console.log('✅ All anchors verified.');

// ─── Apply in reverse order (highest lines first) to keep indices stable ─────

// CHANGE 3: Insert warning interceptor between lines 550 and 551 (0-indexed)
// i.e. after the `if (data.startsWith('doc_font_')) {` line
// Insert BEFORE index 550 (the answerCallbackQuery line)
const warnBlock = [
  `    // ── STRICT WARNING FOR ANDO PRO FONT ──`,
  `    if (data === 'doc_font_ando_warn') {`,
  `      await ctx.answerCallbackQuery().catch(() => {});`,
  `      await ctx.editMessageCaption({`,
  `        caption:`,
  `          '⚠️ <b>تنبيه هام بخصوص خط (أندو برو):</b>\\n\\n' +`,
  `          'هذا الخط يدعم <b>النص العربي فقط</b> ولا يدعم أي رموز، أرقام، أو أحرف إنجليزية.\\n\\n' +`,
  `          '• إذا كان مشروعك <b>لا يحتوي</b> على أي من هذه الرموز، يمكنك المواصلة.\\n' +`,
  `          '• إذا كان يحتوي عليها، <b>ننصحك باختيار الخط الرسمي</b> لتجنب تشوه المستند.',`,
  `        parse_mode: 'HTML',`,
  `        reply_markup: {`,
  `          inline_keyboard: [`,
  `            [{ text: '✅ مواصلة بخط أندو برو', callback_data: 'doc_font_ando_pro' }],`,
  `            [{ text: '📜 اختيار الخط الرسمي بدلاً منه', callback_data: 'doc_font_noto' }],`,
  `          ],`,
  `        },`,
  `      }).catch(logDocMakerCleanup('[DocMaker] edit ando_warn caption failed:'));`,
  `      return true;`,
  `    }`,
  `    // ────────────────────────────────────────────`,
  ``,
];
lines.splice(550, 0, ...warnBlock); // insert before index 550 (L551)
console.log(`✅ Change 3 applied (+${warnBlock.length} lines at L551).`);

// CHANGE 2: Replace font menu inline_keyboard lines 533–543 (0-indexed 532–542)
// Now shifted by warnBlock.length, but these are ABOVE the insertion point (L550+)
// so indices 532–542 are UNCHANGED.
const newFontMenu = [
  `        inline_keyboard: [`,
  `          [{ text: 'قلم عريض احترافي (Almarai)', callback_data: 'doc_font_almarai', style: 'primary' as const }],`,
  `          [{ text: 'الخط الرسمي الشامل (Noto Naskh)', callback_data: 'doc_font_noto', style: 'primary' as const }],`,
  `          // @ts-ignore`,
  `          [{ text: 'خط أندو برو (Ando Pro)', callback_data: 'doc_font_ando_warn', style: 'primary' as const }],`,
  `          [{ text: '❌ إلغاء', callback_data: 'doc_cancel_end', style: 'danger' as const }],`,
  `        ],`,
];
// Lines 533–543 (1-based) = indices 532–542 (0-based), count = 11
lines.splice(532, 11, ...newFontMenu);
console.log(`✅ Change 2 applied (font menu: replaced 11 lines with ${newFontMenu.length}).`);

// CHANGE 1: Add 'doc_font_ando_warn' to docCallbacks array — line 330 (0-indexed 329)
// This is above both previous changes, indices unchanged.
lines[329] = lines[329].replace(
  `'typo_letter','typo_line','typo_cancel'`,
  `'typo_letter','typo_line','typo_cancel',\n    'doc_font_ando_warn'`
);
console.log('✅ Change 1 applied (docCallbacks).');

// ─── Write back ───────────────────────────────────────────────────────────────
fs.writeFileSync(filePath, lines.join(eol), 'utf8');
console.log('\n✅ All changes written. Run: npm run build');

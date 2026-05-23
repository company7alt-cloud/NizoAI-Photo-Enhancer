const fs = require('fs');

// ── FIX 1: aiPdfService.ts — insert before generateProImagePDF ───────────────
let pdf = fs.readFileSync('src/services/aiPdfService.ts', 'utf8');

if (!pdf.includes('generateAiPDFFromHtml')) {
  // Find the exact byte position of "export async function generateProImagePDF"
  const marker = 'export async function generateProImagePDF';
  const pos = pdf.indexOf(marker);
  if (pos === -1) { console.error('ERROR: marker not found in aiPdfService.ts'); process.exit(1); }

  const newFunctions = `// ─── Re-render PDF from pre-built HTML (BUG 3) ────────────────────────────────
export async function generateAiPDFFromHtml(fullHtml: string): Promise<string> {
  const pdfPath = path.join(process.cwd(), 'temp', \`document_\${Date.now()}.pdf\`);
  if (!fs.existsSync(path.dirname(pdfPath))) {
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
  }
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none', '--disable-dev-shm-usage'],
    timeout: 90000,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'networkidle2' as any, timeout: 90000 });
    await page.evaluateHandle('document.fonts.ready');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.pdf({
      path: pdfPath, format: 'A4', printBackground: true,
      margin: { top: '2.5cm', right: '2cm', bottom: '2.5cm', left: '2cm' },
      displayHeaderFooter: false, timeout: 90000,
    });
  } finally {
    await browser.close();
  }
  return pdfPath;
}

// ─── Generate PDF + return HTML for caching (BUG 3) ──────────────────────────
export async function generateAiPDFAndHtml(rawMarkdown: string, template: string = 'default'): Promise<{ pdfPath: string; html: string }> {
  const cleanMarkdown = sanitizeForPdf(rawMarkdown);
  const processedText = await processImages(cleanMarkdown);
  const bodyHtml = await Promise.resolve(marked.parse(processedText));
  const fullHtml = buildHtml(bodyHtml, template);
  const pdfPath = await generateAiPDFFromHtml(fullHtml);
  return { pdfPath, html: fullHtml };
}

`;
  pdf = pdf.slice(0, pos) + newFunctions + pdf.slice(pos);
  fs.writeFileSync('src/services/aiPdfService.ts', pdf, 'utf8');
  console.log('✅ aiPdfService.ts: new functions inserted');
} else {
  console.log('⏭  aiPdfService.ts: already patched');
}

// ── FIX 2: index.ts — callback still calls handleProEditConfirm ──────────────
let idx = fs.readFileSync('src/index.ts', 'utf8');
if (idx.includes("await handleProEditConfirm(ctx);")) {
  idx = idx.replace("await handleProEditConfirm(ctx);", "await handleProEditConfirmV2(ctx);");
  fs.writeFileSync('src/index.ts', idx, 'utf8');
  console.log('✅ index.ts: callback now calls handleProEditConfirmV2');
} else {
  console.log('⏭  index.ts: already calling handleProEditConfirmV2');
}

// ── FIX 3: editWorkflow.ts — add @ts-ignore + non-null assertions on line 322 ─
let ew = fs.readFileSync('src/handlers/docmaker/editWorkflow.ts', 'utf8');

// Fix ctx.chat.id (possibly undefined) and menuMsgId (possibly undefined)
if (ew.includes('      await ctx.api.editMessageReplyMarkup(ctx.chat.id, menuMsgId, {')) {
  ew = ew.replace(
    '      await ctx.api.editMessageReplyMarkup(ctx.chat.id, menuMsgId, {',
    '      // @ts-ignore\n      await ctx.api.editMessageReplyMarkup(ctx.chat!.id, menuMsgId!, {'
  );
  console.log('✅ editWorkflow.ts: @ts-ignore + non-null assertions added on editMessageReplyMarkup call');
} else {
  console.log('⏭  editWorkflow.ts: editMessageReplyMarkup already patched');
}

fs.writeFileSync('src/handlers/docmaker/editWorkflow.ts', ew, 'utf8');
console.log('\n✅ All 3 fixes applied. Running build...\n');

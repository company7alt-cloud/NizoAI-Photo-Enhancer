const fs = require('fs');

// Patch src/index.ts
const idxPath = 'c:/NizoAI-Bot/src/index.ts';
let idxContent = fs.readFileSync(idxPath, 'utf8');

const oldBlock1 = `    try {
      const { fetchHighResImage } = await import('./services/imageFetcherService');
      const imageBuffer: Buffer = await fetchHighResImage(link);
      clearInterval(fetchInterval);`;

const newBlock1 = `    try {
      const { fetchHighResImage } = await import('./services/imageFetcherService');
      const imageBuffer: Buffer = await fetchHighResImage(link);

      // --- PHANTOM VALIDATOR: Ensure it's a real image, not HTML ---
      const head = imageBuffer.toString('utf8', 0, 50).toLowerCase();
      if (head.includes('<html') || head.includes('<!doctype') || head.includes('<body')) {
        throw new Error('CORRUPTED_HTML_RECEIVED');
      }

      try {
        const sharp = (await import('sharp')).default;
        await sharp(imageBuffer).metadata();
      } catch (e) {
        throw new Error('CORRUPTED_INVALID_IMAGE');
      }
      // --------------------------------------------------------------

      clearInterval(fetchInterval);`;

if (!idxContent.includes('CORRUPTED_HTML_RECEIVED')) {
  idxContent = idxContent.replace(oldBlock1, newBlock1);
  idxContent = idxContent.replace(oldBlock1.replace(/\n/g, '\r\n'), newBlock1.replace(/\n/g, '\r\n'));
}

const oldBlock2 = `      } else if (errMsg.includes('ALL_LAYERS_EXHAUSTED')) {
        errorReply = '\\u274c <b>\\u0644\\u0645 \\u0623\\u062c\\u062f \\u0635\\u0648\\u0631\\u0629 \\u0635\\u0627\\u0644\\u062d\\u0629 \\u0641\\u064a \\u0647\\u0630\\u0627 \\u0627\\u0644\\u0631\\u0627\\u0628\\u0637!</b>\\n\\n\\u0623\\u0631\\u0633\\u0644 \\u0631\\u0627\\u0628\\u0637 \\u0645\\u0628\\u0627\\u0634\\u0631 \\u0644\\u0644\\u0645\\u0648\\u0642\\u0639 (\\u0645\\u062b\\u0644 freepik \\u0623\\u0648 adobe) \\u0648\\u0644\\u064a\\u0633 \\u0631\\u0627\\u0628\\u0637 \\u0645\\u0634\\u0627\\u0631\\u0643\\u0629 \\u0645\\u0646 \\u062c\\u0648\\u062c\\u0644 \\ud83d\\udd17';
      }`;

const newBlock2 = `      } else if (errMsg.includes('ALL_LAYERS_EXHAUSTED')) {
        errorReply = '\\u274c <b>\\u0644\\u0645 \\u0623\\u062c\\u062f \\u0635\\u0648\\u0631\\u0629 \\u0635\\u0627\\u0644\\u062d\\u0629 \\u0641\\u064a \\u0647\\u0630\\u0627 \\u0627\\u0644\\u0631\\u0627\\u0628\\u0637!</b>\\n\\n\\u0623\\u0631\\u0633\\u0644 \\u0631\\u0627\\u0628\\u0637 \\u0645\\u0628\\u0627\\u0634\\u0631 \\u0644\\u0644\\u0645\\u0648\\u0642\\u0639 (\\u0645\\u062b\\u0644 freepik \\u0623\\u0648 adobe) \\u0648\\u0644\\u064a\\u0633 \\u0631\\u0627\\u0628\\u0637 \\u0645\\u0634\\u0627\\u0631\\u0643\\u0629 \\u0645\\u0646 \\u062c\\u0648\\u062c\\u0644 \\ud83d\\udd17';
      } else if (errMsg.includes('CORRUPTED_')) {
        errorReply = '❌ <b>الموقع قام بحظر السحب!</b>\\n\\nحماية الموقع منعت العفريت وتم إرجاع صفحة فارغة.\\nيرجى تجربة رابط آخر 🔗';
      }`;

if (!idxContent.includes('CORRUPTED_')) {
  idxContent = idxContent.replace(oldBlock2, newBlock2);
  idxContent = idxContent.replace(oldBlock2.replace(/\n/g, '\r\n'), newBlock2.replace(/\n/g, '\r\n'));
}

fs.writeFileSync(idxPath, idxContent, 'utf8');

// Patch src/services/imageFetcherService.ts
const svcPath = 'c:/NizoAI-Bot/src/services/imageFetcherService.ts';
let svcContent = fs.readFileSync(svcPath, 'utf8');

const svcOld = `    const page = await browser.newPage();
    await page.setViewport({ width: viewportWidth, height: viewportHeight });

    await page.evaluateOnNewDocument(() => {`;

const svcNew = `    const page = await browser.newPage();
    await page.setViewport({ width: viewportWidth, height: viewportHeight });

    // --- FREEPIK DIRECT BYPASS ---
    if (targetUrl.includes('freepik.com')) {
      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const imgUrl = await page.evaluate(() => {
          const meta = document.querySelector('meta[property="og:image"]');
          if (meta) return meta.getAttribute('content');
          const img = document.querySelector('img[data-cy="image-detail-img"]') || document.querySelector('.thumb img');
          return img ? img.getAttribute('src') : null;
        });
        
        if (imgUrl && imgUrl.startsWith('http')) {
          const viewSource = await page.goto(imgUrl, { waitUntil: 'networkidle0', timeout: 30000 });
          if (viewSource) {
            const buf = await viewSource.buffer();
            if (!buf.toString('utf8', 0, 20).toLowerCase().includes('<html')) {
              state.success = true;
              return buf; // Return pure image
            }
          }
        }
      } catch (e) {
        console.error('[Freepik Bypass Error]', e);
      }
    }
    // -----------------------------

    await page.evaluateOnNewDocument(() => {`;

if (!svcContent.includes('FREEPIK DIRECT BYPASS')) {
  svcContent = svcContent.replace(svcOld, svcNew);
  svcContent = svcContent.replace(svcOld.replace(/\n/g, '\r\n'), svcNew.replace(/\n/g, '\r\n'));
}

fs.writeFileSync(svcPath, svcContent, 'utf8');
console.log('Patches applied');

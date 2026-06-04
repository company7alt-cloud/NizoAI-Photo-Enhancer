const fs = require('fs');

const idxPath = 'c:/NizoAI-Bot/src/index.ts';
let idxContent = fs.readFileSync(idxPath, 'utf8');

const anchor = "      } else if (errMsg.includes('ALL_LAYERS_EXHAUSTED')) {";
const splitContent = idxContent.split(anchor);
if (splitContent.length === 2 && !idxContent.includes('CORRUPTED_')) {
  // It's split properly. The second part starts with the inside of the block.
  // Let's insert our logic right before the await ctx.reply(errorReply, { parse_mode: 'HTML' });
  const anchor2 = "await ctx.reply(errorReply, { parse_mode: 'HTML' });";
  const newPart = splitContent[1].replace(anchor2, `} else if (errMsg.includes('CORRUPTED_')) {
        errorReply = '❌ <b>الموقع قام بحظر السحب!</b>\\n\\nحماية الموقع منعت العفريت وتم إرجاع صفحة فارغة.\\nيرجى تجربة رابط آخر 🔗';
      }
      ` + anchor2);
  idxContent = splitContent[0] + anchor + newPart;
  fs.writeFileSync(idxPath, idxContent, 'utf8');
}

const svcPath = 'c:/NizoAI-Bot/src/services/imageFetcherService.ts';
let svcContent = fs.readFileSync(svcPath, 'utf8');
const anchor3 = "    await page.evaluateOnNewDocument(() => {";

if (svcContent.includes(anchor3) && !svcContent.includes('FREEPIK DIRECT BYPASS')) {
  const replacement3 = `    // --- FREEPIK DIRECT BYPASS ---
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

` + anchor3;
  svcContent = svcContent.replace(anchor3, replacement3);
  fs.writeFileSync(svcPath, svcContent, 'utf8');
}

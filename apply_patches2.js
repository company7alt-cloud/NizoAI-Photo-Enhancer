const fs = require('fs');

// Patch src/index.ts
const idxPath = 'c:/NizoAI-Bot/src/index.ts';
let idxContent = fs.readFileSync(idxPath, 'utf8');

const target1 = "const imageBuffer: Buffer = await fetchHighResImage(link);";
const replacement1 = `const imageBuffer: Buffer = await fetchHighResImage(link);

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
      // --------------------------------------------------------------`;

if (idxContent.includes(target1) && !idxContent.includes('PHANTOM VALIDATOR')) {
  idxContent = idxContent.replace(target1, replacement1);
}

const target2 = "} else if (errMsg.includes('ALL_LAYERS_EXHAUSTED')) {";
const target2b = "} else if (errMsg.includes(\"ALL_LAYERS_EXHAUSTED\")) {"; // fallback

const replacement2 = `} else if (errMsg.includes('ALL_LAYERS_EXHAUSTED')) {
        errorReply = '\\u274c <b>\\u0644\\u0645 \\u0623\\u062c\\u062f \\u0635\\u0648\\u0631\\u0629 \\u0635\\u0627\\u0644\\u062d\\u0629 \\u0641\\u064a \\u0647\\u0630\\u0627 \\u0627\\u0644\\u0631\\u0627\\u0628\\u0637!</b>\\n\\n\\u0623\\u0631\\u0633\\u0644 \\u0631\\u0627\\u0628\\u0637 \\u0645\\u0628\\u0627\\u0634\\u0631 \\u0644\\u0644\\u0645\\u0648\\u0642\\u0639 (\\u0645\\u062b\\u0644 freepik \\u0623\\u0648 adobe) \\u0648\\u0644\\u064a\\u0633 \\u0631\\u0627\\u0628\\u0637 \\u0645\\u0634\\u0627\\u0631\\u0643\\u0629 \\u0645\\u0646 \\u062c\\u0648\\u062c\\u0644 \\ud83d\\udd17';
      } else if (errMsg.includes('CORRUPTED_')) {
        errorReply = '❌ <b>الموقع قام بحظر السحب!</b>\\n\\nحماية الموقع منعت العفريت وتم إرجاع صفحة فارغة.\\nيرجى تجربة رابط آخر 🔗';
      }`;

if (idxContent.includes(target2) && !idxContent.includes('CORRUPTED_')) {
  // We actually need to inject before or after.
  // The block in index.ts is:
  // } else if (errMsg.includes('ALL_LAYERS_EXHAUSTED')) {
  //   errorReply = '...';
  // }
  
  // It's safer to just replace `} else if (errMsg.includes('ALL_LAYERS_EXHAUSTED')) {`
  // with itself and append our block. Wait, the replacement text I wrote completely replaced `} else if ...` but didn't include the inside of the block.
  // Let me replace `await ctx.reply(errorReply, { parse_mode: 'HTML' });` instead!
  
  const targetReply = "await ctx.reply(errorReply, { parse_mode: 'HTML' });";
  const replacementReply = `} else if (errMsg.includes('CORRUPTED_')) {
        errorReply = '❌ <b>الموقع قام بحظر السحب!</b>\\n\\nحماية الموقع منعت العفريت وتم إرجاع صفحة فارغة.\\nيرجى تجربة رابط آخر 🔗';
      }
      await ctx.reply(errorReply, { parse_mode: 'HTML' });`;
      
  idxContent = idxContent.replace(targetReply, replacementReply);
}

fs.writeFileSync(idxPath, idxContent, 'utf8');


// Patch src/services/imageFetcherService.ts
const svcPath = 'c:/NizoAI-Bot/src/services/imageFetcherService.ts';
let svcContent = fs.readFileSync(svcPath, 'utf8');

const svcTarget = "await page.evaluateOnNewDocument(() => {";
const svcReplacement = `// --- FREEPIK DIRECT BYPASS ---
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

if (svcContent.includes(svcTarget) && !svcContent.includes('FREEPIK DIRECT BYPASS')) {
  svcContent = svcContent.replace(svcTarget, svcReplacement);
}

fs.writeFileSync(svcPath, svcContent, 'utf8');
console.log('Patches applied successfully!');

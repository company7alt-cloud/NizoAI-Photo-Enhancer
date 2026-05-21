const fs = require('fs');
let src = fs.readFileSync('src/services/aiPdfService.ts', 'utf8');

// Build old and new using LF (\n) only — file is LF-terminated
const OLD = [
  "    } catch (err) {",
  "      console.error('[ImageInterceptor] Error:', err);",
  "      // On failure: remove the broken img tag completely",
  "      processed = processed.replace(/>img[\\s\\S]*?nologo=true['\"\\>\\s]*/g, '');",
  "    }"
].join('\n');

const NEW = [
  "    } catch (err) {",
  "      console.error('[ImageInterceptor] Error:', err);",
  "      // On failure: try Unsplash fallback using keyword extracted from URL",
  "      try {",
  "        // Extract a readable keyword from the pollinations URL path",
  "        const sectionKeyword = url",
  "          .replace(/https?:\\/\\/[^/]+\\/prompt\\//, '')",
  "          .split('?')[0]",
  "          .replace(/%20/g, ' ')",
  "          .replace(/[_+]/g, ' ')",
  "          .trim()",
  "          .slice(0, 60) || 'professional document illustration';",
  "        const fallbackUrl = await fetchUnsplashImage(sectionKeyword);",
  "        const fallbackResponse = await fetch(fallbackUrl, { signal: AbortSignal.timeout(10000) });",
  "        if (fallbackResponse.ok) {",
  "          const fbBuffer = Buffer.from(await fallbackResponse.arrayBuffer());",
  "          const fbBase64 = fbBuffer.toString('base64');",
  "          const fbDataUri = `data:image/jpeg;base64,${fbBase64}`;",
  "          processed = processed.split(url).join(fbDataUri);",
  "          processed = processed.replace(",
  "            />\\s*img[\\s\\S]*?nologo=true['\"\\><\\s]*/g,",
  "            `<img src=\"${fbDataUri}\" style=\"max-width:90%; margin:15px auto; display:block;\" />`",
  "          );",
  "          console.log('[ImageInterceptor] \u2705 Unsplash fallback applied for:', sectionKeyword);",
  "        } else {",
  "          // Unsplash also failed \u2014 remove the broken img tag completely",
  "          processed = processed.replace(/>img[\\s\\S]*?nologo=true['\"\\>\\s]*/g, '');",
  "        }",
  "      } catch {",
  "        // All fallbacks exhausted \u2014 remove the broken img tag completely",
  "        processed = processed.replace(/>img[\\s\\S]*?nologo=true['\"\\>\\s]*/g, '');",
  "      }",
  "    }"
].join('\n');

if (src.includes(OLD)) {
  src = src.replace(OLD, NEW);
  fs.writeFileSync('src/services/aiPdfService.ts', src, 'utf8');
  console.log('SUCCESS: catch block extended with Unsplash fallback.');
} else {
  console.log('NOT FOUND. Attempting line-number based splice...');
  const lines = src.split('\n');
  // Lines 197-201 (0-indexed) are the catch block (lines 198-202 in 1-indexed)
  const insertIdx = 198; // 0-indexed: line 199 is index 198
  const catchLine = lines[197]; // "    } catch (err) {"
  console.log('Catch line at index 197:', JSON.stringify(catchLine));

  if (catchLine && catchLine.trim() === '} catch (err) {') {
    // splice lines 197-201 (inclusive), replace with new catch
    const newLines = NEW.split('\n');
    lines.splice(197, 5, ...newLines);
    fs.writeFileSync('src/services/aiPdfService.ts', lines.join('\n'), 'utf8');
    console.log('SUCCESS via splice at index 197-201.');
  } else {
    console.log('FAILED: Could not locate catch block. Manual review needed.');
    console.log('Actual line 197:', JSON.stringify(lines[197]));
  }
}

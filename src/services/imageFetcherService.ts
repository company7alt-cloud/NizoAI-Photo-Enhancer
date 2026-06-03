import puppeteer from 'puppeteer';

export async function fetchHighResImage(targetUrl: string): Promise<Buffer> {
  let browser: any = null;

  try {
    // Strategy 0: Direct image URL — fastest path
    const isDirectImage = /\.(jpg|jpeg|png|webp|gif|bmp|tiff?)(\?.*)?$/i.test(targetUrl);
    if (isDirectImage) {
      const res = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 1000) return buf;
      }
    }

    // Launch headless browser for non-direct URLs
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--window-size=1280,800',
      ],
      timeout: 60_000,
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    // Strategy 1: picsave.mom intermediary
    try {
      await page.goto('https://picsave.mom', {
        waitUntil: 'domcontentloaded', timeout: 20_000
      });
      await page.waitForSelector(
        'input[type="text"], input[type="url"], input[name="url"]',
        { timeout: 8_000 }
      );
      await page.type(
        'input[type="text"], input[type="url"], input[name="url"]',
        targetUrl, { delay: 50 }
      );
      await Promise.all([
        page.click('button[type="submit"], .download-btn, #submit, input[type="submit"]'),
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {}),
      ]);
      await page.waitForSelector(
        'a[download], .download-link, a[href*=".jpg"], a[href*=".png"], a[href*=".webp"]',
        { timeout: 12_000 }
      );
      const imageLink: string = await page.$eval(
        'a[download], .download-link, a[href*=".jpg"], a[href*=".png"], a[href*=".webp"]',
        (el: any) => el.href
      );
      if (imageLink) {
        const imgRes = await fetch(imageLink, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          if (buf.length > 1000) return buf;
        }
      }
    } catch {
      // fall through
    }

    // Strategy 2: network response intercept — navigate to URL directly
    const imageBuffers: Buffer[] = [];
    page.on('response', async (response: any) => {
      try {
        const ct = response.headers()['content-type'] || '';
        const url: string = response.url();
        if (
          ct.startsWith('image/') &&
          response.status() === 200 &&
          !url.includes('favicon') &&
          !url.includes('logo') &&
          !url.includes('icon') &&
          !url.includes('avatar')
        ) {
          const buf = await response.buffer();
          if (buf.length > 50_000) imageBuffers.push(buf);
        }
      } catch { /* skip */ }
    });

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30_000 });
    await new Promise(r => setTimeout(r, 3_000));

    if (imageBuffers.length > 0) {
      imageBuffers.sort((a, b) => b.length - a.length);
      return imageBuffers[0];
    }

    // Strategy 3: meta og:image or largest <img>
    // @ts-ignore — page.evaluate() runs inside the browser; document & HTMLMetaElement are valid there
    const ogUrl: string | null = await page.evaluate(() => {
      // @ts-ignore
      const og = document.querySelector('meta[property="og:image"]') as HTMLMetaElement | null;
      if (og?.content) return og.content;
      // @ts-ignore
      const imgs = Array.from(document.querySelectorAll('img'))
        .filter((img: any) => img.naturalWidth > 300 && img.naturalHeight > 300)
        .sort((a: any, b: any) =>
          b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight
        );
      return (imgs[0] as any)?.src || null;
    });

    if (ogUrl) {
      const ogRes = await fetch(ogUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (ogRes.ok) {
        const buf = Buffer.from(await ogRes.arrayBuffer());
        if (buf.length > 1000) return buf;
      }
    }

    throw new Error('no_image_found');

  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

/// <reference lib="dom" />
import puppeteer, {
  Browser,
  Page,
  HTTPResponse,
  HTTPRequest,
} from 'puppeteer';

interface VipEntry       { match: string; proxies: string[]; timeout: number; }
interface ImageCandidate { type: string;  url: string; }
interface EngineState    { layer: string; success: boolean; }

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const MIN_SIZE       = 40_000;
const RETRY_MAX      = 2;
const NOISE_KEYWORDS = [
  'favicon','logo','icon','badge',
  'avatar','sprite','pixel','tracking','analytics',
];

// Multiple proxies per VIP site — fallback chain
const VIP_MAP: VipEntry[] = [
  {
    match: 'magnific.com',
    proxies: [
      'https://downloader.la/freepik-downloader.html',
      'https://freepikdownloader.com/',
      'https://www.freepikdownload.com/'
    ],
    timeout: 45_000,
  },
  {
    match: 'freepik.com',
    proxies: [
      'https://downloader.la/freepik-downloader.html',
      'https://freepikdownloader.com/',
      'https://www.freepikdownload.com/',
    ],
    timeout: 45_000,
  },
  {
    match: 'stock.adobe.com',
    proxies: [
      'https://stockbeaver.com/',
      'https://www.adobe-stock-downloader.com/',
      'https://downloader.la/adobe-stock-downloader.html',
    ],
    timeout: 45_000,
  },
  {
    match: 'adobe.com',
    proxies: [
      'https://stockbeaver.com/',
      'https://downloader.la/adobe-stock-downloader.html',
    ],
    timeout: 45_000,
  },
  {
    match: 'istockphoto.com',
    proxies: [
      'https://www.istockdownloader.com/',
      'https://downloader.la/istockphoto-downloader.html',
      'https://istock.downloader.la/',
    ],
    timeout: 45_000,
  },
  {
    match: 'shutterstock.com',
    proxies: [
      'https://www.shutterdownloader.com/',
      'https://downloader.la/shutterstock-downloader.html',
    ],
    timeout: 45_000,
  },
  {
    match: 'gettyimages.com',
    proxies: ['https://downloader.la/gettyimages-downloader.html'],
    timeout: 45_000,
  },
  {
    match: 'gettyimages.',
    proxies: ['https://downloader.la/gettyimages-downloader.html'],
    timeout: 45_000,
  },
  {
    match: 'alamy.com',
    proxies: ['https://downloader.la/alamy-downloader.html'],
    timeout: 40_000,
  },
  {
    match: 'depositphotos.com',
    proxies: ['https://downloader.la/depositphotos-downloader.html'],
    timeout: 40_000,
  },
  {
    match: 'dreamstime.com',
    proxies: ['https://downloader.la/dreamstime-downloader.html'],
    timeout: 40_000,
  },
  {
    match: '123rf.com',
    proxies: ['https://downloader.la/123rf-downloader.html'],
    timeout: 40_000,
  },
  {
    match: 'vectorstock.com',
    proxies: ['https://downloader.la/vectorstock-downloader.html'],
    timeout: 40_000,
  },
  {
    match: 'pond5.com',
    proxies: ['https://downloader.la/pond5-downloader.html'],
    timeout: 40_000,
  },
];

// ══════════════════════════════════════════════
// CDN SMART RESOLVER
// ══════════════════════════════════════════════
export function resolveCdnToPageUrl(raw: string): string {
  const url = raw.trim();
  if (url.includes('ftcdn.net')) {
    const p1 = url.match(/1000_F_(\d{6,12})_/i);
    if (p1?.[1]) return `https://stock.adobe.com/images/x/${p1[1]}`;
    const p2 = url.match(/\/(\d{6,12})_[A-Za-z0-9]{4,}\.jpg/i);
    if (p2?.[1]) return `https://stock.adobe.com/images/x/${p2[1]}`;
  }
  if (url.includes('media.istockphoto.com')) {
    const m = url.match(/gm(\d{6,12})\//i);
    if (m?.[1]) return `https://www.istockphoto.com/photo/x-gm${m[1]}`;
  }
  if (url.includes('shutterstock.com/image') || url.includes('image.shutterstock.com')) {
    const m = url.match(/(\d{6,12})\.(jpg|jpeg|png)/i);
    if (m?.[1]) return `https://www.shutterstock.com/image-photo/x-${m[1]}`;
  }
  if (url.includes('freepik.com') || url.includes('magnific.com'))
    return url.split('?')[0];
  return url;
}

// ══════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════
async function withRetry<T>(
  fn: () => Promise<T | null>,
  attempts: number,
  label: string,
): Promise<T | null> {
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await fn();
      if (r !== null && r !== undefined) return r;
    } catch (err) {
      console.warn(`[${label}] attempt ${i}/${attempts}:`, (err as Error).message);
      if (i < attempts) await new Promise(r => setTimeout(r, 2_500 * i));
    }
  }
  return null;
}

async function safeFetch(url: string, minSize = 1_000): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8' },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length >= minSize ? buf : null;
  } catch { return null; }
}

async function fillInput(page: Page, selector: string, value: string): Promise<boolean> {
  return page.evaluate(
    (sel: string, val: string): boolean => {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      if (!el) return false;
      el.focus(); el.value = ''; el.value = val;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    selector,
    value,
  );
}

async function huntButton(page: Page): Promise<boolean> {
  const candidates: string[] = [
    'button[type="submit"]', '#download-btn', '.btn-primary',
    '.btn-download', 'button.btn', 'input[type="submit"]',
    'button[class*="download"]', 'button[class*="submit"]',
    'a[class*="download"]', 'button:not([disabled])',
  ];

  for (const sel of candidates) {
    try {
      const element = await page.$(sel);
      if (!element) continue;

      await page.evaluate((el: Element) => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, element);
      await new Promise(r => setTimeout(r, 600 + Math.random() * 400));

      const box = await element.boundingBox();
      if (!box || box.width === 0 || box.height === 0) continue;

      const targetX = box.x + box.width  / 2 + (Math.random() * 10 - 5);
      const targetY = box.y + box.height / 2 + (Math.random() * 10 - 5);

      await page.mouse.move(targetX, targetY, { steps: 15 + Math.floor(Math.random() * 10) });
      await new Promise(r => setTimeout(r, 100 + Math.random() * 150));

      await page.mouse.down();
      await new Promise(r => setTimeout(r, 40 + Math.random() * 60));
      await page.mouse.up();

      console.log(`🎯 [PHANTOM-BTN] Stealth-clicked: ${sel}`);
      return true;
    } catch { continue; }
  }
  return false;
}

async function huntDownloadLink(page: Page): Promise<string | null> {
  const candidates: string[] = [
    'a.btn-success', 'a[download]', '.download-link',
    '#download-result a', '.result-download a', '.result a',
    '#result a', 'a[href*="download"]',
    'a[href*=".jpg"]', 'a[href*=".jpeg"]',
    'a[href*=".png"]', 'a[href*=".webp"]',
  ];
  for (const sel of candidates) {
    try {
      const href: string = await page.$eval(
        sel,
        (el: Element): string =>
          (el as HTMLAnchorElement).href || el.getAttribute('href') || '',
      );
      if (href.startsWith('http')) { console.log(`🔗 [LINK] ${sel}`); return href; }
    } catch { continue; }
  }
  return null;
}

// ══════════════════════════════════════════════
// LAYER 0 — URL NORMALIZER
// ══════════════════════════════════════════════
function normalizeUrl(raw: string): string {
  const resolved = resolveCdnToPageUrl(raw.trim());
  if (resolved !== raw.trim()) return resolved;
  try {
    const url = new URL(raw.trim());
    if (url.hostname.includes('pinterest')) {
      const m = raw.match(/\/originals\/([a-f0-9/]+\.(jpg|jpeg|png|webp))/i);
      if (m) return `https://i.pinimg.com/originals/${m[1]}`;
    }
    if (url.hostname.includes('unsplash.com')) {
      url.searchParams.delete('w'); url.searchParams.delete('h'); url.searchParams.delete('q');
      url.searchParams.set('fm', 'jpg'); url.searchParams.set('q', '100'); url.searchParams.set('fit', 'max');
      return url.toString();
    }
    if (url.hostname.includes('freepik.com'))  return raw.split('?')[0];
    if (url.hostname.includes('pixabay.com'))  return raw.replace(/_\d+\.(jpg|jpeg|png|webp)/i, '_1280.$1');
    if (url.hostname.includes('pexels.com')) {
      url.searchParams.delete('w'); url.searchParams.delete('h');
      url.searchParams.set('auto', 'compress');
      url.searchParams.set('cs', 'tinysrgb');
      url.searchParams.set('dpr', '2');
      return url.toString();
    }
    if (url.hostname.includes('flickr.com'))
      return raw.replace(/_[a-z]\.(jpg|jpeg|png)/i, '_b.$1');
    if (url.hostname.includes('wikimedia.org') || url.hostname.includes('wikipedia.org'))
      return raw.replace(/\/thumb\//, '/').replace(/\/\d+px-[^/]+$/, '');
    return raw.trim();
  } catch { return raw.trim(); }
}

// ══════════════════════════════════════════════
// LAYER 1 — DIRECT FETCH
// ══════════════════════════════════════════════
async function layerDirectFetch(targetUrl: string): Promise<Buffer | null> {
  if (!/\.(jpg|jpeg|png|webp|gif|bmp|tiff?)(\?.*)?$/i.test(targetUrl)) return null;
  if (['ftcdn.net', 'media.istockphoto.com'].some(c => targetUrl.includes(c))) return null;
  return withRetry(async () => {
    const buf = await safeFetch(targetUrl, 1_000);
    if (buf) { console.log(`✅ [L1] ${(buf.length / 1024).toFixed(1)}KB`); return buf; }
    return null;
  }, RETRY_MAX, 'L1');
}

// ══════════════════════════════════════════════
// LAYER 2 — VIP ASSET ROUTER
// ══════════════════════════════════════════════
async function layerVipRouter(targetUrl: string, page: Page): Promise<Buffer | null> {
  const entry = VIP_MAP.find(v => targetUrl.includes(v.match));
  if (!entry) return null;

  for (const proxyUrl of entry.proxies) {
    console.log(`🎯 [L2-VIP] Trying proxy: ${proxyUrl}`);
    const result = await withRetry(async () => {
      await page.setRequestInterception(false).catch(() => {});
      await page.goto(proxyUrl, { waitUntil: 'domcontentloaded', timeout: entry.timeout });

      const hasCF: boolean = await page.evaluate((): boolean =>
        document.title.toLowerCase().includes('just a moment') ||
        document.querySelector('#challenge-form') !== null ||
        document.querySelector('.cf-browser-verification') !== null,
      );
      if (hasCF) {
        console.warn('[L2-VIP] CF detected — 12s wait');
        await new Promise(r => setTimeout(r, 12_000));
      }

      await new Promise(r => setTimeout(r, 1_000 + Math.floor(Math.random() * 600)));

      const inputSel =
        'input[name="url"], input[type="url"], input[placeholder*="http"], ' +
        'input[placeholder*="link"], input[placeholder*="paste"], ' +
        'input.form-control, input[type="text"]:not([type="hidden"])';

      const inputOk: boolean = await page
        .waitForSelector(inputSel, { timeout: 15_000 })
        .then(() => true).catch(() => false);
      if (!inputOk) return null;

      const filled = await fillInput(page, inputSel, targetUrl);
      if (!filled) return null;

      await new Promise(r => setTimeout(r, 800 + Math.floor(Math.random() * 400)));

      const clicked = await huntButton(page);
      if (!clicked) return null;

      await new Promise(r => setTimeout(r, 6_000));

      await page.waitForSelector(
        'a[download], .download-link, a[href*=".jpg"], a.btn-success',
        { timeout: 35_000 },
      ).catch(() => {});

      const dlLink = await huntDownloadLink(page);
      if (!dlLink) return null;

      const buf = await safeFetch(dlLink, MIN_SIZE);
      if (buf) { console.log(`✅ [L2-VIP] ${(buf.length / 1024).toFixed(1)}KB via ${proxyUrl}`); return buf; }
      return null;
    }, 1, `L2-VIP:${proxyUrl}`);

    if (result) return result;
    await new Promise(r => setTimeout(r, 1_000));
  }

  console.warn('[L2-VIP] All proxies exhausted for this site');
  return null;
}

// ══════════════════════════════════════════════
// LAYER 3 — PICSAVE INTERMEDIARY
// ══════════════════════════════════════════════
async function layerPicsave(targetUrl: string, page: Page): Promise<Buffer | null> {
  console.log('[L3-PICSAVE] Attempting...');
  return withRetry(async () => {
    await page.setRequestInterception(false).catch(() => {});
    await page.goto('https://picsave.mom', { waitUntil: 'domcontentloaded', timeout: 24_000 });
    const inputSel =
      'input[type="url"], input[type="text"], input[name="url"], input[placeholder*="http"]';
    const inputOk: boolean = await page
      .waitForSelector(inputSel, { timeout: 10_000 })
      .then(() => true).catch(() => false);
    if (!inputOk) return null;
    const filled = await fillInput(page, inputSel, targetUrl);
    if (!filled) return null;
    await new Promise(r => setTimeout(r, 600));
    await huntButton(page);
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 24_000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2_500));
    const dlLink = await huntDownloadLink(page);
    if (!dlLink) return null;
    const buf = await safeFetch(dlLink, MIN_SIZE);
    if (buf) { console.log(`✅ [L3] ${(buf.length / 1024).toFixed(1)}KB`); return buf; }
    return null;
  }, RETRY_MAX, 'L3-PICSAVE');
}

// ══════════════════════════════════════════════
// LAYER 4 — NETWORK INTERCEPTOR
// ══════════════════════════════════════════════
async function layerNetworkIntercept(targetUrl: string, page: Page): Promise<Buffer | null> {
  console.log('[L4-NETWORK] Intercepting...');
  let largestBuf: Buffer | null = null;
  let lock = false;
  const onResponse = async (response: HTTPResponse): Promise<void> => {
    if (lock) return;
    try {
      const ct: string     = response.headers()['content-type'] ?? '';
      const resUrl: string = response.url();
      const lowerResUrl = resUrl.toLowerCase();
  const isLogoOrIcon =
    lowerResUrl.includes('logo') ||
    lowerResUrl.includes('favicon') ||
    lowerResUrl.includes('brand') ||
    lowerResUrl.includes('avatar') ||
    lowerResUrl.includes('/icon');

  if (
    ct.startsWith('image/') && !ct.includes('svg+xml') &&
    response.status() === 200 &&
    !isLogoOrIcon &&
    !NOISE_KEYWORDS.some(n => lowerResUrl.includes(n))
  ) {
        const buf: Buffer = await response.buffer();
        // Reject images smaller than 80KB for VIP sites
          if (buf.length < 80_000 && NOISE_KEYWORDS.some(n => resUrl.includes(n))) return;
          if (buf.length > MIN_SIZE && (!largestBuf || buf.length > largestBuf.length)) {
          largestBuf = buf;
          console.log(`📸 [L4] ${(buf.length / 1024).toFixed(1)}KB`);
        }
      }
    } catch { /* skip */ }
  };
  try {
    await page.setRequestInterception(true);
    page.on('request', (req: HTTPRequest): void => {
      if (['font', 'stylesheet', 'media', 'websocket'].includes(req.resourceType()))
        req.abort().catch(() => {});
      else req.continue().catch(() => {});
    });
    page.on('response', (res: HTTPResponse): void => { onResponse(res).catch(() => {}); });
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 38_000 });
    await new Promise(r => setTimeout(r, 4_500));
  } catch {
    console.warn('[L4] Timeout — checking buffer...');
  } finally {
    lock = true;
    await page.setRequestInterception(false).catch(() => {});
    page.removeAllListeners('request');
    page.removeAllListeners('response');
  }
  if (largestBuf) {
    console.log(`✅ [L4] ${((largestBuf as Buffer).length / 1024).toFixed(1)}KB`);
    return largestBuf;
  }
  return null;
}

// ══════════════════════════════════════════════
// LAYER 5 — DOM DEEP PARSER
// ══════════════════════════════════════════════
async function layerDomParser(page: Page): Promise<Buffer | null> {
  console.log('[L5-DOM] Parsing...');
  // ── MAGNIFIC (formerly Freepik) EXTRACTOR ──
  try {
    const pageUrl: string = page.url();
    const isMagnific = pageUrl.includes('freepik.com') || pageUrl.includes('magnific.com');
    if (isMagnific) {
      const html: string = await page.content();

      // Strategy 1: __NEXT_DATA__ JSON state
      const nextMatch = html.match(
        /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i
      );
      if (nextMatch) {
        try {
          const jsonStr = JSON.stringify(JSON.parse(nextMatch[1]));
          const imgMatch = jsonStr.match(
            /https:\/\/(?:img|cdn|cdni|preview)\.(?:freepik|magnific)\.com\/[^\s"\\]+\.(?:jpg|jpeg|png|webp)/i
          );
          if (imgMatch) {
            const buf = await safeFetch(imgMatch[0], MIN_SIZE);
            if (buf) {
              console.log(`✅ [L5-MAGNIFIC-JSON] ${(buf.length / 1024).toFixed(1)}KB`);
              return buf;
            }
          }
        } catch { /* continue */ }
      }

      // Strategy 2: OpenGraph with Anti-Logo Guard
      const ogMatches = [...html.matchAll(
        /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/gi
      )];
      for (const match of ogMatches) {
        const imgUrl = match[1];
        const lower = imgUrl.toLowerCase();
        if (
          imgUrl.startsWith('http') &&
          !lower.includes('logo') &&
          !lower.includes('avatar') &&
          !lower.includes('favicon') &&
          !lower.includes('brand') &&
          !lower.includes('icon')
        ) {
          const buf = await safeFetch(imgUrl, MIN_SIZE);
          if (buf) {
            console.log(`✅ [L5-MAGNIFIC-OG] ${(buf.length / 1024).toFixed(1)}KB`);
            return buf;
          }
        }
      }

      // Strategy 3: data-cy attribute
      const dataCy = html.match(
        /data-cy="image-detail-img"[^>]*src="([^"]+)"/i
      );
      if (dataCy) {
        const buf = await safeFetch(dataCy[1], MIN_SIZE);
        if (buf) {
          console.log(`✅ [L5-MAGNIFIC-DATACY] ${(buf.length / 1024).toFixed(1)}KB`);
          return buf;
        }
      }
    }
  } catch (e) {
    console.warn('[L5-MAGNIFIC]', (e as Error).message);
  }
  // ── END MAGNIFIC EXTRACTOR ──
  try {
    const candidates: ImageCandidate[] = await page.evaluate((): ImageCandidate[] => {
      const results: ImageCandidate[] = [];
      const push = (type: string, url: string): void => {
        if (url?.startsWith('http') && !results.find(r => r.url === url))
          results.push({ type, url });
      };
      const og = document.querySelector('meta[property="og:image"]') as HTMLMetaElement | null;
      if (og?.content) push('og:image', og.content);
      const tw = document.querySelector('meta[name="twitter:image"]') as HTMLMetaElement | null;
      if (tw?.content) push('twitter:image', tw.content);
      const ip = document.querySelector('meta[itemprop="image"]') as HTMLMetaElement | null;
      if (ip?.content) push('itemprop', ip.content);
      document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
        try {
          const d = JSON.parse(s.textContent ?? '') as Record<string, unknown>;
          const img = d['image'];
          if (typeof img === 'string') push('json-ld', img);
          else if (Array.isArray(img) && typeof img[0] === 'string')
            push('json-ld', img[0] as string);
        } catch { /* skip */ }
      });
      Array.from(document.querySelectorAll('img'))
        .filter(img =>
          (img.naturalWidth || img.width || 0) > 300 &&
          (img.naturalHeight || img.height || 0) > 300 &&
          img.src.startsWith('http'),
        )
        .sort((a, b) =>
          (b.naturalWidth || b.width) * (b.naturalHeight || b.height) -
          (a.naturalWidth || a.width) * (a.naturalHeight || a.height),
        )
        .slice(0, 5)
        .forEach(img => push('img-tag', img.src));
      return results;
    });
    for (const c of candidates) {
      const buf = await safeFetch(c.url, MIN_SIZE);
      if (buf) {
        console.log(`✅ [L5] ${(buf.length / 1024).toFixed(1)}KB via ${c.type}`);
        return buf;
      }
    }
  } catch (e) { console.warn('[L5]', (e as Error).message); }
  return null;
}

// ══════════════════════════════════════════════
// LAYER 6 — SCREENSHOT FALLBACK
// ══════════════════════════════════════════════
async function layerScreenshot(page: Page): Promise<Buffer | null> {
  console.log('[L6-SCREENSHOT] Last resort...');
  try {
    const isBlocked: boolean = await page.evaluate((): boolean => {
      const t = (document.body?.innerText ?? '').toLowerCase();
      return (
        t.includes('access is temporarily restricted') ||
        t.includes('just a moment') ||
        t.includes('enable javascript') ||
        t.includes('403 forbidden') ||
        t.includes('unusual activity') ||
        t.includes('automated')
      );
    });
    if (isBlocked) { console.warn('[L6] Blocked — skip'); return null; }
    const shot = await page.screenshot({ type: 'jpeg', quality: 92, fullPage: false });
    const buf  = Buffer.from(shot);
    if (buf.length > MIN_SIZE) {
      console.log(`✅ [L6] ${(buf.length / 1024).toFixed(1)}KB`);
      return buf;
    }
  } catch (e) { console.warn('[L6]', (e as Error).message); }
  return null;
}

// ══════════════════════════════════════════════
// MAIN EXPORT — fetchHighResImage v10.0 FINAL
// ══════════════════════════════════════════════
export async function fetchHighResImage(rawUrl: string): Promise<Buffer> {
  const targetUrl = normalizeUrl(rawUrl);
  let   browser:  Browser | null = null;
  const state:    EngineState    = { layer: 'init', success: false };

  console.log(`\n🚀 [FETCHER-v10] ▶ ${targetUrl}`);
  
  // ── FIREWALL: Prevent VPS Ban ──
  const isVipUrl = VIP_MAP.some(v => targetUrl.includes(v.match));

  try {
    state.layer = 'L1';
    let result  = await layerDirectFetch(targetUrl);
    if (result) { state.success = true; return result; }

    const viewportWidth  = 1900 + Math.floor(Math.random() * 21);
    const viewportHeight = 1040 + Math.floor(Math.random() * 41);

    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        `--window-size=${viewportWidth},${viewportHeight}`,
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: viewportWidth, height: viewportHeight });

    // ╔═══════════════════════════════════════════════════════╗
    // ║   👻 PHANTOM STEALTH INIT — MUST RUN BEFORE goto()   ║
    // ║   Applied globally before ANY navigation attempt      ║
    // ╚═══════════════════════════════════════════════════════╝

    // STEP A: Identity Mask — Real Chrome on Windows
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    // STEP B: HTTP Headers — Identical to real Chrome browser
    await page.setExtraHTTPHeaders({
      'Accept-Language':           'en-US,en;q=0.9,ar;q=0.8',
      'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Sec-Fetch-Dest':            'document',
      'Sec-Fetch-Mode':            'navigate',
      'Sec-Fetch-Site':            'none',
      'Sec-Fetch-User':            '?1',
      'Upgrade-Insecure-Requests': '1',
      'Referer':                   'https://www.google.com/',
      'Cache-Control':             'max-age=0',
      'sec-ch-ua':                 '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile':          '?0',
      'sec-ch-ua-platform':        '"Windows"',
    });

    // STEP C: JavaScript-level fingerprint erasure
    await page.evaluateOnNewDocument((): void => {
      // C1: Kill automation flag
      Object.defineProperty(navigator, 'webdriver', { get: (): undefined => undefined });

      // C2: Realistic plugin list
      Object.defineProperty(navigator, 'plugins', {
        get: (): Plugin[] => {
          const arr = [
            { name: 'Chrome PDF Plugin',  filename: 'internal-pdf-viewer'             },
            { name: 'Chrome PDF Viewer',  filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
            { name: 'Native Client',      filename: 'internal-nacl-plugin'             },
          ] as unknown as Plugin[];
          Object.setPrototypeOf(arr, PluginArray.prototype);
          return arr;
        },
      });

      // C3: Realistic system properties
      Object.defineProperty(navigator, 'languages',           { get: () => ['en-US', 'en', 'ar'] });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      Object.defineProperty(navigator, 'deviceMemory',        { get: () => 8 });
      Object.defineProperty(navigator, 'platform',            { get: () => 'Win32' });
      Object.defineProperty(navigator, 'vendor',              { get: () => 'Google Inc.' });

      // C4: Screen resolution — matches our viewport
      Object.defineProperty(screen, 'width',       { get: () => 1920 });
      Object.defineProperty(screen, 'height',      { get: () => 1080 });
      Object.defineProperty(screen, 'availWidth',  { get: () => 1920 });
      Object.defineProperty(screen, 'availHeight', { get: () => 1040 });
      Object.defineProperty(screen, 'colorDepth',  { get: () => 24 });
      Object.defineProperty(screen, 'pixelDepth',  { get: () => 24 });

      // C5: Canvas noise injection — defeats fingerprinting
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(type?: string, quality?: unknown): string {
        const ctx2d = this.getContext('2d');
        if (ctx2d) {
          const imageData = ctx2d.getImageData(0, 0, this.width, this.height);
          for (let i = 0; i < 8; i++) {
            imageData.data[Math.floor(Math.random() * imageData.data.length)] ^= 1;
          }
          ctx2d.putImageData(imageData, 0, 0);
        }
        return origToDataURL.call(this, type, quality as number | undefined);
      };

      // C6: WebGL vendor spoof
      const getParam = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter: number): unknown {
        if (parameter === 37445) return 'Intel Inc.';
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return getParam.call(this, parameter);
      };

      // C7: Chrome runtime object — proves we are "real Chrome"
      (window as any)['chrome'] = {
        runtime: { connect: () => {}, sendMessage: () => {} },
        loadTimes: () => ({}),
        csi: () => ({}),
      };

      // C8: Permissions API — normal browser behavior
      const origQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
      (window.navigator.permissions as any)['query'] =
        (parameters: PermissionDescriptor): Promise<PermissionStatus> =>
          parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
            : origQuery(parameters);
    });

    // ╔═══════════════════════════════════════════════════════╗
    // ║   🎯 FREEPIK / MAGNIFIC — GHOST DIRECT EXTRACTION    ║
    // ║   Runs AFTER full stealth init — zero detection risk  ║
    // ╚═══════════════════════════════════════════════════════╝
    if (targetUrl.includes('freepik.com') || targetUrl.includes('magnific.com')) {
      try {
        console.log('[GHOST v3.0] Initiating Googlebot Cloak extraction...');
        
        // Step 1: Deep Googlebot Identity Spoofing
        await page.setUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
        await page.setExtraHTTPHeaders({
          'X-Forwarded-For': '66.249.66.1', // Google IP
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        });

        // Step 2: Disable JS to skip CF challenges, fetch raw HTML
        await page.setJavaScriptEnabled(false);
        const rawResponse = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        const htmlContent = await rawResponse?.text() || '';
        await page.setJavaScriptEnabled(true);

        let imgUrl: string | null = null;

        // Step 3: Extract from OpenGraph (Premium Vectors expose high-res preview here)
        const ogMatch = htmlContent.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        if (ogMatch && ogMatch[1].startsWith('http')) {
          imgUrl = ogMatch[1];
        }

        // Step 4: Extract from JSON-LD fallback
        if (!imgUrl) {
          const jsonLdMatches = htmlContent.match(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi);
          if (jsonLdMatches) {
            for (const match of jsonLdMatches) {
              try {
                const data: any = JSON.parse(match.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, ''));
                if (data.image) {
                  imgUrl = typeof data.image === 'string' ? data.image : (Array.isArray(data.image) ? data.image[0] : null);
                  if (imgUrl) break;
                }
              } catch (e) { /* skip */ }
            }
          }
        }

        if (imgUrl && imgUrl.startsWith('http')) {
          console.log(`[GHOST v3.0] Target acquired via Googlebot: ${imgUrl.substring(0, 80)}...`);
          
          // Step 5: Fetch image binary bypassing CF
          const imgResponse = await page.goto(imgUrl, { waitUntil: 'networkidle0', timeout: 30000 });
          if (imgResponse) {
            const buf = await imgResponse.buffer();
            if (buf.length > 20_000 && !buf.toString('utf8', 0, 10).toLowerCase().includes('<html')) {
              console.log(`✅ [GHOST v3.0] Extraction success: ${(buf.length / 1024).toFixed(1)}KB`);
              state.success = true;
              return buf;
            }
          }
        }
        console.warn('[GHOST v3.0] Googlebot cloak failed, falling back to VIP proxy...');
      } catch (e) {
        console.error('[GHOST v3.0] Bypass error:', (e as Error).message);
      }
    }
    // ══════════════════════════════════════════════════════════

    state.layer = 'L2'; result = await layerVipRouter(targetUrl, page); if (result) { state.success = true; return result; }
    state.layer = 'L3'; result = await layerPicsave(targetUrl, page);   if (result) { state.success = true; return result; }

    // ── FIREWALL ENFORCEMENT ──
    if (isVipUrl) {
      console.warn('🛑 [FIREWALL] VIP targets exhausted. Aborting to protect VPS IP from bans.');
      throw new Error('VIP_PROXIES_EXHAUSTED');
    }

    state.layer = 'L4'; result = await layerNetworkIntercept(targetUrl, page); if (result) { state.success = true; return result; }
    state.layer = 'L5'; result = await layerDomParser(page);                   if (result) { state.success = true; return result; }
    state.layer = 'L6'; result = await layerScreenshot(page);                  if (result) { state.success = true; return result; }

    throw new Error('ALL_LAYERS_EXHAUSTED');

  } finally {
    if (!state.success) console.error(`❌ [FETCHER-v10] Failed at: ${state.layer}`);
    if (browser) { await browser.close().catch(() => {}); console.log('🔒 [BROWSER] Closed\n'); }
  }
}

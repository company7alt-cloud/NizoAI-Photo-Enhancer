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
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/122.0.0.0 Safari/537.36';

const MIN_SIZE       = 40_000;
const RETRY_MAX      = 2;
const NOISE_KEYWORDS = [
  'favicon','logo','icon','badge',
  'avatar','sprite','pixel','tracking','analytics',
];

// Multiple proxies per VIP site — fallback chain
const VIP_MAP: VipEntry[] = [
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
      const clicked: boolean = await page.evaluate((s: string): boolean => {
        const el = document.querySelector(s) as HTMLElement | null;
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        el.click();
        return true;
      }, sel);
      if (clicked) { console.log(`🎯 [BTN] ${sel}`); return true; }
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
      if (
        ct.startsWith('image/') && !ct.includes('svg+xml') &&
        response.status() === 200 &&
        !NOISE_KEYWORDS.some(n => resUrl.toLowerCase().includes(n))
      ) {
        const buf: Buffer = await response.buffer();
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

    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-gpu', '--disable-software-rasterizer', '--disable-extensions',
        '--disable-background-networking', '--disable-default-apps', '--no-first-run',
        '--js-flags=--max-old-space-size=256', '--window-size=1920,1080',
      ],
      timeout: 55_000,
    });

    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    });
    await page.evaluateOnNewDocument((): void => {
      Object.defineProperty(navigator, 'webdriver', { get: (): boolean => false, configurable: true });
      Object.defineProperty(navigator, 'plugins', {
        get: (): unknown[] => [
          { name: 'Chrome PDF Plugin' }, { name: 'Chrome PDF Viewer' }, { name: 'Native Client' },
        ], configurable: true,
      });
      Object.defineProperty(navigator, 'languages', { get: (): string[] => ['en-US', 'en', 'ar'], configurable: true });
      (window as unknown as Record<string, unknown>)['chrome'] = { runtime: {}, loadTimes: (): void => {}, csi: (): void => {}, app: {} };
      const oq = window.navigator.permissions?.query?.bind(window.navigator.permissions);
      if (oq) {
        window.navigator.permissions.query = (p: PermissionDescriptor): Promise<PermissionStatus> =>
          p.name === 'notifications' ? Promise.resolve({ state: 'denied' } as PermissionStatus) : oq(p);
      }
    });

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

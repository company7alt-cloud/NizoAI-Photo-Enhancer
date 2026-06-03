/// <reference lib="dom" />
import puppeteer, {
  Browser,
  Page,
  HTTPResponse,
  HTTPRequest,
} from 'puppeteer';

interface VipEntry { match: string; proxy: string; timeout: number; }
interface ImageCandidate { type: string; url: string; }
interface EngineState { layer: string; success: boolean; }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const MIN_SIZE = 40_000;
const RETRY_MAX = 2;
const NOISE_KEYWORDS = ['favicon','logo','icon','badge','avatar','sprite','pixel','tracking','analytics'];

const VIP_MAP: VipEntry[] = [
  { match: 'stock.adobe.com',   proxy: 'https://downloader.la/adobe-stock-downloader.html',   timeout: 38_000 },
  { match: 'adobe.com',         proxy: 'https://downloader.la/adobe-stock-downloader.html',   timeout: 38_000 },
  { match: 'istockphoto.com',   proxy: 'https://downloader.la/istockphoto-downloader.html',   timeout: 38_000 },
  { match: 'shutterstock.com',  proxy: 'https://downloader.la/shutterstock-downloader.html',  timeout: 38_000 },
  { match: 'gettyimages.com',   proxy: 'https://downloader.la/gettyimages-downloader.html',   timeout: 38_000 },
  { match: 'gettyimages.',      proxy: 'https://downloader.la/gettyimages-downloader.html',   timeout: 38_000 },
  { match: 'alamy.com',         proxy: 'https://downloader.la/alamy-downloader.html',         timeout: 32_000 },
  { match: 'depositphotos.com', proxy: 'https://downloader.la/depositphotos-downloader.html', timeout: 32_000 },
  { match: 'dreamstime.com',    proxy: 'https://downloader.la/dreamstime-downloader.html',    timeout: 32_000 },
  { match: '123rf.com',         proxy: 'https://downloader.la/123rf-downloader.html',         timeout: 32_000 },
  { match: 'vectorstock.com',   proxy: 'https://downloader.la/vectorstock-downloader.html',   timeout: 32_000 },
  { match: 'pond5.com',         proxy: 'https://downloader.la/pond5-downloader.html',         timeout: 32_000 },
];

async function withRetry<T>(fn: () => Promise<T | null>, attempts: number, label: string): Promise<T | null> {
  for (let i = 1; i <= attempts; i++) {
    try {
      const result = await fn();
      if (result !== null && result !== undefined) return result;
    } catch (err) {
      console.warn(`[${label}] attempt ${i}/${attempts}:`, (err as Error).message);
      if (i < attempts) await new Promise(r => setTimeout(r, 2_500 * i));
    }
  }
  return null;
}

async function safeFetch(url: string, minSize: number = 1_000): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8' } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length >= minSize ? buf : null;
  } catch { return null; }
}

async function safeClick(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel: string): boolean => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    el.click();
    return true;
  }, selector);
}

async function fillInput(page: Page, selector: string, value: string): Promise<boolean> {
  return page.evaluate((sel: string, val: string): boolean => {
    const el = document.querySelector(sel) as HTMLInputElement | null;
    if (!el) return false;
    el.focus(); el.value = ''; el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, selector, value);
}

function normalizeUrl(raw: string): string {
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
    if (url.hostname.includes('freepik.com')) return raw.split('?')[0];
    if (url.hostname.includes('pixabay.com')) return raw.replace(/_\d+\.(jpg|jpeg|png|webp)/i, '_1280.$1');
    if (url.hostname.includes('pexels.com')) {
      url.searchParams.delete('w'); url.searchParams.delete('h');
      url.searchParams.set('auto', 'compress'); url.searchParams.set('cs', 'tinysrgb'); url.searchParams.set('dpr', '2');
      return url.toString();
    }
    if (url.hostname.includes('flickr.com')) return raw.replace(/_[a-z]\.(jpg|jpeg|png)/i, '_b.$1');
    if (url.hostname.includes('wikimedia.org') || url.hostname.includes('wikipedia.org'))
      return raw.replace(/\/thumb\//, '/').replace(/\/\d+px-[^/]+$/, '');
    return raw.trim();
  } catch { return raw.trim(); }
}

async function layerDirectFetch(targetUrl: string): Promise<Buffer | null> {
  const isImageUrl = /\.(jpg|jpeg|png|webp|gif|bmp|tiff?)(\?.*)?$/i.test(targetUrl);
  if (!isImageUrl) return null;
  return withRetry(async () => {
    const buf = await safeFetch(targetUrl, 1_000);
    if (buf) { console.log(`✅ [L1] ${(buf.length / 1024).toFixed(1)}KB`); return buf; }
    return null;
  }, RETRY_MAX, 'L1-DIRECT');
}

async function layerVipRouter(targetUrl: string, page: Page): Promise<Buffer | null> {
  const entry = VIP_MAP.find(v => targetUrl.includes(v.match));
  if (!entry) return null;
  console.log(`🎯 [L2-VIP] → ${entry.proxy}`);
  return withRetry(async () => {
    await page.setRequestInterception(false).catch(() => {});
    await page.goto(entry.proxy, { waitUntil: 'domcontentloaded', timeout: entry.timeout });
    const hasCF: boolean = await page.evaluate((): boolean =>
      document.title.toLowerCase().includes('just a moment') ||
      document.querySelector('#challenge-form') !== null ||
      document.querySelector('.cf-browser-verification') !== null);
    if (hasCF) { console.warn('[L2-VIP] Cloudflare detected — waiting 10s...'); await new Promise(r => setTimeout(r, 10_000)); }
    await new Promise(r => setTimeout(r, 800 + Math.floor(Math.random() * 500)));
    const inputSel = 'input[name="url"], input[type="url"], input[placeholder*="http"], input[placeholder*="link"], input[placeholder*="paste"], input.form-control, input[type="text"]:not([type="hidden"])';
    const inputOk: boolean = await page.waitForSelector(inputSel, { timeout: 14_000 }).then(() => true).catch(() => false);
    if (!inputOk) return null;
    const filled = await fillInput(page, inputSel, targetUrl);
    if (!filled) return null;
    await new Promise(r => setTimeout(r, 700 + Math.floor(Math.random() * 300)));
    const btnSel = 'button[type="submit"], #download-btn, .btn-primary, .btn-download, button.btn, input[type="submit"]';
    const clicked = await safeClick(page, btnSel);
    if (!clicked) return null;
    await new Promise(r => setTimeout(r, 4_500));
    const resultSel = 'a.btn-success, a[download], .download-link, a[href*=".jpg"], a[href*=".jpeg"], a[href*=".png"], a[href*=".webp"], .result-download a, #download-result a';
    const resultOk: boolean = await page.waitForSelector(resultSel, { timeout: 33_000 }).then(() => true).catch(() => false);
    if (!resultOk) return null;
    const dlLink: string = await page.$eval(resultSel, (el: Element): string => (el as HTMLAnchorElement).href || el.getAttribute('href') || '');
    if (!dlLink.startsWith('http')) return null;
    const buf = await safeFetch(dlLink, MIN_SIZE);
    if (buf) { console.log(`✅ [L2-VIP] ${(buf.length / 1024).toFixed(1)}KB`); return buf; }
    return null;
  }, RETRY_MAX, 'L2-VIP');
}

async function layerPicsave(targetUrl: string, page: Page): Promise<Buffer | null> {
  console.log('[L3-PICSAVE] Attempting...');
  return withRetry(async () => {
    await page.setRequestInterception(false).catch(() => {});
    await page.goto('https://picsave.mom', { waitUntil: 'domcontentloaded', timeout: 24_000 });
    const inputSel = 'input[type="url"], input[type="text"], input[name="url"], input.url-input, input[placeholder*="http"]';
    const inputOk: boolean = await page.waitForSelector(inputSel, { timeout: 10_000 }).then(() => true).catch(() => false);
    if (!inputOk) return null;
    const filled = await fillInput(page, inputSel, targetUrl);
    if (!filled) return null;
    await new Promise(r => setTimeout(r, 600));
    await safeClick(page, 'button[type="submit"], .submit-btn, #submit, .btn-download, input[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 24_000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2_500));
    const resultSel = 'a[download], .download-link, a[href*=".jpg"], a[href*=".jpeg"], a[href*=".png"], a[href*=".webp"]';
    const resultOk: boolean = await page.waitForSelector(resultSel, { timeout: 15_000 }).then(() => true).catch(() => false);
    if (!resultOk) return null;
    const dlLink: string = await page.$eval(resultSel, (el: Element): string => (el as HTMLAnchorElement).href);
    const buf = await safeFetch(dlLink, MIN_SIZE);
    if (buf) { console.log(`✅ [L3-PICSAVE] ${(buf.length / 1024).toFixed(1)}KB`); return buf; }
    return null;
  }, RETRY_MAX, 'L3-PICSAVE');
}

async function layerNetworkIntercept(targetUrl: string, page: Page): Promise<Buffer | null> {
  console.log('[L4-NETWORK] Intercepting...');
  let largestBuf: Buffer | null = null;
  let lock = false;
  const onResponse = async (response: HTTPResponse): Promise<void> => {
    if (lock) return;
    try {
      const ct: string = response.headers()['content-type'] ?? '';
      const resUrl: string = response.url();
      const isImage = ct.startsWith('image/') && !ct.includes('svg+xml');
      const isOk = response.status() === 200;
      const isClean = !NOISE_KEYWORDS.some(n => resUrl.toLowerCase().includes(n));
      if (isImage && isOk && isClean) {
        const buf: Buffer = await response.buffer();
        if (buf.length > MIN_SIZE && (!largestBuf || buf.length > largestBuf.length)) {
          largestBuf = buf;
          console.log(`📸 [L4] largest: ${(buf.length / 1024).toFixed(1)}KB`);
        }
      }
    } catch { /* skip */ }
  };
  try {
    await page.setRequestInterception(true);
    page.on('request', (req: HTTPRequest): void => {
      const t = req.resourceType();
      if (['font', 'stylesheet', 'media', 'websocket'].includes(t)) { req.abort().catch(() => {}); }
      else { req.continue().catch(() => {}); }
    });
    page.on('response', (res: HTTPResponse): void => { onResponse(res).catch(() => {}); });
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 38_000 });
    await new Promise(r => setTimeout(r, 4_500));
  } catch { console.warn('[L4-NETWORK] Timeout — checking buffer...'); }
  finally {
    lock = true;
    await page.setRequestInterception(false).catch(() => {});
    page.removeAllListeners('request');
    page.removeAllListeners('response');
  }
  if (largestBuf) { console.log(`✅ [L4-NETWORK] ${((largestBuf as Buffer).length / 1024).toFixed(1)}KB`); return largestBuf; }
  return null;
}

async function layerDomParser(page: Page): Promise<Buffer | null> {
  console.log('[L5-DOM] Parsing...');
  try {
    const candidates: ImageCandidate[] = await page.evaluate((): ImageCandidate[] => {
      const results: ImageCandidate[] = [];
      const push = (type: string, url: string): void => {
        if (url?.startsWith('http') && !results.find(r => r.url === url)) results.push({ type, url });
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
          else if (Array.isArray(img) && typeof img[0] === 'string') push('json-ld', img[0] as string);
        } catch { /* skip */ }
      });
      Array.from(document.querySelectorAll('img'))
        .filter((img): boolean => { const w = img.naturalWidth || img.width || 0; const h = img.naturalHeight || img.height || 0; return w > 300 && h > 300 && img.src.startsWith('http'); })
        .sort((a, b): number => (b.naturalWidth || b.width) * (b.naturalHeight || b.height) - (a.naturalWidth || a.width) * (a.naturalHeight || a.height))
        .slice(0, 5).forEach(img => push('img-tag', img.src));
      return results;
    });
    for (const c of candidates) {
      const buf = await safeFetch(c.url, MIN_SIZE);
      if (buf) { console.log(`✅ [L5-DOM] ${(buf.length / 1024).toFixed(1)}KB via ${c.type}`); return buf; }
    }
  } catch (e) { console.warn('[L5-DOM]', (e as Error).message); }
  return null;
}

async function layerScreenshot(page: Page): Promise<Buffer | null> {
  console.log('[L6-SCREENSHOT] Last resort...');
  try {
    const shot = await page.screenshot({ type: 'jpeg', quality: 92, fullPage: false });
    const buf = Buffer.from(shot);
    if (buf.length > MIN_SIZE) { console.log(`✅ [L6-SCREENSHOT] ${(buf.length / 1024).toFixed(1)}KB`); return buf; }
  } catch (e) { console.warn('[L6-SCREENSHOT]', (e as Error).message); }
  return null;
}

export async function fetchHighResImage(rawUrl: string): Promise<Buffer> {
  const targetUrl = normalizeUrl(rawUrl);
  let browser: Browser | null = null;
  const state: EngineState = { layer: 'init', success: false };
  console.log(`\n🚀 [FETCHER-v6] ▶ ${targetUrl}`);
  try {
    state.layer = 'L1';
    let result = await layerDirectFetch(targetUrl);
    if (result) { state.success = true; return result; }

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-software-rasterizer','--disable-extensions','--disable-background-networking','--disable-default-apps','--no-first-run','--js-flags=--max-old-space-size=256','--window-size=1920,1080'],
      timeout: 55_000,
    });
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8', 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' });
    await page.evaluateOnNewDocument((): void => {
      Object.defineProperty(navigator, 'webdriver', { get: (): boolean => false });
      Object.defineProperty(navigator, 'plugins', { get: (): number[] => [1, 2, 3] });
      Object.defineProperty(navigator, 'languages', { get: (): string[] => ['en-US', 'en'] });
    });

    state.layer = 'L2'; result = await layerVipRouter(targetUrl, page); if (result) { state.success = true; return result; }
    state.layer = 'L3'; result = await layerPicsave(targetUrl, page);   if (result) { state.success = true; return result; }
    state.layer = 'L4'; result = await layerNetworkIntercept(targetUrl, page); if (result) { state.success = true; return result; }
    state.layer = 'L5'; result = await layerDomParser(page);            if (result) { state.success = true; return result; }
    state.layer = 'L6'; result = await layerScreenshot(page);           if (result) { state.success = true; return result; }

    throw new Error('ALL_LAYERS_EXHAUSTED');
  } finally {
    if (!state.success) console.error(`❌ [FETCHER-v6] Failed at: ${state.layer}`);
    if (browser) { await browser.close().catch(() => {}); console.log('🔒 [BROWSER] Closed\n'); }
  }
}

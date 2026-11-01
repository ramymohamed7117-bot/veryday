/* ============================================================
   sw.js — Service Worker لتطبيق «يوميات العملاء»
   الهدف: العمل بدون إنترنت + قابلية التثبيت كتطبيق حقيقي.

   ملاحظات مهمة:
   - لا يلمس بيانات التطبيق إطلاقًا: العملاء والزيارات والمرفقات
     محفوظة في IndexedDB على جهاز المستخدم، والـ SW يتعامل مع ملفات
     الواجهة فقط. فلا خطر على البيانات المحفوظة سابقًا.
   - يعمل فقط عبر HTTPS أو localhost (لا يعمل من file://).
   - كل المسارات نسبية ليعمل تحت مجلد فرعي على GitHub Pages مثل /repo/.
   ============================================================ */

const VERSION = 'v1.0.0';
const CACHE = 'clients-diary-' + VERSION;

/* قائمة الملفات المطلوب تخزينها مسبقًا (كلها نسبية) */
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

/* ---------- التثبيت: تخزين ملفات الواجهة ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // كل ملف على حدة حتى لا يفشل التثبيت كله بسبب ملف واحد مفقود
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (err) {
        console.warn('[SW] تعذّر تخزين:', url, err);
      }
    }));
    await self.skipWaiting();
  })());
});

/* ---------- التنشيط: حذف النسخ القديمة والسيطرة على الصفحات ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* ---------- أدوات مساعدة ---------- */
function isSameOrigin(url) {
  try { return new URL(url).origin === self.location.origin; } catch (e) { return false; }
}
function isFontCDN(url) {
  return /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url);
}
function wantsHTML(request) {
  if (request.mode === 'navigate') return true;
  if (request.destination === 'document') return true;
  const accept = request.headers.get('accept') || '';
  return accept.indexOf('text/html') !== -1;
}

/* ---------- الاعتراض ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // نتجاهل أي طلب غير GET (نشر بيانات مثلًا) تمامًا
  if (req.method !== 'GET') return;

  // نتعامل مع ملفاتنا فقط + خطوط جوجل، ونترك البقية للمتصفح
  // (مثل روابط فتح خرائط جوجل الخارجية)
  if (!isSameOrigin(req.url) && !isFontCDN(req.url)) return;

  // أ) صفحات HTML: الشبكة أولًا حتى تصل التحديثات، والكاش بديل عند انقطاع النت
  if (wantsHTML(req)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        if (fresh && fresh.ok) {
          cache.put('./index.html', fresh.clone());
        }
        return fresh;
      } catch (err) {
        const cache = await caches.open(CACHE);
        return (await cache.match(req))
            || (await cache.match('./index.html'))
            || (await cache.match('./'))
            || new Response('<h1>لا يوجد اتصال</h1>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // ب) الأصول الثابتة (أيقونات، manifest، خطوط): الكاش أولًا مع تحديث صامت في الخلفية
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);

    const network = fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(() => null);

    if (hit) return hit;

    const net = await network;
    if (net) return net;

    return new Response('', { status: 504, statusText: 'Offline' });
  })());
});

/* ---------- رسائل من الصفحة (لتحديث فوري عند الطلب) ---------- */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'skip-waiting' || (data && data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
  if (data && data.type === 'CACHE_VERSION') {
    event.source && event.source.postMessage({ type: 'CACHE_VERSION', version: VERSION, cache: CACHE });
  }
});

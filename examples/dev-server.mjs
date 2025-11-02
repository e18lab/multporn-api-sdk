import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import compression from 'compression';
import swaggerUi from 'swagger-ui-express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import * as cheerio from 'cheerio';

const pipe = promisify(pipeline);

const ORIGIN = process.env.BASE_URL || 'https://multporn.net';
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 5173);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(compression());
app.use(morgan('dev'));
app.use(express.static(__dirname));

async function tryImport(rel) {
  try {
    const mod = await import(rel);
    return { mod, used: rel };
  } catch {
    return null;
  }
}
function pickClientCtor(ns) {
  return (
    ns?.MultpornClient ||
    (ns?.default &&
      (ns.default.MultpornClient || (typeof ns.default === 'function' ? ns.default : null))) ||
    null
  );
}
let sdkClient = null;
{
  const tries = ['../dist/index.js', '../dist/index.mjs', '../dist/index.cjs'];
  for (const rel of tries) {
    const loaded = await tryImport(rel);
    if (!loaded) continue;
    const Ctor = pickClientCtor(loaded.mod);
    if (Ctor) {
      sdkClient = new Ctor({ baseURL: ORIGIN });
      console.log('[dev-server] SDK loaded from', rel);
      break;
    }
  }
  if (!sdkClient) console.warn('[dev-server] SDK not found. Build the SDK first.');
}

function getSelfBase(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:' + PORT);
  return proto + '://' + host;
}
function abs(u, base = ORIGIN) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) {
    const proto = new URL(base).protocol;
    return proto + u;
  }
  if (u.startsWith('/')) return base.replace(/\/+$/, '') + u;
  return base.replace(/\/+$/, '') + '/' + u.replace(/^\/+/, '');
}
function unwrapMediaUrl(u) {
  if (!u) return '';
  let v = String(u);
  for (let i = 0; i < 3; i++) {
    try {
      const maybe = new URL(v, ORIGIN);
      const inner =
        maybe.searchParams.get('url') ||
        maybe.searchParams.get('file') ||
        maybe.searchParams.get('src');
      if (inner) {
        v = inner;
        try {
          v = decodeURIComponent(v);
        } catch {}
        try {
          v = decodeURIComponent(v);
        } catch {}
        continue;
      }
    } catch {
      try {
        v = decodeURIComponent(v);
      } catch {}
    }
    break;
  }
  if (v.startsWith('//')) v = new URL(ORIGIN).protocol + v;
  return v;
}
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

function pathFromQuery({ path, url }) {
  if (path) return String(path);
  if (url) {
    try {
      return new URL(String(url)).pathname || '/';
    } catch {
      return String(url);
    }
  }
  return '/';
}
function linksFor(url) {
  return {
    viewer: '/viewer?url=' + encodeURIComponent(url),
    listByUrl: '/api/list?url=' + encodeURIComponent(url),
    raw: '/raw?url=' + encodeURIComponent(url),
  };
}
function escapeHtml(s = '') {
  return String(s).replace(
    /[&<>"]/g,
    (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m],
  );
}
function escapeAttr(s = '') {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
function proxyImg(u) {
  return u ? '/img?url=' + encodeURIComponent(abs(u)) : undefined;
}
function proxyVid(u) {
  const raw = unwrapMediaUrl(u);
  return raw ? '/vid?url=' + encodeURIComponent(abs(raw)) : undefined;
}
function withProxiedThumbs(page) {
  if (!page || !Array.isArray(page.items)) return page;
  return { ...page, items: page.items.map((i) => ({ ...i, proxiedThumb: proxyImg(i.thumb) })) };
}
function withProxiedRecs(obj) {
  if (!obj || !Array.isArray(obj.recommendations)) return obj;
  return {
    ...obj,
    recommendations: obj.recommendations.map((r) => ({ ...r, proxiedThumb: proxyImg(r.thumb) })),
  };
}

function guessSectionFromPath(pathname = '') {
  if (/^\/manga(?:\/|$)/i.test(pathname)) return 'manga';
  if (/^\/comic(?:\/|$)/i.test(pathname)) return 'comics';
  if (/^\/category_comic(?:\/|$)/i.test(pathname)) return 'category_comic';
  if (/^\/characters(?:\/|$)/i.test(pathname)) return 'characters';
  if (/^\/authors_comics(?:\/|$)/i.test(pathname)) return 'authors_comics';
  if (/^\/pipictures(?:\/|$)/i.test(pathname)) return 'pipictures';
  if (/^\/porn_gifs(?:\/|$)/i.test(pathname)) return 'porn_gifs';
  if (/^\/authors_hentai(?:\/|$)/i.test(pathname)) return 'authors_hentai';
  return 'comics';
}

function extractExposedForm(html) {
  const $ = cheerio.load(html);
  const $form = $('.view-filters form').first();
  if (!$form.length) return null;

  const action = $form.attr('action') || '/';
  const selects = [];
  $form.find('select').each((_, el) => {
    const $sel = $(el);
    const name = $sel.attr('name') || '';
    const id = $sel.attr('id') || '';
    const label =
      (id && $form.find(`label[for="${id}"]`).first().text()) ||
      $sel.closest('.views-exposed-widget').find('label').first().text() ||
      name;
    const options = [];
    $sel.find('option').each((__, opt) => {
      const $opt = $(opt);
      options.push({
        value: $opt.attr('value') || '',
        label: ($opt.text() || '').replace(/\s+/g, ' ').trim(),
        selected: !!$opt.attr('selected'),
      });
    });
    selects.push({ name, label: label.replace(/\s+/g, ' ').trim(), options });
  });

  const payload = {
    hasSorting: false,
    actionPath: action,
    sort_by: null,
    sort_order: null,
    filters: [],
  };
  for (const sel of selects) {
    if (sel.name === 'sort_by') {
      payload.hasSorting = true;
      payload.sort_by = sel;
    } else if (sel.name === 'sort_order') {
      payload.hasSorting = true;
      payload.sort_order = sel;
    } else payload.filters.push(sel);
  }
  if (!payload.sort_by && !payload.sort_order && !payload.filters.length) return null;
  return payload;
}

async function fetchSortingForListing(listingUrl, queryParams = {}) {
  const urlObj = new URL(listingUrl, ORIGIN);
  for (const [k, v] of Object.entries(queryParams)) {
    if (v === undefined || v === null || v === '') continue;
    urlObj.searchParams.set(k, String(v));
  }
  const finalUrl = urlObj.toString();
  const r = await fetch(finalUrl, { headers: { 'user-agent': 'Mozilla/5.0', referer: ORIGIN } });
  const html = await r.text();
  return extractExposedForm(html);
}
function pickSortingParams(q) {
  const out = {};
  for (const k of Object.keys(q)) {
    const v = q[k];
    if (v === undefined || v === null || v === '') continue;
    if (['path', 'url', 'page', 'letter'].includes(k)) continue;
    out[k] = String(v);
  }
  return out;
}
function buildQuery(obj) {
  const sp = new URLSearchParams();
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? '?' + s : '';
}
function mergeParams(base, extra) {
  const out = new URLSearchParams(base || '');
  Object.entries(extra || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') out.delete(k);
    else out.set(k, String(v));
  });
  return out.toString();
}

app.get('/', (req, res) => {
  res
    .type('html')
    .send(
      '<!doctype html>' +
        '<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Multporn Dev Server</title>' +
        '<style>body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#0e1117;color:#e6edf3;margin:0;padding:24px}a{color:#58a6ff}input,button{font:inherit}input{width:60ch;max-width:80vw;padding:8px;border-radius:8px;border:1px solid #2d333b;background:#161b22;color:#e6edf3}button{padding:8px 12px;border-radius:8px;border:1px solid #30363d;background:#21262d;color:#e6edf3;margin-left:8px;cursor:pointer}.row{margin-top:8px}</style>' +
        '</head><body>' +
        '<h2>Multporn API Dev Server</h2>' +
        '<p><a href="/docs">Swagger UI</a> · <a href="/health">health</a> · <a href="/ready">ready</a> · <a href="/player.html" target="_blank">player.html</a></p>' +
        '<div class="row"><form onsubmit="goViewer(event)">' +
        '<input id="u" placeholder="https://multporn.net/comics/haywire" />' +
        '<button type="submit">Preview Viewer</button>' +
        '<button type="button" onclick="resolveJSON()">Resolve JSON</button>' +
        '</form></div>' +
        '<div class="row"><form onsubmit="goHub(event)">' +
        '<input id="p" placeholder="/manga or https://multporn.net/manga" />' +
        '<button type="submit">Preview Hub</button>' +
        '</form></div>' +
        '<script>' +
        'function goViewer(e){e.preventDefault();var v=document.getElementById("u").value;if(!v)return;location.href="/viewer?url="+encodeURIComponent(v);}' +
        'function resolveJSON(){var v=document.getElementById("u").value;if(!v)return;location.href="/api/resolve?url="+encodeURIComponent(v);}' +
        'function goHub(e){e.preventDefault();var v=document.getElementById("p").value;if(!v)return;var isUrl=/^https?:\\/\\//i.test(v);var q=isUrl?("url="+encodeURIComponent(v)):("path="+encodeURIComponent(v));location.href="/hub?"+q;}' +
        '</script>' +
        '</body></html>',
    );
});

app.get(
  '/api/resolve',
  asyncRoute(async (req, res) => {
    if (!sdkClient) throw new Error('SDK not loaded');
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'missing ?url' });

    const data = await sdkClient.resolveSmart(String(url), {
      proxyImage: proxyImg,
      proxyVideo: proxyVid,
    });
    const patched =
      data?.route === 'viewer' && data?.data ? { ...data, data: withProxiedRecs(data.data) } : data;
    res.json({ ...patched, links: linksFor(String(url)) });
  }),
);

app.get(
  '/api/list',
  asyncRoute(async (req, res) => {
    if (!sdkClient) throw new Error('SDK not loaded');
    const path = pathFromQuery({ path: req.query.path, url: req.query.url });
    const page = Number(req.query.page ?? '0');
    const letter = req.query.letter ? String(req.query.letter) : undefined;

    const exposed = pickSortingParams(req.query);
    const sdkOpts = { ...(letter ? { letter } : {}), ...exposed };

    const raw =
      path === '/'
        ? await sdkClient.latest(page, sdkOpts)
        : await sdkClient.listByPath(path, page, sdkOpts);

    const data = withProxiedThumbs(raw);

    const canonicalUrl = req.query.url ? String(req.query.url) : new URL(path, ORIGIN).toString();
    const sp = new URLSearchParams(exposed);
    const listedUrl = canonicalUrl + (sp.toString() ? '?' + sp.toString() : '');

    let sorting = null;
    try {
      sorting = await fetchSortingForListing(canonicalUrl, exposed);
    } catch {}

    const first = Array.isArray(data?.items) && data.items.length ? data.items[0].url : undefined;
    const links = {
      ...linksFor(canonicalUrl),
      previewFirstItem: first ? '/viewer?url=' + encodeURIComponent(first) : undefined,
      listSelf:
        '/api/list?' +
        mergeParams(
          new URLSearchParams({
            url: canonicalUrl,
            page: String(page),
            ...(letter ? { letter } : {}),
          }).toString(),
          exposed,
        ),
    };
    res.json({ ...data, sorting, links, sourceUrl: listedUrl });
  }),
);

app.get(
  '/api/search',
  asyncRoute(async (req, res) => {
    if (!sdkClient) throw new Error('SDK not loaded');
    const q = String(req.query.q ?? '');
    const page = Number(req.query.page ?? '0');

    const raw = await sdkClient.search(q, page);
    const data = withProxiedThumbs(raw);

    const examplePreview = data.items?.[0]?.url
      ? '/viewer?url=' + encodeURIComponent(data.items[0].url)
      : undefined;
    res.json({ ...data, links: { examplePreview } });
  }),
);

app.get(
  '/api/post',
  asyncRoute(async (req, res) => {
    if (!sdkClient) throw new Error('SDK not loaded');
    const urlOrSlug = String(req.query.url ?? req.query.slug ?? '');
    if (!urlOrSlug) return res.status(400).json({ error: 'missing ?url or ?slug' });
    const data = await sdkClient.getPost(urlOrSlug);
    res.json(data);
  }),
);

app.get(
  '/api/updates',
  asyncRoute(async (req, res) => {
    if (!sdkClient) throw new Error('SDK not loaded');
    const p = Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, String(v)]));
    const data = await sdkClient.updates(p);
    res.json(data);
  }),
);

app.get(
  '/api/alphabet/letters',
  asyncRoute(async (req, res) => {
    if (!sdkClient) throw new Error('SDK not loaded');
    const section = String(req.query.section ?? 'characters');
    const data = await sdkClient.alphabetLetters(section);
    res.json(data);
  }),
);

app.get(
  '/api/alphabet/items',
  asyncRoute(async (req, res) => {
    if (!sdkClient) throw new Error('SDK not loaded');
    const section = String(req.query.section ?? 'characters');
    const letter = String(req.query.letter ?? 'a');
    const page = Number(req.query.page ?? '0');

    const raw = await sdkClient.alphabet(section, letter, page);
    const data = withProxiedThumbs(raw);
    res.json(data);
  }),
);

app.get(
  '/hub',
  asyncRoute(async (req, res) => {
    if (!sdkClient) throw new Error('SDK not loaded');

    const page = Number(req.query.page ?? '0');
    const letter = req.query.letter ? String(req.query.letter) : null;
    const incomingUrl = req.query.url ? String(req.query.url) : null;
    const path = pathFromQuery({ path: req.query.path, url: req.query.url });
    const title = 'Hub ' + (incomingUrl || path);

    const exposed = pickSortingParams(req.query);

    let data;
    let letters = [];
    let listingPathUsed = path;
    let listingCanonicalUrl = incomingUrl ? String(incomingUrl) : new URL(path, ORIGIN).toString();

    if (incomingUrl) {
      const resolved = await sdkClient.resolveSmart(incomingUrl, {
        proxyImage: proxyImg,
        proxyVideo: proxyVid,
      });
      if (resolved.route === 'viewer') {
        res.redirect('/viewer?url=' + encodeURIComponent(incomingUrl));
        return;
      }
      const listingPath =
        resolved?.data?.path ||
        (() => {
          try {
            return new URL(incomingUrl).pathname;
          } catch {
            return path;
          }
        })();
      listingPathUsed = listingPath;

      const pageData = await sdkClient.listByPath(listingPath, page, {
        ...(letter ? { letter } : {}),
        ...exposed,
      });
      data = withProxiedThumbs(pageData);

      listingCanonicalUrl = new URL(listingPath, ORIGIN).toString();
      if (pageData?.alphabet?.letters?.length) letters = pageData.alphabet.letters;
      else if (resolved?.data?.alphabet?.letters?.length) letters = resolved.data.alphabet.letters;
    } else {
      if (letter) {
        const section = guessSectionFromPath(path);
        data = await sdkClient.alphabet(section, letter, page);
      } else {
        data =
          path === '/'
            ? await sdkClient.latest(page, exposed)
            : await sdkClient.listByPath(path, page, exposed);
      }
      data = withProxiedThumbs(data);
      listingCanonicalUrl = new URL(path, ORIGIN).toString();

      if (data?.alphabet?.letters?.length) letters = data.alphabet.letters;
      else if (letter) {
        const hub0 = await sdkClient.listByPath(path, 0, exposed);
        if (hub0?.alphabet?.letters?.length) letters = hub0.alphabet.letters;
      }
    }

    let sorting = null;
    try {
      sorting = await fetchSortingForListing(listingCanonicalUrl, exposed);
    } catch {}

    function renderSelect(sel) {
      if (!sel) return '';
      const opts = (sel.options || [])
        .map(
          (o) =>
            `<option value="${escapeAttr(o.value)}"${o.selected ? ' selected' : ''}>${escapeHtml(o.label || o.value)}</option>`,
        )
        .join('');
      return `
      <label class="lbl" for="sel-${escapeAttr(sel.name)}">${escapeHtml(sel.label || sel.name)}</label>
      <select id="sel-${escapeAttr(sel.name)}" name="${escapeAttr(sel.name)}" class="form-select">${opts}</select>`;
    }

    const rawListJson =
      '/api/list?' +
      mergeParams(
        new URLSearchParams({
          url: listingCanonicalUrl,
          page: String(page),
          ...(letter ? { letter } : {}),
        }).toString(),
        exposed,
      );

    const sortBarHtml = sorting
      ? `<form class="sortbar" method="GET" action="/hub" id="sortForm">
         ${
           incomingUrl
             ? `<input type="hidden" name="url" value="${escapeAttr(incomingUrl)}"/>`
             : `<input type="hidden" name="path" value="${escapeAttr(path)}"/>`
         }
         ${letter ? `<input type="hidden" name="letter" value="${escapeAttr(letter)}"/>` : ''}
         ${renderSelect(sorting.sort_by)}
         ${renderSelect(sorting.sort_order)}
         ${Array.isArray(sorting.filters) ? sorting.filters.map(renderSelect).join('') : ''}
         <button class="btn" type="submit">Apply</button>
       </form>`
      : '';

    const itemsHtml = (Array.isArray(data?.items) ? data.items : [])
      .map((it) => {
        const img = it.proxiedThumb || proxyImg(it.thumb) || '';
        const t = it.title || '';
        const u = it.url || '';
        return (
          '<a class="card" href="/hub?url=' +
          encodeURIComponent(u) +
          '">' +
          (img ? '<img src="' + escapeAttr(String(img)) + '" alt="">' : '') +
          '<div class="t">' +
          escapeHtml(t) +
          '</div>' +
          '</a>'
        );
      })
      .join('');

    const alphaHtml = (Array.isArray(letters) ? letters : [])
      .map((l) => {
        const lab = l.label || l.value || '';
        const val = l.value || lab;
        const base = l.href
          ? '/hub?url=' + encodeURIComponent(abs(l.href, ORIGIN))
          : '/hub?path=' + encodeURIComponent(path);
        const params = { ...(l.href ? {} : { letter: val }), ...exposed };
        const href = base + buildQuery(params);
        const cls = l.active ? ' class="a active"' : ' class="a"';
        return '<a' + cls + ' href="' + escapeAttr(href) + '">' + escapeHtml(lab) + '</a>';
      })
      .join('');

    const totalPages =
      typeof data?.totalPages === 'number' && data.totalPages > 0 ? data.totalPages : 1;
    const hasPrev = page > 0;
    const hasNext = !!data?.hasNext && page + 1 < totalPages;

    const baseParams = {
      ...(incomingUrl ? { url: incomingUrl } : { path }),
      ...(letter ? { letter } : {}),
      ...exposed,
    };

    const pagerHtml =
      totalPages > 1
        ? '<div class="pager">' +
          (hasPrev
            ? '<a class="btn navlink" href="' +
              escapeAttr('/hub' + buildQuery({ ...baseParams, page: page - 1 })) +
              '">Prev</a>'
            : '') +
          '<span class="muted">Page ' +
          String(page + 1) +
          ' of ' +
          String(totalPages) +
          '</span>' +
          (hasNext
            ? '<a class="btn navlink" href="' +
              escapeAttr('/hub' + buildQuery({ ...baseParams, page: page + 1 })) +
              '">Next</a>'
            : '') +
          '</div>'
        : '';

    res
      .type('html')
      .send(
        '<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>' +
          '<title>' +
          escapeHtml(title) +
          '</title>' +
          '<style>' +
          'body{margin:0;background:#0e1117;color:#e6edf3;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Helvetica,Arial}' +
          'a{color:#58a6ff;text-decoration:none}' +
          'header{position:sticky;top:0;padding:12px 16px;background:rgba(22,27,34,.9);backdrop-filter:saturate(180%) blur(10px);border-bottom:1px solid rgba(255,255,255,.06);z-index:10;display:flex;justify-content:space-between;align-items:center}' +
          'header h1{margin:0;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
          'header .right a{margin-left:10px}' +
          '.loader{position:fixed;inset:0 0 auto 0;height:3px;background:linear-gradient(90deg,#58a6ff,#8b949e);transform:scaleX(0);transform-origin:left;transition:transform .25s ease;z-index:9999}' +
          '.load-on .loader{transform:scaleX(1)}' +
          '.wrap{max-width:1200px;margin:16px auto;padding:0 16px}' +
          '.sortbar{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin:8px 0 12px 0;padding:8px;background:#111822;border:1px solid rgba(255,255,255,.06);border-radius:10px}' +
          '.sortbar .lbl{display:block;font-size:12px;color:#8b949e;margin:0 0 4px 2px}' +
          '.sortbar .form-select{padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:#161b22;color:#e6edf3}' +
          '.alpha{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px 0}' +
          '.alpha .a{display:inline-block;padding:6px 10px;border:1px solid rgba(255,255,255,.08);border-radius:8px;background:#161b22;color:#e6edf3}' +
          '.alpha .a.active{border-color:#58a6ff}' +
          '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}' +
          '.card{display:block;background:#161b22;border:1px solid rgba(255,255,255,.08);border-radius:10px;overflow:hidden}' +
          '.card img{width:100%;height:180px;object-fit:cover;display:block}' +
          '.card .t{padding:10px;color:#e6edf3;font-size:13px}' +
          '.pager{display:flex;gap:12px;align-items:center;justify-content:center;margin:14px 0}' +
          '.btn{padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:#21262d;color:#e6edf3}' +
          '.btn.muted{background:#171b21;color:#8b949e;border-color:rgba(255,255,255,.08)}' +
          '.muted{color:#8b949e}' +
          '</style></head><body>' +
          '<div class="loader" id="loader"></div>' +
          '<header><h1>' +
          escapeHtml(title) +
          '</h1><div class="right">' +
          '<a class="btn" href="' +
          escapeAttr(rawListJson) +
          '" target="_blank">RAW JSON</a>' +
          '<a class="btn" href="/docs" target="_blank">Docs</a>' +
          '</div></header>' +
          '<div class="wrap">' +
          (sorting ? sortBarHtml : '') +
          (alphaHtml ? '<div class="alpha">' + alphaHtml + '</div>' : '') +
          (itemsHtml ? '<div class="grid" id="grid">' + itemsHtml + '</div>' : '<p>No items.</p>') +
          pagerHtml +
          '</div>' +
          '<script>' +
          'var L=document.getElementById("loader"); function show(){document.body.classList.add("load-on");} function hide(){document.body.classList.remove("load-on");}' +
          'window.addEventListener("pageshow",hide);' +
          'document.addEventListener("click",function(e){var a=e.target.closest("a.navlink, .grid a.card, header .right a.btn"); if(a){show();}});' +
          'var f=document.getElementById("sortForm"); if(f){f.addEventListener("submit",function(){show();});}' +
          '</script>' +
          '</body></html>',
      );
  }),
);

app.get(
  '/viewer',
  asyncRoute(async (req, res) => {
    if (!sdkClient) throw new Error('SDK not loaded');
    const url = String(req.query.url || '');
    if (!url) return res.status(400).send('<h3>Missing ?url</h3>');

    const resolved = await sdkClient.resolveSmart(String(url), {
      proxyImage: proxyImg,
      proxyVideo: proxyVid,
    });
    if (resolved?.route === 'listing') {
      const path = resolved?.data?.path || new URL(String(url)).pathname;
      res.redirect('/hub?path=' + encodeURIComponent(String(path)));
      return;
    }

    const viewer = resolved?.data?.viewer || {};
    const kind = viewer?.kind || 'other';
    const meta = viewer?.meta || {};
    const images = Array.isArray(viewer?.images) ? viewer.images : [];
    const video = viewer?.video || null;
    const title = meta?.title || resolved?.data?.absoluteUrl || 'Viewer';

    let playerUrl = '';
    if (kind === 'video' && video && Array.isArray(video.sources) && video.sources.length) {
      const poster = video.poster ? String(video.poster) : '';
      const sourcesParam = video.sources
        .map((s) => {
          const label = s?.label || s?.type || 'source';
          const raw = unwrapMediaUrl(s?.proxied || s?.url || '');
          const src = proxyVid(raw);
          if (!src) return '';
          return encodeURIComponent(label) + ',' + encodeURIComponent(src);
        })
        .filter(Boolean)
        .join('|');

      const qs = [
        'title=' + encodeURIComponent(title),
        poster ? 'poster=' + encodeURIComponent(proxyImg(poster)) : '',
        'sources=' + sourcesParam,
      ]
        .filter(Boolean)
        .join('&');

      playerUrl = '/player.html?' + qs;
    }

    const posters = images
      .map((im) => im?.proxied || im?.large || im?.medium || im?.original || im?.small || im?.thumb)
      .filter(Boolean);

    const recs = Array.isArray(resolved?.data?.recommendations)
      ? resolved.data.recommendations
      : [];

    const gridHtml = posters
      .map(function (u, i) {
        return (
          '<div class="thumb" data-idx="' +
          i +
          '"><img loading="lazy" src="' +
          escapeAttr(String(u)) +
          '" alt="img-' +
          i +
          '"/></div>'
        );
      })
      .join('');

    const recsHtml = recs
      .map((r) => {
        const t = r?.title || '';
        const u = r?.url || '';
        const th = r?.proxiedThumb || r?.thumb || '';
        let path = '';
        try {
          path = new URL(u).pathname;
        } catch {
          path = u;
        }
        return (
          '<div class="rec">' +
          (th ? '<img loading="lazy" src="' + escapeAttr(String(th)) + '" alt="">' : '') +
          '<div><a class="navlink" href="/viewer?url=' +
          encodeURIComponent(u) +
          '" title="' +
          escapeAttr(t) +
          '">' +
          escapeHtml(t) +
          '</a><br/>' +
          '<span class="muted" style="font-size:12px;">' +
          escapeHtml(path) +
          '</span></div></div>'
        );
      })
      .join('');

    const rawViewerJson = '/api/resolve?url=' + encodeURIComponent(url);

    res
      .type('html')
      .send(
        '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>' +
          '<title>' +
          escapeHtml(title) +
          '</title>' +
          '<style>' +
          ':root{--bg:#0e1117;--fg:#e6edf3;--muted:#8b949e;--card:#161b22;--accent:#58a6ff;--shadow:0 10px 30px rgba(0,0,0,.4)}' +
          'body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,Helvetica,Arial}' +
          'header{position:sticky;top:0;padding:12px 16px;background:rgba(22,27,34,.9);backdrop-filter:saturate(180%) blur(10px);border-bottom:1px solid rgba(255,255,255,.06);z-index:10;display:flex;justify-content:space-between;align-items:center}' +
          'header h1{margin:0;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
          'header .right a{margin-left:10px}' +
          '.loader{position:fixed;inset:0 0 auto 0;height:3px;background:linear-gradient(90deg,#58a6ff,#8b949e);transform:scaleX(0);transform-origin:left;transition:transform .25s ease;z-index:9999}' +
          '.load-on .loader{transform:scaleX(1)}' +
          '.wrap{max-width:1200px;margin:16px auto;padding:0 16px}' +
          '.card{background:var(--card);border:1px solid rgba(255,255,255,.06);border-radius:12px;box-shadow:var(--shadow);padding:12px;margin-bottom:16px}' +
          '.muted{color:var(--muted)}' +
          '.player-embed{aspect-ratio:16/9;border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden;background:#000}' +
          '.player-embed iframe{width:100%;height:100%;border:0;display:block}' +
          '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}' +
          '.thumb{position:relative;padding-top:140px;background:#0b0f15;border-radius:8px;overflow:hidden;cursor:pointer;border:1px solid rgba(255,255,255,.06)}' +
          '.thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}' +
          '.lightbox{position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;align-items:center;justify-content:center;z-index:9999}' +
          '.lightbox.open{display:flex}.lightbox img{max-width:96vw;max-height:92vh;object-fit:contain;border-radius:8px;box-shadow:var(--shadow)}' +
          '.nav{position:fixed;top:50%;transform:translateY(-50%);font-size:20px;color:#fff;background:rgba(0,0,0,.35);border-radius:10px;padding:8px 12px;cursor:pointer;user-select:none}' +
          '.nav.prev{left:16px}.nav.next{right:16px}.close{position:fixed;top:16px;right:16px;font-size:14px;color:#fff;background:rgba(0,0,0,.35);border-radius:10px;padding:6px 10px;cursor:pointer}' +
          '.counter{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);color:#fff;font-size:12px;background:rgba(0,0,0,.35);padding:6px 10px;border-radius:10px}' +
          '.recs{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}' +
          '.rec{display:flex;gap:10px;background:var(--card);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:8px;align-items:center}' +
          '.rec img{width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,.08)}' +
          '.rec a{color:var(--fg);text-decoration:none}.rec a:hover{color:var(--accent);text-decoration:underline}' +
          '</style></head><body>' +
          '<div class="loader" id="loader"></div>' +
          '<header><h1>' +
          escapeHtml(title) +
          '</h1><div class="right">' +
          '<a class="btn" href="' +
          escapeAttr(rawViewerJson) +
          '" target="_blank">RAW JSON</a>' +
          '<a class="btn" href="/docs" target="_blank">Docs</a>' +
          '</div></header>' +
          '<div class="wrap">' +
          (playerUrl
            ? '<div class="card"><div class="player-embed"><iframe allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen src="' +
              escapeAttr(playerUrl) +
              '"></iframe></div>' +
              '<div class="muted" style="margin-top:8px">Open player: <a class="navlink" href="' +
              escapeAttr(playerUrl) +
              '" target="_blank">player.html</a></div></div>'
            : '') +
          (kind === 'images' && posters.length
            ? '<div class="card"><div class="grid" id="grid">' +
              gridHtml +
              '</div></div>' +
              '<div class="lightbox" id="lightbox" aria-hidden="true">' +
              '<span class="nav prev" id="prev">Prev</span>' +
              '<img id="lbImg" alt="current"/>' +
              '<span class="nav next" id="next">Next</span>' +
              '<span class="close" id="close">Close</span>' +
              '<div class="counter" id="counter"></div>' +
              '</div>'
            : '') +
          (recs.length
            ? '<div class="card"><div class="muted" style="margin:0 0 8px 2px;">Recommendations</div><div class="recs">' +
              recsHtml +
              '</div></div>'
            : '') +
          '</div>' +
          '<script>(function(){' +
          'function show(){document.body.classList.add("load-on");} function hide(){document.body.classList.remove("load-on");}' +
          'window.addEventListener("pageshow",hide); document.addEventListener("click",function(e){var a=e.target.closest("a.navlink"); if(a){show();}});' +
          'var imgs=[];var nodes=Array.prototype.slice.call(document.querySelectorAll(".grid .thumb img"));for(var i=0;i<nodes.length;i++){imgs.push(nodes[i].getAttribute("src"));}' +
          'var grid=document.getElementById("grid");var lb=document.getElementById("lightbox");var lbImg=document.getElementById("lbImg");var prev=document.getElementById("prev");var next=document.getElementById("next");var close=document.getElementById("close");var counter=document.getElementById("counter");var idx=0;' +
          'function openAt(i){idx=i;lbImg.src=imgs[idx];counter.textContent=(idx+1)+" / "+imgs.length;lb.classList.add("open");lb.setAttribute("aria-hidden","false");}' +
          'function hideLb(){lb.classList.remove("open");lb.setAttribute("aria-hidden","true");}' +
          'function step(d){idx=(idx+d+imgs.length)%imgs.length;lbImg.src=imgs[idx];counter.textContent=(idx+1)+" / "+imgs.length;}' +
          'if(grid){grid.addEventListener("click",function(e){var t=e.target.closest(".thumb");if(!t)return;var i=Number(t.getAttribute("data-idx")||"0");openAt(i);});}' +
          'if(prev)prev.addEventListener("click",function(){step(-1);}); if(next)next.addEventListener("click",function(){step(1);}); if(close)close.addEventListener("click",hideLb); if(lb)lb.addEventListener("click",function(e){if(e.target===lb)hideLb();});' +
          'window.addEventListener("keydown",function(e){if(lb&&lb.classList.contains("open")){if(e.key==="Escape") hideLb(); else if(e.key==="ArrowLeft") step(-1); else if(e.key==="ArrowRight") step(1);}});' +
          '})();</script>' +
          '</body></html>',
      );
  }),
);

app.get(
  '/img',
  asyncRoute(async (req, res) => {
    const target = req.query.url;
    if (!target) return res.status(400).send('missing ?url');
    const finalUrl = abs(String(target));

    const r = await fetch(finalUrl, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/119 Safari/537.36',
        referer: ORIGIN,
        origin: ORIGIN,
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    if (!r.ok || !r.body) {
      res.status(r.status || 502).end('upstream error ' + r.status);
      return;
    }

    const ct = r.headers.get('content-type');
    if (ct) res.setHeader('content-type', ct);
    const cc = r.headers.get('cache-control');
    if (cc) res.setHeader('cache-control', cc);
    const cl = r.headers.get('content-length');
    if (cl) res.setHeader('content-length', cl);

    await pipe(Readable.fromWeb(r.body), res);
  }),
);

app.get(
  '/vid',
  asyncRoute(async (req, res) => {
    let target = String(req.query.url || '');
    if (!target) return res.status(400).send('missing ?url');

    target = unwrapMediaUrl(target);
    const finalUrl = abs(target);

    const headers = {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/119 Safari/537.36',
      referer: ORIGIN,
      origin: ORIGIN,
      accept: 'video/*;q=0.9,*/*;q=0.5',
    };
    if (req.headers.range) headers['range'] = req.headers.range;

    const r = await fetch(finalUrl, { headers });
    if (!r.ok) {
      res.status(r.status || 502).end('upstream error ' + r.status);
      return;
    }

    const ct = r.headers.get('content-type') || '';
    if (ct.includes('mpegurl') || ct.includes('m3u8') || ct.includes('text')) {
      let text = await r.text();
      const urlObj = new URL(finalUrl);
      const base = urlObj.origin + urlObj.pathname.replace(/[^/]+$/, '');
      text = text.replace(/^(?!#)(.+)$/gm, function (_, line) {
        if (!line.trim()) return line;
        const absLine = abs(line, base);
        return '/vid?url=' + encodeURIComponent(absLine);
      });
      res.setHeader('content-type', 'application/x-mpegURL');
      res.send(text);
    } else {
      for (const h of [
        'content-type',
        'content-length',
        'accept-ranges',
        'content-range',
        'cache-control',
      ]) {
        const v = r.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      res.status(r.status);
      if (r.body) await pipe(Readable.fromWeb(r.body), res);
      else res.end();
    }
  }),
);

app.get(
  '/raw',
  asyncRoute(async (req, res) => {
    const url = String(req.query.url || '');
    if (!url) return res.status(400).json({ error: 'missing ?url' });
    const finalUrl = abs(url);
    const r = await fetch(finalUrl, { headers: { 'user-agent': 'Mozilla/5.0', referer: ORIGIN } });
    const ct = r.headers.get('content-type') || 'text/plain';
    const body = await r.text();
    res.setHeader('content-type', ct);
    res.send(body);
  }),
);

app.get('/openapi.json', (req, res) => {
  const servers = [{ url: getSelfBase(req) }];
  const openapi = {
    openapi: '3.0.3',
    info: {
      title: 'Multporn API Dev Server',
      version: '1.11.0',
      description:
        'Dev server over SDK. Sorting/filters autodetected from Drupal Views exposed forms. Player on /viewer (iframe /player.html). /hub drills via resolveSmart; pages fetched explicitly with page & exposed params (sort_by, sort_order, type, ...). RAW buttons in header.',
    },
    servers,
    paths: {
      '/api/resolve': {
        get: {
          summary: 'Smart resolve (viewer | listing) + recommendations',
          parameters: [{ name: 'url', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/list': {
        get: {
          summary: 'List by path or by url (with sorting/filters)',
          parameters: [
            { name: 'path', in: 'query', schema: { type: 'string', example: '/munga' } },
            {
              name: 'url',
              in: 'query',
              schema: { type: 'string', example: 'https://multporn.net/munga' },
            },
            { name: 'page', in: 'query', schema: { type: 'integer', example: 0 } },
            { name: 'sort_by', in: 'query', schema: { type: 'string', example: 'created' } },
            { name: 'sort_order', in: 'query', schema: { type: 'string', example: 'DESC' } },
            { name: 'type', in: 'query', schema: { type: 'string', example: 'All' } },
            { name: 'language', in: 'query', schema: { type: 'string', example: '1' } },
            {
              name: 'field_user_discription_value',
              in: 'query',
              schema: { type: 'string', example: 'All' },
            },
            { name: 'letter', in: 'query', schema: { type: 'string', example: 'A' } },
          ],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/search': {
        get: {
          summary: 'Search',
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string', example: 'rick' } },
            { name: 'page', in: 'query', schema: { type: 'integer', example: 0 } },
          ],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/post': {
        get: {
          summary: 'Get post (node)',
          parameters: [
            { name: 'url', in: 'query', schema: { type: 'string' } },
            { name: 'slug', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/updates': {
        get: {
          summary: 'Updates (views)',
          parameters: [
            { name: 'view_name', in: 'query', schema: { type: 'string', example: 'new_mini' } },
            { name: 'page', in: 'query', schema: { type: 'integer', example: 0 } },
          ],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/alphabet/letters': {
        get: {
          summary: 'Alphabet letters',
          parameters: [
            { name: 'section', in: 'query', schema: { type: 'string', example: 'manga' } },
          ],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/alphabet/items': {
        get: {
          summary: 'Alphabet items',
          parameters: [
            { name: 'section', in: 'query', schema: { type: 'string', example: 'manga' } },
            { name: 'letter', in: 'query', schema: { type: 'string', example: 'A' } },
            { name: 'page', in: 'query', schema: { type: 'integer', example: 0 } },
          ],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/viewer': {
        get: {
          summary: 'HTML preview: player (video) or carousel (images)',
          parameters: [{ name: 'url', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'text/html' } },
        },
      },
      '/hub': {
        get: {
          summary: 'HTML hub preview with sorting/filters; pages fetched explicitly',
          parameters: [
            { name: 'path', in: 'query', schema: { type: 'string', example: '/munga' } },
            { name: 'url', in: 'query', schema: { type: 'string' } },
            { name: 'letter', in: 'query', schema: { type: 'string', example: 'A' } },
            { name: 'page', in: 'query', schema: { type: 'integer', example: 0 } },
            { name: 'sort_by', in: 'query', schema: { type: 'string' } },
            { name: 'sort_order', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'text/html' } },
        },
      },
      '/img': {
        get: {
          summary: 'Image stream proxy',
          parameters: [{ name: 'url', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Streamed image' } },
        },
      },
      '/vid': {
        get: {
          summary: 'Video stream proxy (with Range, HLS rewrite)',
          parameters: [{ name: 'url', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Streamed video' } },
        },
      },
      '/raw': {
        get: {
          summary: 'Fetch raw content (debug)',
          parameters: [{ name: 'url', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/health': { get: { summary: 'Liveness', responses: { 200: { description: 'OK' } } } },
      '/ready': { get: { summary: 'Readiness', responses: { 200: { description: 'OK' } } } },
    },
  };
  res.json(openapi);
});
app.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(undefined, { swaggerOptions: { url: '/openapi.json' } }),
);

app.use((err, req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: String(err?.message || err) });
});

app.listen(PORT, HOST, () => {
  const localInfo = 'http://localhost:' + PORT;
  console.log('dev-server:', localInfo, '| Swagger:', localInfo + '/docs');
  console.log('Listening on', HOST + ':' + PORT);
  console.log('Base:', ORIGIN, '| Stream proxies: /img, /vid');
  if (!sdkClient) console.log('HINT: build the SDK first (npm run build).');
  else console.log('SDK ready');
});

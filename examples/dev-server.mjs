import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import compression from 'compression';
import swaggerUi from 'swagger-ui-express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as cheerio from 'cheerio';
import { existsSync } from 'node:fs';

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
app.use(compression({ filter: (req) => req.path !== '/vid' }));
app.use(morgan('dev'));

app.use(express.static(join(__dirname, 'public')));
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
    viewer: '/viewer.html?url=' + encodeURIComponent(url),
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
function mergeParams(base, extra) {
  const out = new URLSearchParams(base || '');
  Object.entries(extra || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') out.delete(k);
    else out.set(k, String(v));
  });
  return out.toString();
}

app.get(
  '/api/resolve',
  asyncRoute(async (req, res) => {
    if (!sdkClient) throw new Error('SDK not loaded');
    const url = req.query.url ? String(req.query.url) : undefined;
    const path = req.query.path ? String(req.query.path) : undefined;

    if (!url && !path) return res.status(400).json({ error: 'missing ?url or ?path' });

    const absoluteUrl = url || new URL(path, ORIGIN).toString();

    const data = await sdkClient.resolveSmart(absoluteUrl, {
      proxyImage: proxyImg,
      proxyVideo: proxyVid,
    });
    const patched =
      data?.route === 'viewer' && data?.data ? { ...data, data: withProxiedRecs(data.data) } : data;
    res.json({ ...patched, links: linksFor(absoluteUrl) });
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
    const listedUrl =
      canonicalUrl +
      (Object.keys(exposed).length ? '?' + new URLSearchParams(exposed).toString() : '');

    let sorting = null;
    try {
      sorting = await fetchSortingForListing(canonicalUrl, exposed);
    } catch {}

    const first = Array.isArray(data?.items) && data.items.length ? data.items[0].url : undefined;
    const links = {
      ...linksFor(canonicalUrl),
      previewFirstItem: first ? '/viewer.html?url=' + encodeURIComponent(first) : undefined,
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

app.get('/api/search', async (req, res) => {
  if (!sdkClient) throw new Error('SDK not loaded');
  try {
    const q = String(req.query.q || req.query.query || '').trim();
    const page = Math.max(0, parseInt(String(req.query.page ?? '0'), 10) || 0);
    if (!q)
      return res.json({
        route: 'search',
        query: '',
        page: 0,
        hasNext: false,
        totalPages: 0,
        items: [],
      });

    const data = await sdkClient.search(q, page);
    return res.json({
      ...data,
      query: q,
      route: 'search',
      links: { listSelf: req.originalUrl },
    });
  } catch (e) {
    res.status(500).json({ error: 'search_failed', detail: String(e?.message || e) });
  }
});

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

app.get('/search', (req, res) => {
  const filePrimary = join(__dirname, 'search.html');
  const fileInPublic = join(__dirname, 'public', 'search.html');
  const file = existsSync(filePrimary) ? filePrimary : fileInPublic;
  res.sendFile(file);
});

app.get('/hub', (req, res) => {
  const url = req.query.url;
  if (url) {
    let path = '/';
    try {
      path = new URL(String(url)).pathname || '/';
    } catch {
      path = String(url);
    }
    return res.redirect(302, `/hub?path=${path}`);
  }
  res.sendFile(__dirname + '/index.html');
});
app.get('/viewer', (req, res) => {
  const url = req.query.url ? String(req.query.url) : undefined;
  const path = req.query.path ? String(req.query.path) : undefined;
  if (url && !path) {
    let p = '/';
    try {
      p = new URL(url).pathname || '/';
    } catch {}
    return res.redirect('/viewer?path=' + p);
  }
  return res.sendFile(__dirname + '/viewer.html');
});

app.get('/health', (_req, res) => res.type('text/plain').send('ok'));
app.get('/ready', (_req, res) => res.type('text/plain').send('ok'));

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

app.get('/vid', async (req, res) => {
  const src = req.query.url;
  if (!src) return res.status(400).send('Missing url');

  res.setHeader('Content-Encoding', 'identity');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const range = req.headers.range;
  const headers = {
    'User-Agent': req.get('user-agent') || 'Mozilla/5.0',
    Accept: '*/*',
    Referer: ORIGIN,
  };
  if (range) headers.Range = range;

  const controller = new AbortController();
  const abortUpstream = () => controller.abort();
  req.on('aborted', abortUpstream);
  res.on('close', abortUpstream);

  const MAX_RETRIES = 2;
  let attempt = 0,
    lastErr;

  while (attempt <= MAX_RETRIES) {
    try {
      const r = await fetch(src, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: controller.signal,
      });

      if (!r.ok && r.status !== 206) {
        const text = await r.text().catch(() => '');
        res.status(r.status || 502).send(text || 'Upstream error');
        return;
      }

      const ct = r.headers.get('content-type') || 'video/mp4';
      const cl = r.headers.get('content-length');
      const cr = r.headers.get('content-range');

      res.setHeader('Content-Type', ct);
      if (cr) {
        res.status(206);
        res.setHeader('Content-Range', cr);
        if (cl) res.setHeader('Content-Length', cl);
      } else {
        res.status(r.status || 200);
        if (cl) res.setHeader('Content-Length', cl);
      }

      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      const nodeReadable = Readable.fromWeb(r.body);
      await pipe(nodeReadable, res).catch((err) => {
        if (!err) return;
        const code = err.code || err.name;
        if (code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ECONNRESET') {
          return;
        }
        throw err;
      });

      return;
    } catch (e) {
      lastErr = e;
      if (controller.signal.aborted) return;
      const cause = e?.cause?.code || e?.code;
      if (cause === 'UND_ERR_CONNECT_TIMEOUT' || cause === 'ENOTFOUND') {
        attempt++;
        if (attempt <= MAX_RETRIES) continue;
      }
      break;
    }
  }

  const cause = lastErr?.cause?.code || lastErr?.code || '';
  if (cause === 'UND_ERR_CONNECT_TIMEOUT' || cause === 'ENOTFOUND') {
    res.status(502).send('Upstream not reachable');
  } else {
    res.status(500).send('Proxy error');
  }
});

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
  const servers = [{ url: getSelfBase(req), description: 'Current server' }];

  const openapi = {
    openapi: '3.0.3',
    info: {
      title: 'Multporn API Dev Server',
      version: '1.12.0',
      description:
        'Dev server over multporn-api-sdk. Sorting/filters autodetected from Drupal Views exposed forms. /hub uses resolveSmart; listing pages accept page & exposed params. Includes HTML pages for quick manual checks.',
      contact: { name: 'e18lab', url: 'https://github.com/e18lab/multporn-api-sdk' },
    },
    externalDocs: {
      description: 'SDK repository',
      url: 'https://github.com/e18lab/multporn-api-sdk',
    },
    servers,
    tags: [
      { name: 'Resolve', description: 'Маршрутизация и определение типа страницы' },
      { name: 'Listings', description: 'Списки, хабы и алфавитные выборки' },
      { name: 'Search', description: 'Поиск по сайту' },
      { name: 'Posts', description: 'Подробности поста/страницы' },
      { name: 'Updates', description: 'Витрины (Drupal Views) — ленты обновлений' },
      { name: 'Utils', description: 'Прокси для изображений/видео, RAW-фетч' },
      { name: 'HTML', description: 'Готовые HTML страницы для ручной проверки' },
    ],
    components: {
      parameters: {
        UrlParam: {
          name: 'url',
          in: 'query',
          schema: { type: 'string', format: 'uri' },
          description: 'Абсолютная ссылка на страницу multporn.net. Взаимоисключимо с "path".',
        },
        PathParam: {
          name: 'path',
          in: 'query',
          schema: { type: 'string', example: '/comics/adventure_time_porn' },
          description: 'Путь внутри multporn.net (начинается с /). Взаимоисключимо с "url".',
        },
        PageParam: {
          name: 'page',
          in: 'query',
          schema: { type: 'integer', minimum: 0, default: 0 },
          description: 'Номер страницы (0-индексация).',
        },
        LetterParam: {
          name: 'letter',
          in: 'query',
          schema: { type: 'string' },
          description: 'Алфавитная буква/группа для листингов, где это поддерживается.',
        },
        QParam: {
          name: 'q',
          in: 'query',
          schema: { type: 'string' },
          description: 'Строка поиска.',
        },
        SlugOrUrl: {
          name: 'url',
          in: 'query',
          schema: { type: 'string' },
          required: false,
          description: 'Ссылка или слаг поста. Можно также передать ?slug=...',
        },
        SlugParam: {
          name: 'slug',
          in: 'query',
          schema: { type: 'string' },
          required: false,
          description: 'Слаг поста (альтернатива ?url=...).',
        },
        MediaUrlParam: {
          name: 'url',
          in: 'query',
          required: true,
          schema: { type: 'string', format: 'uri' },
          description: 'Источник изображения/видео. Может быть вложенным (url/file/src).',
        },
      },
      schemas: {
        ListingItem: {
          type: 'object',
          required: ['title', 'url'],
          properties: {
            title: { type: 'string' },
            url: { type: 'string', format: 'uri' },
            thumb: { type: 'string', format: 'uri', nullable: true },
            proxiedThumb: { type: 'string', format: 'uri', nullable: true },
          },
          example: {
            title: 'Genshin Impact - Others',
            url: 'https://multporn.net/pictures/genshin_impact_others_album',
            thumb:
              'https://multporn.net/sites/default/files/styles/search_image/public/pic_preview/genshin_impact_-_others_21216.jpg',
            proxiedThumb: '/img?url=https%3A%2F%2Fmultporn.net%2Fsites%2Fdefault%2F...jpg',
          },
        },
        PageListingItem: {
          type: 'object',
          properties: {
            items: { type: 'array', items: { $ref: '#/components/schemas/ListingItem' } },
            page: { type: 'integer', minimum: 0 },
            hasNext: { type: 'boolean' },
            totalPages: { type: 'integer', minimum: 1 },
          },
        },
        Links: {
          type: 'object',
          properties: {
            viewer: { type: 'string', format: 'uri' },
            listByUrl: { type: 'string', format: 'uri' },
            raw: { type: 'string', format: 'uri' },
            previewFirstItem: { type: 'string', format: 'uri', nullable: true },
            listSelf: { type: 'string', format: 'uri', nullable: true },
          },
        },
        SortingOption: {
          type: 'object',
          properties: {
            value: { type: 'string' },
            label: { type: 'string' },
            selected: { type: 'boolean' },
          },
        },
        SortingSelect: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            label: { type: 'string' },
            options: { type: 'array', items: { $ref: '#/components/schemas/SortingOption' } },
          },
        },
        ExposedSorting: {
          type: 'object',
          properties: {
            hasSorting: { type: 'boolean' },
            actionPath: { type: 'string' },
            sort_by: { $ref: '#/components/schemas/SortingSelect' },
            sort_order: { $ref: '#/components/schemas/SortingSelect' },
            filters: { type: 'array', items: { $ref: '#/components/schemas/SortingSelect' } },
          },
        },
        ListResponse: {
          allOf: [
            { $ref: '#/components/schemas/PageListingItem' },
            {
              type: 'object',
              properties: {
                sorting: { $ref: '#/components/schemas/ExposedSorting' },
                links: { $ref: '#/components/schemas/Links' },
                sourceUrl: { type: 'string', format: 'uri' },
              },
            },
          ],
        },
        ResolveResponse: {
          type: 'object',
          properties: {
            route: {
              type: 'string',
              enum: ['viewer', 'redirect', 'list', 'unknown'],
            },
            data: { type: 'object', additionalProperties: true, nullable: true },
            links: { $ref: '#/components/schemas/Links' },
          },
          example: {
            route: 'viewer',
            data: {
              title: 'Genshin Impact - Others',
              recommendations: [{ title: '...', url: '...', proxiedThumb: '/img?url=...' }],
            },
            links: {
              viewer: '/viewer.html?url=...',
              listByUrl: '/api/list?url=...',
              raw: '/raw?url=...',
            },
          },
        },
        SearchResponse: {
          allOf: [
            { $ref: '#/components/schemas/PageListingItem' },
            {
              type: 'object',
              properties: {
                route: { type: 'string', example: 'search' },
                query: { type: 'string' },
                links: { type: 'object', properties: { listSelf: { type: 'string' } } },
              },
            },
          ],
        },
        Post: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string', nullable: true },
            tags: { type: 'array', items: { type: 'string' } },
            images: { type: 'array', items: { type: 'string' } },
            videos: { type: 'array', items: { type: 'string' } },
            thumb: { type: 'string', nullable: true },
            recommendations: { type: 'array', items: { $ref: '#/components/schemas/ListingItem' } },
          },
        },
        UpdatesResponse: {
          type: 'object',
          properties: {
            view_name: { type: 'string' },
            items: { type: 'array', items: { $ref: '#/components/schemas/ListingItem' } },
          },
        },
      },
    },
    paths: {
      '/api/resolve': {
        get: {
          tags: ['Resolve'],
          operationId: 'resolveSmart',
          summary: 'Smart resolve URL/path',
          parameters: [
            { $ref: '#/components/parameters/UrlParam' },
            { $ref: '#/components/parameters/PathParam' },
          ],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ResolveResponse' } },
              },
            },
            400: { description: 'missing ?url or ?path' },
          },
        },
      },
      '/api/list': {
        get: {
          tags: ['Listings'],
          operationId: 'list',
          summary: 'List items by path or URL',
          description:
            'Если path="/", вернёт витрину latest. Любые доп. query параметры проксируются как exposed-filters (sort_by, sort_order и т.д.).',
          parameters: [
            { $ref: '#/components/parameters/UrlParam' },
            { $ref: '#/components/parameters/PathParam' },
            { $ref: '#/components/parameters/PageParam' },
            { $ref: '#/components/parameters/LetterParam' },
            {
              name: 'sort_by',
              in: 'query',
              schema: { type: 'string' },
              description: 'Exposed sort_by из Drupal Views (если доступно).',
            },
            {
              name: 'sort_order',
              in: 'query',
              schema: { type: 'string', enum: ['ASC', 'DESC', 'asc', 'desc'] },
              description: 'Exposed sort_order из Drupal Views (если доступно).',
            },
          ],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ListResponse' } },
              },
            },
          },
        },
      },
      '/api/search': {
        get: {
          tags: ['Search'],
          operationId: 'search',
          summary: 'Fulltext search',
          parameters: [
            { $ref: '#/components/parameters/QParam' },
            { $ref: '#/components/parameters/PageParam' },
          ],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/SearchResponse' } },
              },
            },
          },
        },
      },
      '/api/post': {
        get: {
          tags: ['Posts'],
          operationId: 'getPost',
          summary: 'Get post by URL or slug',
          parameters: [
            { $ref: '#/components/parameters/SlugOrUrl' },
            { $ref: '#/components/parameters/SlugParam' },
          ],
          responses: {
            200: {
              description: 'OK',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Post' } } },
            },
            400: { description: 'missing ?url or ?slug' },
          },
        },
      },
      '/api/updates': {
        get: {
          tags: ['Updates'],
          operationId: 'updates',
          summary: 'Fetch updates (Views)',
          parameters: [
            {
              name: 'view_name',
              in: 'query',
              schema: {
                type: 'string',
                enum: [
                  'new_mini',
                  'user_upload_front',
                  'updated_manga',
                  'updated_manga_promoted',
                  'updated_games',
                  'random_top_comics',
                  'top_random_characters',
                ],
              },
              description: 'Имя витрины (Drupal View).',
            },
            { $ref: '#/components/parameters/PageParam' },
          ],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/UpdatesResponse' } },
              },
            },
          },
        },
      },
      '/img': {
        get: {
          tags: ['Utils'],
          operationId: 'proxyImage',
          summary: 'Image proxy',
          parameters: [{ $ref: '#/components/parameters/MediaUrlParam' }],
          responses: {
            200: {
              description: 'Streamed image',
              content: {
                'image/avif': { schema: { type: 'string', format: 'binary' } },
                'image/webp': { schema: { type: 'string', format: 'binary' } },
                'image/png': { schema: { type: 'string', format: 'binary' } },
                'image/jpeg': { schema: { type: 'string', format: 'binary' } },
                'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
              },
            },
            400: { description: 'missing ?url' },
          },
        },
      },
      '/vid': {
        get: {
          tags: ['Utils'],
          operationId: 'proxyVideo',
          summary: 'Video proxy (range supported)',
          parameters: [{ $ref: '#/components/parameters/MediaUrlParam' }],
          responses: {
            200: {
              description: 'Streamed video',
              content: {
                'video/mp4': { schema: { type: 'string', format: 'binary' } },
                '*/*': { schema: { type: 'string', format: 'binary' } },
              },
            },
            400: { description: 'Missing url' },
          },
        },
      },
      '/raw': {
        get: {
          tags: ['Utils'],
          operationId: 'raw',
          summary: 'Fetch raw upstream content',
          parameters: [{ $ref: '#/components/parameters/MediaUrlParam' }],
          responses: {
            200: {
              description: 'OK',
              content: {
                'text/html': { schema: { type: 'string' } },
                'text/plain': { schema: { type: 'string' } },
                'application/json': { schema: { type: 'string' } },
              },
            },
            400: { description: 'missing ?url' },
          },
        },
      },
      '/viewer.html': {
        get: {
          tags: ['HTML'],
          summary: 'Static viewer page',
          responses: { 200: { description: 'text/html' } },
        },
      },
      '/hub': {
        get: {
          tags: ['HTML'],
          summary: 'Hub page (HTML)',
          parameters: [
            { $ref: '#/components/parameters/UrlParam' },
            { $ref: '#/components/parameters/PathParam' },
          ],
          responses: {
            200: { description: 'text/html' },
            302: { description: 'Redirect to /hub?path=...' },
          },
        },
      },
      '/search': {
        get: {
          tags: ['HTML'],
          summary: 'Search page (HTML)',
          parameters: [
            { $ref: '#/components/parameters/QParam' },
            { $ref: '#/components/parameters/PageParam' },
          ],
          responses: { 200: { description: 'text/html' } },
        },
      },
      '/health': {
        get: { tags: ['Utils'], summary: 'Liveness', responses: { 200: { description: 'OK' } } },
      },
      '/ready': {
        get: { tags: ['Utils'], summary: 'Readiness', responses: { 200: { description: 'OK' } } },
      },
    },
  };

  res.json(openapi);
});

app.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(undefined, {
    swaggerOptions: {
      url: '/openapi.json',
      deepLinking: true,
      displayRequestDuration: true,
      docExpansion: 'none',
      defaultModelExpandDepth: 2,
      defaultModelsExpandDepth: 1,
    },
    customSiteTitle: 'Multporn Dev Server — Swagger UI',
  }),
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

import { HttpClient, HttpClientOptions } from './http';
import type {
  ListingItem,
  Page,
  Post,
  AlphabetSection,
  AlphabetLetter,
  UpdatesResult,
  ResolveOptions,
  ResolvedRoute,
  ListingQuery,
} from './types';
import type { DomApi, DomDocument, DomElement } from './dom/adapter';

export type MultpornClientOptions = Omit<HttpClientOptions, 'baseURL'> & {
  baseURL?: string;
  dom: DomApi;
};

const DEFAULT_HEADERS: Record<string, string> = {
  Referer: 'https://multporn.net',
  Origin: 'https://multporn.net',
  Accept: '*/*',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Mobile Safari/537.36',
};

function absolutize(base: string, href?: string | null): string | undefined {
  if (!href) return undefined;
  try {
    if (href.startsWith('//')) return new URL('https:' + href).href;
    return new URL(href, base).href;
  } catch {
    return undefined;
  }
}

function looksLikeListingUrl(u: string): boolean {
  return /\/(comics|manga|munga|pictures|video|gay_porn_comics|hentai_manga)\//i.test(u);
}

function shouldSkipThumb(u?: string): boolean {
  if (!u) return true;
  return /(logo|avatar|sprite|icon|favicon)/i.test(u);
}

export class MultpornClientCore {
  private http: HttpClient;
  private baseURL: string;
  private dom: DomApi;

  constructor(opts: MultpornClientOptions) {
    this.baseURL = (opts.baseURL ?? 'https://multporn.net').replace(/\/+$/, '');
    this.http = new HttpClient({
      baseURL: this.baseURL,
      headers: { ...DEFAULT_HEADERS, ...(opts.headers ?? {}) },
      timeoutMs: opts.timeoutMs ?? 15000,
      retry: opts.retry,
      userAgent: opts.userAgent,
    });
    this.dom = opts.dom;
  }

  private text(el?: DomElement | null): string {
    return this.dom.text(el);
  }
  private attr(el: DomElement | null | undefined, n: string): string {
    return this.dom.attr(el, n) ?? '';
  }
  private pickImg(el: DomElement | null | undefined): string | undefined {
    if (!el) return undefined;
    const inNode = (el as any).querySelector?.('img') ?? null;
    const imgEl = inNode || el;
    const src =
      this.attr(imgEl, 'data-src') || this.attr(imgEl, 'data-original') || this.attr(imgEl, 'src');
    return absolutize(this.baseURL, src);
  }

  private parseListing(html: string): ListingItem[] {
    const doc = this.dom.parse(html);
    const root = (doc as any).documentElement ?? doc;
    const anchors = this.dom.qsa(root, 'a[href]');
    const seen = new Set<string>();
    const out: ListingItem[] = [];

    for (const a of anchors) {
      const href = this.attr(a, 'href');
      const url = absolutize(this.baseURL, href);
      if (!url || !looksLikeListingUrl(url)) continue;
      if (seen.has(url)) continue;

      const img =
        this.pickImg(a) ||
        this.pickImg(this.dom.closest(a, 'figure')) ||
        this.pickImg(this.dom.closest(a, '.thumb')) ||
        this.pickImg((a as any).parentNode);

      const title = this.attr(a, 'title') || this.text(a);
      if (!title) continue;

      const thumb = shouldSkipThumb(img) ? undefined : img;
      out.push({ title, url, thumb });
      seen.add(url);
    }
    return out;
  }

  private parseHasNext(html: string): boolean {
    const doc = this.dom.parse(html);
    const root = (doc as any).documentElement ?? doc;

    if (this.dom.qs(root, 'a[rel="next"]')) return true;
    const pager = this.dom.qs(root, ".pager, .pagination, nav[role='navigation']");
    if (pager) {
      const next = this.dom.qs(
        pager,
        'a[rel="next"], a.next, li.next a, a[title*="След"], a[aria-label*="Next"]',
      );
      if (next) return true;
    }
    return /\bpage=\d+\b/i.test(html);
  }

  private buildListURL(path?: string, page = 0, letter?: string): string {
    if (!path) {
      const u = new URL(this.baseURL);
      if (page > 0) u.searchParams.set('page', String(page));
      return u.href;
    }
    const u = new URL(path.startsWith('/') ? path : '/' + path, this.baseURL);
    if (page > 0) u.searchParams.set('page', String(page));
    if (letter) u.searchParams.set('letter', letter);
    return u.href;
  }

  // -------- Listing
  async latest(page = 0, params?: ListingQuery): Promise<Page<ListingItem>> {
    return this.listByPath(undefined as any, page, params);
  }

  async listByPath(
    path: string | undefined,
    page = 0,
    params?: ListingQuery & { letter?: string },
  ): Promise<Page<ListingItem>> {
    const url = this.buildListURL(path, page, params?.letter);
    const html = await this.http.getHtml(url);
    const items = this.parseListing(html);
    const hasNext = this.parseHasNext(html);
    return { items, page, hasNext, totalPages: hasNext ? page + 2 : page + 1 };
  }

  // -------- Search
  async search(q: string, page = 0): Promise<Page<ListingItem>> {
    const u = new URL('/search', this.baseURL);
    u.searchParams.set('search', q);
    if (page > 0) u.searchParams.set('page', String(page));
    const html = await this.http.getHtml(u.href);
    const items = this.parseListing(html);
    const hasNext = this.parseHasNext(html);
    return { items, page, hasNext, totalPages: hasNext ? page + 2 : page + 1 };
  }

  // -------- Post
  private parsePost(html: string, url: string): Post {
    const doc = this.dom.parse(html);
    const root = (doc as any).documentElement ?? doc;

    const title =
      this.text(this.dom.qs(root, 'h1')) ||
      this.attr(this.dom.qs(root, 'meta[property="og:title"]'), 'content') ||
      'Без названия';

    const imgEls = this.dom.qsa(root, 'img');
    const imgSet = new Set<string>();
    for (const el of imgEls) {
      const src = absolutize(
        this.baseURL,
        this.attr(el, 'data-src') || this.attr(el, 'data-original') || this.attr(el, 'src'),
      );
      if (!src || /\b(logo|sprite|icon|favicon)\b/i.test(src)) continue;
      imgSet.add(src);
    }
    const images = Array.from(imgSet);

    const tags: string[] = [];
    const tagEls = this.dom.qsa(root, 'a[href*="/tags/"], .tags a, .field-name-field-tags a');
    for (const t of tagEls) {
      const txt = this.text(t);
      if (txt) tags.push(txt);
    }

    return {
      url,
      title,
      images,
      tags,
      author: null,
    };
  }

  async getPost(urlOrSlug: string): Promise<Post> {
    const url = absolutize(this.baseURL, urlOrSlug) ?? new URL(urlOrSlug, this.baseURL).href;
    const html = await this.http.getHtml(url);
    return this.parsePost(html, url);
  }

  // -------- Smart resolve
  async resolveSmart(urlOrSlug: string, _opts?: ResolveOptions): Promise<ResolvedRoute> {
    const url = absolutize(this.baseURL, urlOrSlug) ?? new URL(urlOrSlug, this.baseURL).href;
    const html = await this.http.getHtml(url);
    const doc = this.dom.parse(html);
    const articleImgs = this.dom.qsa((doc as any).documentElement ?? doc, 'article img');
    if (articleImgs.length >= 2) {
      const post = this.parsePost(html, url);
      return {
        route: 'viewer',
        data: {
          absoluteUrl: url,
          viewer: {
            kind: 'images',
            meta: {
              nodeId: null,
              fieldSys: null,
              title: post.title,
              kind: 'images',
              breadcrumbs: [],
              authors: [],
              sections: [],
              tags: [],
              characters: [],
              userTags: [],
            },
            images: post.images.map((u) => ({ original: u })),
          },
        } as any,
      };
    }
    const items = this.parseListing(html);
    const hasNext = this.parseHasNext(html);
    return {
      route: 'listing',
      data: {
        page: 0,
        items,
        hasNext,
        absoluteUrl: url,
        path: new URL(url).pathname,
      } as any,
    };
  }

  // -------- Alphabet (best effort)
  async alphabetLetters(section: AlphabetSection): Promise<AlphabetLetter[]> {
    const path = section === 'manga' ? '/munga' : `/${section}`;
    const html = await this.http.getHtml(path);
    const doc = this.dom.parse(html);
    const root = (doc as any).documentElement ?? doc;

    const letters: AlphabetLetter[] = [];
    const els = this.dom.qsa(
      root,
      ".alphabet a, .alphabet__item a, .letters a, a[href*='letter=']",
    );
    for (const a of els) {
      const label = this.text(a) || this.attr(a, 'data-letter');
      if (!label) continue;
      const href = this.attr(a, 'href');
      letters.push({ label, value: label, href });
    }
    if (!letters.length) {
      return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => ({ label: c, value: c, href: '' }));
    }
    return letters;
  }

  async alphabet(section: AlphabetSection, letter: string, page = 0): Promise<Page<ListingItem>> {
    const path = section === 'manga' ? '/munga' : `/${section}`;
    return this.listByPath(path, page, { letter });
  }

  // -------- Updates (views/ajax) — best effort
  // ВАЖНО: чтобы не ловить TS2411, не используем индексную сигнатуру с строгим 'string|number'.
  // Вход — Partial (значит, значения могут быть undefined), а отправляем — отфильтрованный Record.
  async updates(
    params?: Partial<Record<string, string | number>> & { view_name?: string },
  ): Promise<UpdatesResult> {
    // Сформировать полезную нагрузку без undefined:
    const filtered = Object.fromEntries(
      Object.entries(params ?? {}).filter(([, v]) => v !== undefined),
    ) as Record<string, string | number>;

    const p = { view_name: params?.view_name ?? 'new_mini', ...params };

    const json = await this.http.postForm<any>('/views/ajax', p);
    const raw = typeof json === 'string' ? json : JSON.stringify(json);
    const items = this.parseListing(raw);
    return { items, first: 0, last: items.length, html: raw, viewName: String(p.view_name) } as any;
  }

  async viewUpdates(
    viewName: string,
    params?: Omit<{ [k: string]: string | number }, 'view_name'>,
  ): Promise<UpdatesResult> {
    return this.updates({ view_name: viewName, ...(params || {}) });
  }
}

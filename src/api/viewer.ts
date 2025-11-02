import { HttpClient } from '../http';
import {
  ResolveOptions,
  ViewerMeta,
  ViewerImage,
  ViewerResult,
  ResolvedRoute,
  ViewerPayload,
  Page,
  ListingItem,
} from '../types';

import * as viewerParsers from '../parsers/viewer';
import { parseVideoFromHtml } from '../parsers/video';
import { parseHubListing } from '../parsers/listing';
import { ListingsAPI } from './index';

const ABS_URL = /^https?:\/\//i;

function absolutize(u: string, base: string) {
  if (!u) return '';
  if (ABS_URL.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return base.replace(/\/+$/, '') + u;
  return base.replace(/\/+$/, '') + '/' + u.replace(/^\/+/, '');
}

function buildViewerUrl(base: string, urlOrSlug: string) {
  if (ABS_URL.test(urlOrSlug)) return urlOrSlug;
  if (urlOrSlug.startsWith('/')) return base.replace(/\/+$/, '') + urlOrSlug;
  return base.replace(/\/+$/, '') + '/' + urlOrSlug.replace(/^\/+/, '');
}

async function fetchHtml(http: HttpClient, url: string): Promise<string> {
  const anyHttp = http as any;

  if (typeof anyHttp.getText === 'function') return anyHttp.getText(url);
  if (typeof anyHttp.get === 'function') return anyHttp.get(url) as Promise<string>;

  if (typeof anyHttp.text === 'function') return anyHttp.text(url);
  if (typeof anyHttp.fetch === 'function') {
    const r = await anyHttp.fetch(url);
    if (typeof r === 'string') return r;
    if (r && typeof r.text === 'function') return await r.text();
  }

  if (typeof fetch === 'function') {
    const r = await fetch(url);
    return await r.text();
  }

  throw new Error('HttpClient: no getText/get/text/fetch available');
}

function proxyImgMaybe(u: string, opts?: ResolveOptions): string {
  if (!u) return '';
  return opts?.proxyImage ? opts.proxyImage(u) : u;
}
function proxyVidMaybe(u: string, opts?: ResolveOptions): string {
  if (!u) return '';
  const proxyVideo = (opts as any)?.proxyVideo as ((url: string) => string) | undefined;
  return proxyVideo ? proxyVideo(u) : proxyImgMaybe(u, opts);
}

function parseImagesWithBackoff(
  html: string,
  baseURL: string,
): { meta: ViewerMeta; images: ViewerImage[] } {
  const anyParsers = viewerParsers as unknown as {
    parseViewer?: (h: string, b: string) => { meta: ViewerMeta; images: ViewerImage[] };
    default?: (h: string, b: string) => { meta: ViewerMeta; images: ViewerImage[] };
  };
  const candidate = anyParsers.parseViewer ?? anyParsers.default;

  if (typeof candidate === 'function') {
    return candidate(html, baseURL);
  }

  const images: ViewerImage[] = [];
  const re = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const original = absolutize(m[1], baseURL);
    if (!original) continue;
    images.push({ original, medium: original } as ViewerImage);
  }

  const meta = extractMeta(html, baseURL);
  return { meta, images };
}

function countOcc(html: string, rx: RegExp): number {
  let c = 0;
  rx.lastIndex = 0;
  while (rx.exec(html)) c++;
  return c;
}

function hasViewerClues(html: string): boolean {
  const hasJuicebox =
    /juicebox/i.test(html) || /\/juicebox\/xml\/field\/node\/\d+\/[a-z0-9_]+\/full/i.test(html);
  const hasFieldNode = /id=["']field--node--\d+--[a-z0-9_-]+--full["']/i.test(html);
  const hasJbStyles = /styles\/juicebox_(?:large|medium|small)\//i.test(html);
  const hasNodeBody = /<body[^>]+class=["'][^"']*\bnode\b[^"']*["']/i.test(html);
  const hasGalleryField =
    /field-name-(?:field_)?(?:pictures|images|image|post_pictures)\b/i.test(html);
  return hasJuicebox || hasFieldNode || hasJbStyles || hasNodeBody || hasGalleryField;
}

function isStrongListing(html: string): boolean {
  const rows = countOcc(html, /class=["'][^"']*\bviews-row\b[^"']*["']/gi);
  const hasViewContent = /class=["'][^"']*\bview-content\b[^"']*["']/i.test(html);
  const hasPager = /class=["'][^"']*\bpager\b[^"']*["']/i.test(html);
  return (hasViewContent && rows >= 12) || hasPager; // подбиралось эмпирически
}

export const ViewerAPI = {
  async resolveViewer(
    http: HttpClient,
    baseURL: string,
    urlOrSlug: string,
    opts: ResolveOptions = {},
  ): Promise<ViewerResult> {
    const url = buildViewerUrl(baseURL, urlOrSlug);
    const html = await fetchHtml(http, url);

    const parsedVideo = parseVideoFromHtml(html, baseURL);
    if (parsedVideo && parsedVideo.sources?.length) {
      const meta = extractMeta(html, baseURL);
      return {
        kind: 'video',
        meta,
        video: {
          poster: parsedVideo.poster ? proxyImgMaybe(parsedVideo.poster, opts) : undefined,
          sources: parsedVideo.sources.map((s) => ({
            ...s,
            proxied: proxyVidMaybe(s.url, opts),
          })),
        },
      };
    }

    if (hasViewerClues(html)) {
      const imgRes = parseImagesWithBackoff(html, baseURL);
      const images: ViewerImage[] = (imgRes.images || []).map((im: ViewerImage) => {
        const preferred =
          im.original ||
          (im as any).large ||
          (im as any).medium ||
          (im as any).small ||
          (im as any).thumb ||
          '';
        return { ...im, proxied: proxyImgMaybe(preferred, opts) };
      });
      return {
        kind: 'images',
        meta: imgRes.meta,
        images,
      };
    }

    return { kind: 'other', meta: extractMeta(html, baseURL) };
  },

  async resolveSmart(
    http: HttpClient,
    baseURL: string,
    urlOrSlug: string,
    opts: ResolveOptions = {},
  ): Promise<ResolvedRoute> {
    const url = buildViewerUrl(baseURL, urlOrSlug);
    const u = new URL(url);
    const path = u.pathname;

    const html = await fetchHtml(http, url);

    const parsedVideo = parseVideoFromHtml(html, baseURL);
    if (parsedVideo && parsedVideo.sources?.length) {
      const meta = extractMeta(html, baseURL);
      const viewer: ViewerResult = {
        kind: 'video',
        meta,
        video: {
          poster: parsedVideo.poster ? proxyImgMaybe(parsedVideo.poster, opts) : undefined,
          sources: parsedVideo.sources.map((s) => ({
            ...s,
            proxied: proxyVidMaybe(s.url, opts),
          })),
        },
      };

      let recommendations: ListingItem[] | undefined;
      try {
        const recPage = parseHubListing(html, baseURL, 0);
        if (recPage?.items?.length) {
          recommendations = recPage.items.map((it) => ({
            ...it,
            proxiedThumb: it.thumb ? proxyImgMaybe(it.thumb, opts) : undefined,
          }));
        }
      } catch {}

      const data: ViewerPayload = { absoluteUrl: url, path, viewer };
      (data as any).recommendations = recommendations;
      return { route: 'viewer', data: data as any };
    }

    if (hasViewerClues(html)) {
      const { meta, images } = parseImagesWithBackoff(html, baseURL);
      const mapped: ViewerImage[] = (images || []).map((im: ViewerImage) => {
        const preferred =
          im.original ||
          (im as any).large ||
          (im as any).medium ||
          (im as any).small ||
          (im as any).thumb ||
          '';
        return { ...im, proxied: proxyImgMaybe(preferred, opts) };
      });

      const viewer: ViewerResult = { kind: 'images', meta, images: mapped };

      let recommendations: ListingItem[] | undefined;
      try {
        const recPage = parseHubListing(html, baseURL, 0);
        if (recPage?.items?.length) {
          recommendations = recPage.items.map((it) => ({
            ...it,
            proxiedThumb: it.thumb ? proxyImgMaybe(it.thumb, opts) : undefined,
          }));
        }
      } catch {}

      const data: ViewerPayload = { absoluteUrl: url, path, viewer };
      (data as any).recommendations = recommendations;
      return { route: 'viewer', data: data as any  };
    }

    if (isStrongListing(html)) {
      const page: Page<ListingItem> = await ListingsAPI.listByPath(http, baseURL, path, 0);
      return { route: 'listing', data: { ...page, absoluteUrl: url, path } as any };
    }

    const page: Page<ListingItem> = await ListingsAPI.listByPath(http, baseURL, path, 0);
    return { route: 'listing', data: { ...page, absoluteUrl: url, path } as any };
  },
};

function extractText(html: string, re: RegExp) {
  const m = html.match(re);
  return m ? m[1].replace(/<[^>]*>/g, '').trim() : '';
}

function extractMeta(html: string, baseURL: string): ViewerMeta {
  const title =
    extractText(html, /<h1[^>]*id=["']page-title["'][^>]*>([\s\S]*?)<\/h1>/i) ||
    extractText(html, /<title>([\s\S]*?)<\/title>/i);

  const breadcrumbs: Array<{ title: string; url: string }> = [];
  const reCrumb =
    /<span[^>]*typeof=["']v:Breadcrumb["'][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/span>/gi;
  for (let m: RegExpExecArray | null; (m = reCrumb.exec(html)); ) {
    breadcrumbs.push({
      title: m[2].replace(/<[^>]*>/g, '').trim(),
      url: absolutize(m[1], baseURL),
    });
  }

  const authors = grabLinks(
    html,
    /field-name-field-vd-authors|field-name-field-authors|field-name-field-au/i,
    baseURL,
  );
  const sections = grabLinks(
    html,
    /field-name-field-vd-group|field-name-field-group|field-name-field-sections/i,
    baseURL,
  );
  const tags = grabLinks(html, /field-name-field-(?:vd-)?tags/i, baseURL);

  const meta = {
    title,
    breadcrumbs,
    authors,
    sections,
    tags,
    nodeId: '' as any,
    fieldSys: {} as any,
    kind: 'viewer',
  } as unknown as ViewerMeta;

  return meta;
}

function grabLinks(html: string, blockRe: RegExp, baseURL: string) {
  const m = html.match(
    new RegExp(`<div[^>]*class=["']field[^"']*${blockRe.source}[^"']*["'][\\s\\S]*?<\\/div>`, 'i'),
  );
  if (!m) return [];
  const block = m[0];
  const arr: Array<{ title: string; url: string }> = [];
  const reA = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (let x: RegExpExecArray | null; (x = reA.exec(block)); ) {
    arr.push({
      title: x[2].replace(/<[^>]*>/g, '').trim(),
      url: absolutize(x[1], baseURL),
    });
  }
  return arr;
}

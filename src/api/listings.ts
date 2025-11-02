import type { HttpClient } from '../http';
import type { ListingItem, Page, ListingQuery } from '../types';
import { parseHubListing } from '../parsers/listing';
import { parseAlphabetInline, parseAlphabetListing } from '../parsers/alphabet';
import { guessAlphabetSectionFromPath } from '../utils';
import { parseExposedSorting } from '../parsers/sorting';

function buildUrl(baseURL: string, path: string, params?: ListingQuery): string {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, baseURL);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      if (typeof v === 'boolean') url.searchParams.set(k, v ? '1' : '0');
      else url.searchParams.set(k, String(v));
    }
  }
  return url.pathname + (url.search ? url.search : '');
}

type ListByPathOptions = ListingQuery & {
  letter?: string;
};

function normalizeCharactersPath(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (/^\/alphabetical_order_characters\/?$/i.test(clean)) return '/characters';
  return clean;
}

function sniffPagePrefixFromHtml(html: string): string | null {
  const m =
    html.match(
      /<ul[^>]*class=["'][^"']*pager[^"']*["'][\s\S]*?\bhref=["'][^"']*?\bpage=([^"&]+)["'][\s\S]*?<\/ul>/i,
    ) || html.match(/\bpage=([^"&]+)/i);
  if (!m) return null;

  try {
    const decoded = decodeURIComponent(m[1]);
    if (decoded.includes(',')) {
      const parts = decoded.split(',').map((s) => s.trim());
      if (parts.length > 1) return parts.slice(0, -1).join(',') + ','; // "0,"
    }
  } catch {
  }
  return null;
}

function buildPageParam(htmlWithPager: string, page: number): string {
  const prefix = sniffPagePrefixFromHtml(htmlWithPager);
  return prefix ? `${prefix}${page}` : String(page);
}

function getAppliedFromHtml(html: string, baseURL: string): Record<string, string> {
  const sorting = parseExposedSorting(html, baseURL);
  return sorting?.appliedParams ?? {};
}

export async function latest(
  http: HttpClient,
  baseURL: string,
  page = 0,
  params?: ListingQuery,
): Promise<Page<ListingItem>> {
  const url0 = buildUrl(baseURL, '/new', { ...(params ?? {}), page: 0 });
  const html0 = await http.getHtml(url0);

  if (page === 0) {
    return parseHubListing(html0, baseURL, 0);
  }

  const applied = params ? {} : getAppliedFromHtml(html0, baseURL);
  const pageParam = buildPageParam(html0, page);

  const html = await http.getHtml(
    buildUrl(baseURL, '/new', { ...applied, ...(params ?? {}), page: pageParam }),
  );
  return parseHubListing(html, baseURL, page);
}

export async function listByPath(
  http: HttpClient,
  baseURL: string,
  path: string,
  page = 0,
  opts?: ListByPathOptions,
): Promise<Page<ListingItem>> {
  const clean = path.startsWith('/') ? path : `/${path}`;
  const commonParams: ListingQuery = { ...(opts ?? {}) };
  delete (commonParams as Record<string, unknown>).letter;

  if (opts?.letter) {
    const entryHtml = await http.getHtml(buildUrl(baseURL, clean, commonParams));
    const alphabet = parseAlphabetInline(entryHtml, baseURL);

    const wanted = String(opts.letter).toUpperCase();

    let letterUrl: string;
    if (alphabet) {
      const match =
        alphabet.letters.find((l) => (l.value || '').toUpperCase() === wanted) ||
        alphabet.letters.find((l) => (l.label || '').toUpperCase() === wanted);
      letterUrl = match?.href || `/${alphabet.section}/${encodeURIComponent(wanted)}`;
    } else {
      const section = guessAlphabetSectionFromPath(clean);
      letterUrl = `/${section}/${encodeURIComponent(wanted)}`;
    }

    const url0 = buildUrl(baseURL, letterUrl, { ...commonParams, page: 0 });
    const html0 = await http.getHtml(url0);

    const res0 = parseAlphabetListing(html0, baseURL, 0);
    if (alphabet) (res0 as Page<ListingItem>).alphabet = alphabet;

    if (page === 0) {
      return res0;
    }

    const applied = Object.keys(commonParams).length ? {} : getAppliedFromHtml(html0, baseURL);
    const pageParam = buildPageParam(html0, page);

    const html = await http.getHtml(
      buildUrl(baseURL, letterUrl, { ...applied, ...commonParams, page: pageParam }),
    );
    const res = parseAlphabetListing(html, baseURL, page);
    if (alphabet) (res as Page<ListingItem>).alphabet = alphabet;
    return res;
  }

  const effective = normalizeCharactersPath(clean);

  const html0 = await http.getHtml(buildUrl(baseURL, effective, { ...commonParams, page: 0 }));
  const parsed0 = parseHubListing(html0, baseURL, 0);

  if (effective !== clean && !parsed0.alphabet) {
    try {
      const entryHtml = await http.getHtml(buildUrl(baseURL, clean, commonParams));
      const alpha = parseAlphabetInline(entryHtml, baseURL);
      if (alpha) parsed0.alphabet = alpha;
    } catch {
    }
  }

  if (page === 0) {
    return parsed0;
  }

  const applied =
    Object.keys(commonParams).length
      ? {}
      : (parsed0 as any).sorting?.appliedParams ?? getAppliedFromHtml(html0, baseURL);

  const pageParam = buildPageParam(html0, page);

  const html = await http.getHtml(
    buildUrl(baseURL, effective, { ...applied, ...commonParams, page: pageParam }),
  );
  const parsed = parseHubListing(html, baseURL, page);

  if (effective !== clean && !parsed.alphabet) {
    try {
      const entryHtml = await http.getHtml(buildUrl(baseURL, clean, commonParams));
      const alpha = parseAlphabetInline(entryHtml, baseURL);
      if (alpha) parsed.alphabet = alpha;
    } catch {
      // best-effort
    }
  }

  return parsed;
}

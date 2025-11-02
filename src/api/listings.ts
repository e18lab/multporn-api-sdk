import type { HttpClient } from '../http';
import type { ListingItem, Page } from '../types';
import { parseHubListing } from '../parsers/listing';
import { parseAlphabetInline, parseAlphabetListing } from '../parsers/alphabet';
import { guessAlphabetSectionFromPath } from '../utils';

export async function latest(
  http: HttpClient,
  baseURL: string,
  page = 0,
): Promise<Page<ListingItem>> {
  const html = await http.getHtml(`/new?page=${page}`);
  return parseHubListing(html, baseURL, page);
}

type ListByPathOptions = {
  letter?: string;
};

function sniffPagePrefix(html: string): string {
  const m = html.match(/href="[^"]*?\bpage=([^"&]+)"/i);
  if (!m) return '';
  const decoded = decodeURIComponent(m[1]);
  const parts = decoded.split(',').map((s) => s.trim());
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join(',') + ','; // "0,"
}

export async function listByPath(
  http: HttpClient,
  baseURL: string,
  path: string,
  page = 0,
  opts?: ListByPathOptions,
): Promise<Page<ListingItem>> {
  const clean = path.startsWith('/') ? path : `/${path}`;

  if (!opts?.letter) {
    const firstHtml = await http.getHtml(`${clean}?page=0`);
    if (page === 0) {
      return parseHubListing(firstHtml, baseURL, 0);
    }

    const prefix = sniffPagePrefix(firstHtml);
    const pageParam = prefix ? `${prefix}${page}` : String(page);
    const html = await http.getHtml(`${clean}?page=${encodeURIComponent(pageParam)}`);
    return parseHubListing(html, baseURL, page);
  }

  const entryHtml = await http.getHtml(clean);
  const alphabet = parseAlphabetInline(entryHtml, baseURL);

  if (alphabet) {
    const wanted = String(opts.letter).toUpperCase();
    const match =
      alphabet.letters.find((l) => l.value.toUpperCase() === wanted) ||
      alphabet.letters.find((l) => l.label.toUpperCase() === wanted);

    const letterUrl = match?.href || `/${alphabet.section}/${encodeURIComponent(wanted)}`;
    const urlWithPage = letterUrl.includes('?')
      ? `${letterUrl}&page=${page}`
      : `${letterUrl}?page=${page}`;
    const html = await http.getHtml(urlWithPage);
    const res = parseAlphabetListing(html, baseURL, page);
    return { ...res, alphabet } as any;
  }

  const section = guessAlphabetSectionFromPath(clean);
  const letterUrl = `/${section}/${encodeURIComponent(String(opts.letter).toUpperCase())}`;
  const urlWithPage = `${letterUrl}?page=${page}`;
  const html = await http.getHtml(urlWithPage);
  const res = parseAlphabetListing(html, baseURL, page);
  return res;
}

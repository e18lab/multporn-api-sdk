import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { normSpace, parseIntLike, toAbsolute } from '../utils';
import type { AlphabetLetter, AlphabetBlock, ListingItem, Page } from '../types';
import { extractTotalPages } from './pagination';

export function parseAlphabetLetters(html: string, baseURL: string): AlphabetLetter[] {
  const $ = cheerio.load(html);
  const letters: AlphabetLetter[] = [];

  $('.views-summary a[href]').each((_, a) => {
    const el = $(a);
    const raw = normSpace(el.text());
    if (!raw) return;

    const count = parseIntLike(raw);
    const label = raw.replace(/\(\s*\d+\s*\)\s*$/, '').trim() || raw;
    const hrefRel = el.attr('href') || '';
    const href = toAbsolute(baseURL, hrefRel) || '';
    const lastSeg = decodeURIComponent((hrefRel.split('/').filter(Boolean).pop() || '').trim());
    if (!label || !href) return;

    letters.push({
      label,
      value: lastSeg || label,
      href,
      count: typeof count === 'number' ? count : undefined,
      active: el.hasClass('active') || /(^|\s)active(\s|$)/.test(el.attr('class') || ''),
    });
  });

  const uniq = new Map<string, AlphabetLetter>();
  for (const l of letters) if (!uniq.has(l.value)) uniq.set(l.value, l);
  return Array.from(uniq.values());
}

export function parseAlphabetInline(html: string, baseURL: string): AlphabetBlock | null {
  const $ = cheerio.load(html);
  const containers: Element[] = [];

  containers.push(...($('.view-glossary-comics').toArray() as Element[]));
  if (containers.length === 0) containers.push(...($('.view-glossary').toArray() as Element[]));
  if (containers.length === 0) {
    const anyNodes = $('.view').has('.views-summary a').toArray();
    const onlyElements = anyNodes.filter((n): n is Element => (n as any)?.type === 'tag');
    containers.push(...onlyElements);
  }
  if (containers.length === 0) return null;

  const grouped = new Map<string, AlphabetLetter[]>();

  for (const cont of containers) {
    const $cont = $(cont);
    $cont.find('.views-summary a[href]').each((__, a) => {
      const el = $(a);
      const raw = normSpace(el.text());
      if (!raw) return;

      const count = parseIntLike(raw);
      const label = raw.replace(/\(\s*\d+\s*\)\s*$/, '').trim() || raw;
      const hrefRel = el.attr('href') || '';
      const hrefAbs = toAbsolute(baseURL, hrefRel);
      if (!hrefAbs) return;

      let section = '';
      try {
        const p = new URL(hrefAbs).pathname;
        const m = p.match(/^\/([^/]+)/);
        section = m ? m[1] : '';
      } catch {}

      const value =
        decodeURIComponent((hrefRel.split('/').filter(Boolean).pop() || '').trim()) || label;

      const entry: AlphabetLetter = {
        label,
        value,
        href: hrefAbs,
        count: typeof count === 'number' ? count : undefined,
        active: el.hasClass('active') || /(^|\s)active(\s|$)/.test(el.attr('class') || ''),
      };

      const arr = grouped.get(section) ?? [];
      if (!arr.some((x) => x.value === entry.value)) arr.push(entry);
      grouped.set(section, arr);
    });
  }

  if (!grouped.size) return null;

  let chosen: { section: string; letters: AlphabetLetter[] } | null = null;
  for (const [sec, letters] of grouped.entries()) {
    if (letters.some((l) => l.active)) {
      chosen = { section: sec, letters };
      break;
    }
  }
  if (!chosen) {
    let bestSec = '';
    let bestArr: AlphabetLetter[] = [];
    for (const [sec, letters] of grouped.entries()) {
      if (letters.length > bestArr.length) {
        bestSec = sec;
        bestArr = letters;
      }
    }
    chosen = { section: bestSec, letters: bestArr };
  }
  if (!chosen) {
    const [sec, letters] = grouped.entries().next().value as [string, AlphabetLetter[]];
    chosen = { section: sec, letters };
  }

  chosen.letters.sort((a, b) => a.label.localeCompare(b.label, 'en'));
  if (!looksLikeAlphabet(chosen.letters)) return null;
  return { section: chosen.section, letters: chosen.letters };
}

function looksLikeAlphabet(letters: AlphabetLetter[]): boolean {
  const short = letters.filter(l => /^[A-Z#]$/i.test(l.label.trim())).length;
  return letters.length >= 10 && short >= 10;
}

function pickFromSrcset(srcset?: string): string | undefined {
  if (!srcset) return;
  const first = srcset.split(',')[0]?.trim();
  if (!first) return;
  const url = first.split(/\s+/)[0];
  return url || undefined;
}

function pickFromStyle(style?: string): string | undefined {
  if (!style) return;
  const m = style.match(/url\((['"]?)(.*?)\1\)/i);
  return m?.[2] || undefined;
}

function pickThumbUrl(
  scope: cheerio.Cheerio<Element | AnyNode>,
  baseURL: string,
): string | undefined {
  const candidates = [
    '.views-field-field-comg-preview img',
    '.views-field-field-cat-preview img',
    '.views-field-field-category-preview img',
    '.views-field-field-man-preview-1 img',
    '.views-field-field-man-preview img',
    '.views-field-field-author-preview img',
    '.views-field-field-authors-pre img',
    '.views-field-field-gif-pre-1 img',
    '.views-field-field-gif-preview img',
    '.views-field-field-gif-pre img',
    '.views-field-field-gif img',
    '.views-field-field-preview img',
    '.views-field-field-image img',
    '.views-field-field-avatar img',
    '.field-content a > img',
    '.field-content img',
    'a > img',
    'img',
  ];

  for (const sel of candidates) {
    const img = scope.find(sel).first();
    if (img.length) {
      const ds = img.attr('data-src') || img.attr('data-original');
      const ss = pickFromSrcset(img.attr('srcset') || '');
      const src = ds || ss || img.attr('src');
      const abs = toAbsolute(baseURL, src || '');
      if (abs) return abs;
    }
  }

  const srcset = pickFromSrcset(scope.find('picture source').first().attr('srcset') || '');
  if (srcset) {
    const abs = toAbsolute(baseURL, srcset);
    if (abs) return abs;
  }

  const bg = pickFromStyle(
    (scope.attr('style') as string | undefined) ||
      (scope.find('[style*="background-image"]').first().attr('style') as string | undefined),
  );
  if (bg) {
    const abs = toAbsolute(baseURL, bg);
    if (abs) return abs;
  }

  return undefined;
}

export function parseAlphabetListing(
  html: string,
  baseURL: string,
  page: number,
): Page<ListingItem> {
  const $ = cheerio.load(html);
  const items: ListingItem[] = [];

  $('table.views-view-grid td').each((_, td) => {
    const scope = $(td);
    const a = scope
      .find(
        '.views-field-title a[href], .views-field-name a[href], strong a[href], h5 a[href], a[href]',
      )
      .first();
    const href = a.attr('href') || '';
    const url = toAbsolute(baseURL, href);
    const title = (
      a.text() ||
      scope.find('.views-field-title .field-content').text() ||
      scope.find('.views-field-name .field-content').text() ||
      scope.find('strong').first().text() ||
      scope.find('h5').first().text() ||
      ''
    ).trim();
    const thumb = pickThumbUrl(scope as any, baseURL);
    if (url && title) items.push({ title, url, thumb });
  });

  if (items.length === 0) {
    $('.view .view-content .views-row').each((_, row) => {
      const el = $(row);
      const a = el
        .find(
          '.views-field-title a[href], .views-field-name a[href], strong a[href], h5 a[href], a[href]',
        )
        .first();
      const href = a.attr('href') || '';
      const url = toAbsolute(baseURL, href);
      const title = (
        a.text() ||
        el.find('.views-field-title .field-content').text() ||
        el.find('.views-field-name .field-content').text() ||
        el.find('strong').first().text() ||
        el.find('h5').first().text() ||
        ''
      ).trim();
      const thumb = pickThumbUrl(el as any, baseURL);
      if (url && title) items.push({ title, url, thumb });
    });
  }

  const totalPages = extractTotalPages(html);
  const hasNext = page + 1 < totalPages;

  return { items, page, hasNext, totalPages };
}

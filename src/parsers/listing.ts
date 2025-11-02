import * as cheerio from 'cheerio';
import { toAbsolute } from '../utils';
import type { ListingItem, Page } from '../types';
import { extractTotalPages } from './pagination';
import { parseAlphabetInline } from './alphabet';

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

function pickThumb($scope: cheerio.Cheerio<any>, baseURL: string): string | undefined {
  const cands = [
    '.views-field-field-preview img',
    '.views-field-field-image img',
    '.views-field-field-avatar img',
    '.views-field-field-cat-preview img',
    '.views-field-field-category-preview img',
    '.views-field-field-comg-preview img',
    '.views-field-field-gif-preview img',
    '.views-field-field-gif-pre img',
    '.views-field-field-gif img',
    'img',
  ];

  for (const sel of cands) {
    const img = $scope.find(sel).first();
    if (img.length) {
      const ds = img.attr('data-src') || img.attr('data-original');
      const ss = pickFromSrcset(img.attr('srcset') || '');
      const src = ds || ss || img.attr('src');
      const abs = toAbsolute(baseURL, src || '');
      if (abs) return abs;
    }
  }

  const srcset = pickFromSrcset($scope.find('picture source').first().attr('srcset') || '');
  if (srcset) return toAbsolute(baseURL, srcset);

  const bg = pickFromStyle(
    $scope.attr('style') || $scope.find('[style*="background-image"]').first().attr('style'),
  );
  if (bg) return toAbsolute(baseURL, bg);

  return undefined;
}

function findTitleLink($scope: cheerio.Cheerio<any>) {
  const sel = $scope.find('.views-field-title a[href]').first().length
    ? '.views-field-title a[href]'
    : $scope.find('.views-field-name a[href]').first().length
      ? '.views-field-name a[href]'
      : $scope.find('strong a[href]').first().length
        ? 'strong a[href]'
        : $scope.find('h5 a[href]').first().length
          ? 'h5 a[href]'
          : 'a[href]';
  return $scope.find(sel).first();
}

export function parseHubListing(html: string, baseURL: string, page: number): Page<ListingItem> {
  const $ = cheerio.load(html);
  const items: ListingItem[] = [];

  $('table.views-view-grid td').each((_, td) => {
    const $td = $(td);
    const a = findTitleLink($td);
    const href = a.attr('href') || '';
    const url = toAbsolute(baseURL, href);
    const title = (
      a.text() ||
      $td.find('.views-field-title .field-content').text() ||
      $td.find('.views-field-name .field-content').text() ||
      $td.find('strong').first().text() ||
      $td.find('h5').first().text() ||
      ''
    ).trim();
    const thumb = pickThumb($td, baseURL);
    if (url && title) items.push({ title, url, thumb });
  });

  if (!items.length) {
    $('.view .view-content .views-row').each((_, row) => {
      const $row = $(row);
      const a = findTitleLink($row);
      const href = a.attr('href') || '';
      const url = toAbsolute(baseURL, href);
      const title = (
        a.text() ||
        $row.find('.views-field-title .field-content').text() ||
        $row.find('.views-field-name .field-content').text() ||
        $row.find('strong').first().text() ||
        $row.find('h5').first().text() ||
        ''
      ).trim();
      const thumb = pickThumb($row, baseURL);
      if (url && title) items.push({ title, url, thumb });
    });
  }

  const totalPages = extractTotalPages(html);
  const hasNext = page + 1 < totalPages;

  const alphabet = parseAlphabetInline(html, baseURL) || undefined;

  return {
    items,
    page,
    hasNext,
    totalPages,
    pageSize: undefined,
    alphabet,
  } as any as Page<ListingItem>;
}

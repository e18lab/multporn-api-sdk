import * as cheerio from 'cheerio';
import { toAbsolute } from '../utils';
import type { ListingItem, Page } from '../types';
import { extractTotalPages } from './pagination';
import { parseAlphabetInline } from './alphabet';
import { parseExposedSorting } from './sorting';

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

function textFrom($el: cheerio.Cheerio<any>): string {
  return ($el.text() || '').replace(/\s+/g, ' ').trim();
}

function isPager($a: cheerio.Cheerio<any>): boolean {
  return !!$a.closest('ul.pager, .pager, nav.pagination').length;
}

function cardRoot($a: cheerio.Cheerio<any>): cheerio.Cheerio<any> {
  const r = $a.closest('li, .views-row, td, .node, .views-col, .view-content > div').first();
  return r.length ? r : $a.parent();
}

export function parseHubListing(html: string, baseURL: string, page: number): Page<ListingItem> {
  const $ = cheerio.load(html);
  const items: ListingItem[] = [];
  const seen = new Set<string>();

  const views = $('.view');
  const scopes = views.length ? views.toArray() : [$('body').get(0)!];

  for (const v of scopes) {
    const $view = $(v);
    const $root = $view.find('.view-content').length ? $view.find('.view-content') : $view;

    $root.find('table.views-view-grid td').each((_, td) => {
      const $td = $(td);
      const a = findTitleLink($td);
      const href = a.attr('href') || '';
      const url = toAbsolute(baseURL, href);
      if (!url || seen.has(url)) return;

      const title =
        textFrom(a) ||
        textFrom($td.find('.views-field-title .field-content')) ||
        textFrom($td.find('.views-field-name .field-content')) ||
        a.attr('title') ||
        '';

      const thumb = pickThumb($td, baseURL);
      if (title) {
        items.push({ title, url, thumb });
        seen.add(url);
      }
    });

    $root.find('.views-row, .node, li').each((_, row) => {
      const $row = $(row);
      const a = findTitleLink($row);
      const href = a.attr('href') || '';
      const url = toAbsolute(baseURL, href);
      if (!url || seen.has(url)) return;

      const title =
        textFrom(a) ||
        textFrom($row.find('.views-field-title .field-content')) ||
        textFrom($row.find('.views-field-name .field-content')) ||
        a.attr('title') ||
        '';

      const thumb = pickThumb($row, baseURL);
      if (title) {
        items.push({ title, url, thumb });
        seen.add(url);
      }
    });

    $root.find('a[href] img').each((_, imgEl) => {
      const $a = $(imgEl).closest('a[href]');
      if (isPager($a)) return;

      const url = toAbsolute(baseURL, $a.attr('href') || '');
      if (!url || seen.has(url)) return;

      const $card = cardRoot($a);
      const title =
        textFrom($card.find('.views-field-title .field-content').first()) ||
        textFrom($card.find('.views-field-name .field-content').first()) ||
        $a.attr('title') ||
        ($(imgEl).attr('alt') || '');

      if (!title.trim()) return;

      const thumb =
        pickThumb($card, baseURL) ||
        pickThumb($a, baseURL) ||
        toAbsolute(baseURL, $(imgEl).attr('src') || '');

      items.push({ title: title.trim(), url, thumb });
      seen.add(url);
    });
  }

  const totalPages = extractTotalPages(html);
  const hasNext = page + 1 < totalPages;
  const alphabet = parseAlphabetInline(html, baseURL) || undefined;
  const sorting = parseExposedSorting(html, baseURL);

  return {
    items,
    page,
    hasNext,
    totalPages,
    pageSize: undefined,
    alphabet,
    sorting,
  };
}

import * as cheerio from 'cheerio';
import { ListingItem, Page } from '../types';
import { toAbsolute } from '../utils';
import { extractTotalPages } from './pagination';

export function parseSearch(html: string, baseURL: string, page: number): Page<ListingItem> {
  const $ = cheerio.load(html);
  const items: ListingItem[] = [];

  const view = $('.view')
    .filter((_, el) => {
      const cls = $(el).attr('class') || '';
      return (
        /view-id-search/.test(cls) &&
        /view-display-id-page/.test(cls) &&
        $(el).find('.view-content').length > 0
      );
    })
    .first();

  view.find('.view-content .views-row').each((_, el) => {
    const row = $(el);

    const a = row.find('.views-field-title a[href]').first().length
      ? row.find('.views-field-title a[href]').first()
      : row.find('a[href]').first();

    const href = a.attr('href') || '';
    const url = toAbsolute(baseURL, href);

    const title = (a.text() || row.find('.views-field-title .field-content').text() || '').trim();

    const img = row.find('.views-field-field-preview img').first().length
      ? row.find('.views-field-field-preview img').first()
      : row.find('.views-field-field-image img').first().length
        ? row.find('.views-field-field-image img').first()
        : row.find('.views-field-field-fl-prev img').first().length
          ? row.find('.views-field-field-fl-prev img').first()
          : row.find('.views-field-field-avatar img').first().length
            ? row.find('.views-field-field-avatar img').first()
            : row.find('img').first();

    let thumb = img.attr('data-src') || img.attr('src') || undefined;
    thumb = toAbsolute(baseURL, thumb);

    if (url && title) items.push({ title, url, thumb });
  });

  const totalPages = extractTotalPages(html);
  const hasNext = page + 1 < totalPages;

  if (items.length === 0) {
    return { items: [], page, hasNext: false, totalPages: 1 };
  }
  return { items, page, hasNext, totalPages };
}

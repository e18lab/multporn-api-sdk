import * as cheerio from 'cheerio';
import type { Cheerio } from 'cheerio';
import { ListingItem, ViewName } from '../types';
import { toAbsolute } from '../utils';

export function parseViewDisplay(
  viewName: ViewName | string,
  html: string,
  baseURL: string,
): ListingItem[] {
  const $ = cheerio.load(html);
  const items: ListingItem[] = [];

  const pickThumb = (scope: Cheerio<any>) => {
    const img = scope.find('.views-field-field-preview img').first().length
      ? scope.find('.views-field-field-preview img').first()
      : scope.find('.views-field-field-image img').first().length
        ? scope.find('.views-field-field-image img').first()
        : scope.find('.views-field-field-avatar img').first().length
          ? scope.find('.views-field-field-avatar img').first()
          : scope.find('img').first();
    let thumb = img.attr('data-src') || img.attr('src') || undefined;
    return toAbsolute(baseURL, thumb);
  };

  const liList = $('ul.jcarousel li');
  liList.each((_, li) => {
    const scope = $(li);

    const a = scope.find('.views-field-title a[href]').first().length
      ? scope.find('.views-field-title a[href]').first()
      : scope.find('.views-field-name a[href]').first();

    const href = a.attr('href') || '';
    const url = toAbsolute(baseURL, href);

    const title = (
      a.text() ||
      scope.find('.views-field-title .field-content').text() ||
      scope.find('.views-field-name .field-content').text() ||
      ''
    ).trim();

    const thumb = pickThumb(scope);

    if (url && title) items.push({ title, url, thumb });
  });

  return items;
}

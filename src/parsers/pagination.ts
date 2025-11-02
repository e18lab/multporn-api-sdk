import * as cheerio from 'cheerio';

export function extractTotalPages(html: string): number {
  const $ = cheerio.load(html);
  const root = $(
    'ul.pager, nav.pagination, .pagination, .item-list .pager, #content .pager',
  ).first();

  if (!root.length) return 1;

  const lastHref =
    root
      .find('li.pager-last a[href], a[rel="last"], a[title*="Last"], a[title*="Последняя"]')
      .attr('href') || undefined;

  if (lastHref) {
    const m = /[?&]page=(\d+)/i.exec(lastHref);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n)) return Math.max(1, n + 1);
    }
  }

  let maxNum = 0;

  root.find('a, li, span').each((_, el) => {
    const txt = ($(el).text() || '').trim();
    const n = Number(txt);
    if (Number.isFinite(n)) maxNum = Math.max(maxNum, n);
  });

  root.find('a[href]').each((_, a) => {
    const href = String($(a).attr('href') || '');
    const m = /[?&]page=(\d+)/i.exec(href);
    if (m) {
      const idx = parseInt(m[1], 10);
      if (Number.isFinite(idx)) maxNum = Math.max(maxNum, idx + 1);
    }
  });

  return Math.max(1, maxNum || 1);
}

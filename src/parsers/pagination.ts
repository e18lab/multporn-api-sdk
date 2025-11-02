import * as cheerio from 'cheerio';

function pageIndexFromParam(raw?: string | null): number | null {
  if (!raw) return null;
  const decoded = decodeURIComponent(String(raw));
  const parts = decoded
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
  if (!parts.length) return null;
  return Math.max(...parts);
}

function pageIndexFromHref(href: string): number | null {
  if (!href) return null;
  try {
    const u = new URL(href, 'https://example.com');
    return pageIndexFromParam(u.searchParams.get('page'));
  } catch {
    const m = href.match(/[?&]page=([^&#]+)/i);
    return m ? pageIndexFromParam(m[1]) : null;
  }
}

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
    const idx = pageIndexFromHref(lastHref);
    if (idx != null) return Math.max(1, idx + 1);
  }

  let maxPages = 0;
  root.find('a[href]').each((_, a) => {
    const href = String($(a).attr('href') || '');
    const idx = pageIndexFromHref(href);
    if (idx != null) maxPages = Math.max(maxPages, idx + 1);
  });

  root.find('a, li, span').each((_, el) => {
    const n = Number(($(el).text() || '').trim());
    if (Number.isFinite(n)) maxPages = Math.max(maxPages, n);
  });

  return Math.max(1, maxPages || 1);
}

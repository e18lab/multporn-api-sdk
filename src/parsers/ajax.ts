import * as cheerio from 'cheerio/slim';

export function extractViewsContextForSearch(html: string): {
  view_name: string;
  view_display_id: string;
  view_dom_id: string;
  ajax_html_id?: string;
} {
  const $ = cheerio.load(html);

  const view = $('.view')
    .filter((_, el) => {
      const cls = $(el).attr('class') || '';
      return /view-id-search/.test(cls) && /view-display-id-page/.test(cls);
    })
    .first();

  const cls = view.attr('class') || '';
  const view_name = cls.match(/view-id-([^\s]+)/)?.[1] || 'search';
  const view_display_id = cls.match(/view-display-id-([^\s]+)/)?.[1] || 'page';

  const domFromClass = cls.match(/view-dom-id-([^\s]+)/)?.[1] || '';
  const domFromId = (view.attr('id') || '').replace(/^view-dom-id-/, '');
  const view_dom_id = domFromClass || domFromId || 'view-dom-id-1';

  const ajax_html_id = $('[id^="views-exposed-form"]').attr('id') || view.attr('id') || undefined;

  return { view_name, view_display_id, view_dom_id, ajax_html_id };
}

export function extractHtmlFromDrupalAjax(payload: unknown, wantDomId?: string): string | null {
  if (Array.isArray(payload)) {
    for (const cmd of payload) {
      const c = cmd as any;
      const sel = String(c?.selector || '');
      const data = c?.data;
      if (
        (c?.command === 'insert' || c?.command === 'replaceWith') &&
        typeof data === 'string' &&
        data.trim() &&
        (!wantDomId || sel.includes(wantDomId) || sel.includes('view-content'))
      )
        return data;
    }
    const concat = payload.map((x: any) => (typeof x?.data === 'string' ? x.data : '')).join('');
    return concat.trim() ? concat : null;
  }
  const disp = (payload as any)?.display;
  return typeof disp === 'string' ? disp : null;
}

import { HttpClient } from '../http';
import { Page, ListingItem } from '../types';
import { parseSearch } from '../parsers/search';
import { extractViewsContextForSearch, extractHtmlFromDrupalAjax } from '../parsers/ajax';

export async function search(
  http: HttpClient,
  baseURL: string,
  query: string,
  page = 0,
): Promise<Page<ListingItem>> {
  const q = encodeURIComponent(query);

  const html1 = await http.getHtml(`/search?search_api_views_fulltext=${q}&page=${page}`);
  const parsed1 = parseSearch(html1, baseURL, page);
  if (parsed1.items.length > 0) return parsed1;

  const firstHtml = await http.getHtml(`/search?search_api_views_fulltext=${q}`);
  const ctx = extractViewsContextForSearch(firstHtml);

  const ajaxUrl = `/views/ajax?search_api_views_fulltext=${q}&undefined=Search&_wrapper_format=drupal_ajax`;
  const payload: Record<string, string | string[]> = {
    view_name: ctx.view_name || 'search',
    view_display_id: ctx.view_display_id || 'page',
    view_args: '',
    view_path: 'search',
    view_base_path: 'search',
    view_dom_id: ctx.view_dom_id,
    pager_element: '0',
    page: String(page),
  };
  if (ctx.ajax_html_id) payload['ajax_html_ids[]'] = [ctx.ajax_html_id];

  const json: unknown = await http.postForm<unknown>(ajaxUrl, payload);
  const html2 = extractHtmlFromDrupalAjax(json, ctx.view_dom_id) || '';
  return parseSearch(html2, baseURL, page);
}

import { HttpClient } from '../http';
import { UpdatesResult, MultpornUpdatesParams, ListingItem, ViewName } from '../types';
import { parseViewDisplay } from '../parsers/viewDisplay';

type JCarouselResponse = { status: boolean; display: string; title?: string; messages?: string };

const VIEW_PRESETS: Record<
  string,
  { view_display_id?: string; jcarousel_dom_id?: string | number }
> = {
  random_top_comics: { view_display_id: 'block', jcarousel_dom_id: 7 },
  top_random_characters: { view_display_id: 'block', jcarousel_dom_id: 8 },
};

export async function updates(
  http: HttpClient,
  baseURL: string,
  params: MultpornUpdatesParams = {},
): Promise<UpdatesResult> {
  const viewName = params.view_name ?? 'new_mini';
  const preset = VIEW_PRESETS[viewName] || {};

  const p = {
    js: '1',
    first: String(params.first ?? 1),
    last: String(params.last ?? 8),
    view_args: params.view_args ?? '',
    view_path: params.view_path ?? 'node',
    view_base_path: params.view_base_path ?? '',
    view_display_id: params.view_display_id ?? preset.view_display_id ?? 'block_1',
    view_name: viewName,
    jcarousel_dom_id: String(params.jcarousel_dom_id ?? preset.jcarousel_dom_id ?? 1),
  };

  const qs = new URLSearchParams(p).toString();
  let data = await http.getJson<JCarouselResponse>(`/jcarousel/ajax/views?${qs}`);
  let display = data.display ?? '';

  if (!display || !display.trim()) {
    const orig = Number(p.jcarousel_dom_id);
    for (const candidate of [orig - 1, orig + 1]) {
      if (!Number.isFinite(candidate) || candidate < 1) continue;
      const qs2 = new URLSearchParams({ ...p, jcarousel_dom_id: String(candidate) }).toString();
      const d2 = await http.getJson<JCarouselResponse>(`/jcarousel/ajax/views?${qs2}`);
      if (d2.display && d2.display.trim()) {
        display = d2.display;
        break;
      }
    }
  }

  const items: ListingItem[] = parseViewDisplay(viewName, display ?? '', baseURL);
  return { items, first: Number(p.first), last: Number(p.last), html: display ?? '', viewName };
}

export const updatesShortcuts = {
  newMini: (http: HttpClient, baseURL: string, p?: Omit<MultpornUpdatesParams, 'view_name'>) =>
    updates(http, baseURL, { ...(p ?? {}), view_name: 'new_mini' }),
  userUploadFront: (
    http: HttpClient,
    baseURL: string,
    p?: Omit<MultpornUpdatesParams, 'view_name'>,
  ) => updates(http, baseURL, { ...(p ?? {}), view_name: 'user_upload_front' }),
  updatedManga: (http: HttpClient, baseURL: string, p?: Omit<MultpornUpdatesParams, 'view_name'>) =>
    updates(http, baseURL, { ...(p ?? {}), view_name: 'updated_manga' }),
  updatedMangaPromoted: (
    http: HttpClient,
    baseURL: string,
    p?: Omit<MultpornUpdatesParams, 'view_name'>,
  ) => updates(http, baseURL, { ...(p ?? {}), view_name: 'updated_manga_promoted' }),
  updatedGames: (http: HttpClient, baseURL: string, p?: Omit<MultpornUpdatesParams, 'view_name'>) =>
    updates(http, baseURL, { ...(p ?? {}), view_name: 'updated_games' }),
  randomTopComics: (
    http: HttpClient,
    baseURL: string,
    p?: Omit<MultpornUpdatesParams, 'view_name'>,
  ) => updates(http, baseURL, { ...(p ?? {}), view_name: 'random_top_comics' }),
  topRandomCharacters: (
    http: HttpClient,
    baseURL: string,
    p?: Omit<MultpornUpdatesParams, 'view_name'>,
  ) => updates(http, baseURL, { ...(p ?? {}), view_name: 'top_random_characters' }),
};

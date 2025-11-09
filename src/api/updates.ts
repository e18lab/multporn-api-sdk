import { HttpClient } from '../http';
import { UpdatesResult, MultpornUpdatesParams, ListingItem, ViewName } from '../types';
import { parseViewDisplay } from '../parsers/viewDisplay';

type JCarouselResponse = {
  status: boolean;
  display: string;
  title?: string;
  messages?: string;
};

const VIEW_PRESETS: Record<
  string,
  { view_display_id?: string; jcarousel_dom_id?: string | number }
> = {
  random_top_comics:     { view_display_id: 'block',   jcarousel_dom_id: 7 },
  top_random_characters: { view_display_id: 'block',   jcarousel_dom_id: 8 },
};

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export async function updates(
  http: HttpClient,
  baseURL: string,
  params: MultpornUpdatesParams = {},
): Promise<UpdatesResult> {
  const viewName: ViewName = (params.view_name as ViewName) ?? ('new_mini' as ViewName);

  const preset = VIEW_PRESETS[viewName] || {};
  const first = Number(params.first ?? 0);
  const last  = Number(params.last  ?? 8);

  const basePayload = {
    js: '1',
    first: String(first),
    last:  String(last),
    view_args: params.view_args ?? '',
    view_path: params.view_path ?? 'node',
    view_base_path: params.view_base_path ?? '',
    view_name: viewName,
  };

  const displayCandidates = uniq<string>([
    params.view_display_id ?? preset.view_display_id ?? 'block_1',
    'block',
    'block_2',
    'block_3',
    'page',
    'default',
  ]).filter(Boolean);

  const origDom = Number(params.jcarousel_dom_id ?? preset.jcarousel_dom_id ?? 1);
  const domCandidates = uniq<number>([
    origDom,
    origDom - 1,
    origDom + 1,
    ...Array.from({ length: 10 }, (_, i) => i + 1),
  ]).filter((n) => Number.isFinite(n) && n > 0);

  let displayHtml = '';

  for (const view_display_id of displayCandidates) {
    for (const jcarousel_dom_id of domCandidates) {
      try {
        const qs = new URLSearchParams({
          ...basePayload,
          view_display_id: String(view_display_id),
          jcarousel_dom_id: String(jcarousel_dom_id),
        }).toString();

        const data = await http.getJson<JCarouselResponse>(`/jcarousel/ajax/views?${qs}`);
        const html = data?.display?.trim() ?? '';
        if (html) {
          displayHtml = html;
          displayCandidates.length = 0;
          break;
        }
      } catch {
        // продолжим перебирать кандидатов
      }
    }
  }

  if (!displayHtml) {
    return { items: [], first, last, html: '', viewName };
  }

  const items: ListingItem[] = parseViewDisplay(viewName, displayHtml, baseURL);
  return { items, first, last, html: displayHtml, viewName };
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

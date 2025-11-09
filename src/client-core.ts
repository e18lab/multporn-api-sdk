import { HttpClient, HttpClientOptions } from './http';

import {
  ListingItem,
  Page,
  Post,
  UpdatesResult,
  ViewName,
  MultpornUpdatesParams,
  AlphabetSection,
  AlphabetLetter,
  ViewerResult,
  ResolveOptions,
  ResolvedRoute,
  ListingQuery,
} from './types';

import { SearchAPI, UpdatesAPI, PostsAPI, ListingsAPI, AlphabetAPI, ViewerAPI } from './api/index';

export { parseHubListing as parseListing } from './parsers/listing';
export { parsePost } from './parsers/post';

export type MultpornClientOptions = Omit<HttpClientOptions, 'baseURL'> & {
  baseURL?: string;
};

export class MultpornClient {
  private http: HttpClient;
  private baseURL: string;

  constructor(opts: MultpornClientOptions = {}) {
    this.baseURL = (opts.baseURL ?? 'https://multporn.net').replace(/\/+$/, '');
    this.http = new HttpClient({ ...opts, baseURL: this.baseURL });
  }

  latest(page = 0, params?: ListingQuery): Promise<Page<ListingItem>> {
    return ListingsAPI.latest(this.http, this.baseURL, page, params);
  }

  listByPath(
    path: string,
    page = 0,
    params?: ListingQuery & { letter?: string },
  ): Promise<Page<ListingItem>> {
    return ListingsAPI.listByPath(this.http, this.baseURL, path, page, params);
  }

  search(query: string, page = 0): Promise<Page<ListingItem>> {
    return SearchAPI.search(this.http, this.baseURL, query, page);
  }

  getPost(urlOrSlug: string): Promise<Post> {
    return PostsAPI.getPost(this.http, this.baseURL, urlOrSlug);
  }

  resolve(urlOrSlug: string, opts: ResolveOptions = {}): Promise<ViewerResult> {
    return ViewerAPI.resolveViewer(this.http, this.baseURL, urlOrSlug, opts);
  }

  resolveSmart(urlOrSlug: string, opts: ResolveOptions = {}): Promise<ResolvedRoute> {
    return ViewerAPI.resolveSmart(this.http, this.baseURL, urlOrSlug, opts);
  }

  updates(params: MultpornUpdatesParams = {}): Promise<UpdatesResult> {
    return UpdatesAPI.updates(this.http, this.baseURL, params);
  }

  viewUpdates(
    viewName: ViewName,
    params?: Omit<MultpornUpdatesParams, 'view_name'>,
  ): Promise<UpdatesResult> {
    return this.updates({ ...(params ?? {}), view_name: viewName });
  }

  updatesNewMini(p?: Omit<MultpornUpdatesParams, 'view_name'>) {
    return UpdatesAPI.updates(this.http, this.baseURL, { ...(p ?? {}), view_name: 'new_mini' });
  }

  userUploadFront(p?: Omit<MultpornUpdatesParams, 'view_name'>) {
    return UpdatesAPI.updates(this.http, this.baseURL, {
      ...(p ?? {}),
      view_name: 'user_upload_front',
    });
  }

  updatedManga(p?: Omit<MultpornUpdatesParams, 'view_name'>) {
    return UpdatesAPI.updates(this.http, this.baseURL, {
      ...(p ?? {}),
      view_name: 'updated_manga',
    });
  }

  updatedMangaPromoted(p?: Omit<MultpornUpdatesParams, 'view_name'>) {
    return UpdatesAPI.updates(this.http, this.baseURL, {
      ...(p ?? {}),
      view_name: 'updated_manga_promoted',
    });
  }

  updatedGames(p?: Omit<MultpornUpdatesParams, 'view_name'>) {
    return UpdatesAPI.updates(this.http, this.baseURL, {
      ...(p ?? {}),
      view_name: 'updated_games',
    });
  }

  randomTopComics(p?: Omit<MultpornUpdatesParams, 'view_name'>) {
    return UpdatesAPI.updates(this.http, this.baseURL, {
      ...(p ?? {}),
      view_name: 'random_top_comics',
    });
  }

  topRandomCharacters(p?: Omit<MultpornUpdatesParams, 'view_name'>) {
    return UpdatesAPI.updates(this.http, this.baseURL, {
      ...(p ?? {}),
      view_name: 'top_random_characters',
    });
  }

  alphabetLetters(section: AlphabetSection): Promise<AlphabetLetter[]> {
    return AlphabetAPI.alphabetLetters(this.http, this.baseURL, section);
  }

  alphabet(section: AlphabetSection, letter: string, page = 0): Promise<Page<ListingItem>> {
    return AlphabetAPI.alphabetItems(this.http, this.baseURL, section, letter, page);
  }
}

export { MultpornClient as MultpornClientCore };

export default MultpornClient;

export type ListingItem = {
  title: string;
  url: string;
  thumb?: string;
  proxiedThumb?: string;
};

export type Page<T> = {
  page: number;
  items: T[];
  hasNext: boolean;
  totalPages?: number;
  pageSize?: number;
  alphabet?: AlphabetBlock;
};

export type Post = {
  title: string;
  url: string;
  images: string[];
  tags: string[];
  author: string | null;
};

export type ViewName =
  | 'new_mini'
  | 'user_upload_front'
  | 'updated_manga'
  | 'updated_manga_promoted'
  | 'updated_games'
  | 'random_top_comics'
  | 'top_random_characters';

export type UpdatesResult = {
  items: ListingItem[];
  first: number;
  last: number;
  html: string;
  viewName: string;
};

export type MultpornUpdatesParams = {
  first?: number;
  last?: number;
  view_args?: string;
  view_path?: string;
  view_base_path?: string;
  view_display_id?: string;
  view_name?: ViewName | string;
  jcarousel_dom_id?: string | number;
};

export type ResolvedListingRoute = {
  route: 'listing';
  data: Page<ListingItem> & {
    absoluteUrl: string;
    path: string;
  };
};

export type ResolvedViewerRoute = {
  route: 'viewer';
  data: {
    absoluteUrl: string;
    viewer: {
      kind: 'images' | 'video' | 'other';
      images?: Array<{ original?: string; large?: string; medium?: string; small?: string; thumb?: string; proxied?: string }>;
      video?: {
        poster?: string;
        sources: Array<{ url?: string; proxied?: string; type?: string; label?: string }>;
      };
      meta?: Record<string, unknown>;
    };
    recommendations?: ListingItem[];
  };
};

export type ResolvedRoute = ResolvedListingRoute | ResolvedViewerRoute;

export type AlphabetSection =
  | 'comics'
  | 'category_comic'
  | 'characters'
  | 'authors_comics'
  | 'pipictures'
  | 'porn_gifs'
  | 'manga'
  | 'authors_hentai';

export type AlphabetLetter = {
  label: string;
  value: string;
  href: string;
  count?: number;
  active?: boolean;
};

export interface AlphabetBlock {
  section: string;
  letters: AlphabetLetter[];
}

export type LinkItem = { title: string; url: string };

export type ViewerKind =
  | 'manga'
  | 'comics'
  | 'pictures'
  | 'humor'
  | 'video'
  | 'game'
  | 'other'
  | 'images';

export interface ViewerImage {
  original: string;
  large?: string;
  medium?: string;
  small?: string;
  thumb?: string;
  proxied?: string;
}

export interface ViewerVideoSource {
  url: string;
  type?: string;
  label?: string;
  proxied?: string;
}

export interface ViewerVideo {
  poster?: string;
  sources: ViewerVideoSource[];
}

export interface ViewerMeta {
  nodeId: number | null;
  fieldSys: string | null;

  title: string;
  kind: ViewerKind;
  breadcrumbs: LinkItem[];
  authors: LinkItem[];
  sections: LinkItem[];
  tags: LinkItem[];
  rating?: number;
  votes?: number;
  views?: number;
  related?: LinkItem[];
}

export interface ViewerResult {
  kind: ViewerKind;
  meta: ViewerMeta;
  images?: ViewerImage[];
  video?: ViewerVideo;
}

export type ListingPayload = {
  page: Page<ListingItem>;
  absoluteUrl: string;
  path: string;
  title?: string;
  breadcrumbs?: LinkItem[];
};

export type ViewerPayload = {
  viewer: ViewerResult;
  absoluteUrl: string;
  path: string;
  recommendations?: ListingItem[];
};

export interface ResolveOptions {
  proxyImage?: (url: string) => string;
  proxyVideo?: (url: string) => string;
  signal?: AbortSignal;
}

# @e18lab/multporn-api

**Unofficial** HTML scraper for Multporn (Node 18+). Supports hub pagination (`/comic`, `/munga`, etc.), **alphabet** views, **search** (HTML and Drupal AJAX), **posts** (images, video metadata, related), plus a smart resolver to tell whether a link is a hub or a post.

> ⚠️ This library is an unofficial scraper. Use responsibly, respect the target’s terms/robots, and add caching/throttling in production.

---

## Installation

```bash
yarn add @e18lab/multporn-api
# or
npm i @e18lab/multporn-api
````

Node v24.11.0 is required.

---

## Quick start

```ts
import { MultpornClient } from '@e18lab/multporn-api';

const mp = new MultpornClient({
  baseURL: 'https://multporn.net', // default
  timeoutMs: 15000,
  retry: { retries: 3 },
});

// Latest posts (homepage “New”)
const latest = await mp.latest(0);
console.log('latest:', latest.items.slice(0, 3));

// “Manga” hub
const manga = await mp.listByPath('/munga', 0);
console.log('manga page0 items:', manga.items.length, 'hasNext:', manga.hasNext);

// Alphabet: letters for Manga
const letters = await mp.alphabetLetters('manga');
console.log('letters:', letters.map(l => l.label).join(' '));

// Alphabet: entries for letter A
const mangaA = await mp.alphabet('manga', 'A', 0);
// same via listByPath:
const mangaA2 = await mp.listByPath('/munga', 0, { letter: 'A' });

// Search
const found = await mp.search('naruto', 0);
console.log('found:', found.items.slice(0, 3));

// Post (URL or relative slug)
const post = await mp.getPost('/comics/haywire'); // full URL is also fine
console.log(post.title, 'images:', post.images?.length || 0);

// Smart resolve: detect hub vs post
const resolved = await mp.resolveSmart('https://multporn.net/munga');
if (resolved.route === 'listing') {
  console.log('This is a hub. items:', resolved.data.items.length);
} else if (resolved.route === 'viewer') {
  console.log('This is a post. kind:', resolved.data.viewer.kind);
}
```

---

## API Overview

### Constructor

```ts
new MultpornClient(options?: {
  baseURL?: string;         // default: https://multporn.net
  timeoutMs?: number;       // request timeout
  retry?: { retries?: number };
  headers?: Record<string, string>;
})
```

### Client methods

```ts
latest(page?: number, params?: ListingQuery): Promise<Page<ListingItem>>

listByPath(
  path: string,
  page?: number,
  params?: ListingQuery & { letter?: string },
): Promise<Page<ListingItem>>

search(query: string, page?: number): Promise<Page<ListingItem>>

getPost(urlOrSlug: string): Promise<Post>

resolve(urlOrSlug: string, opts?: ResolveOptions): Promise<ViewerResult>

resolveSmart(urlOrSlug: string, opts?: ResolveOptions): Promise<ResolvedRoute>

updates(params?: MultpornUpdatesParams): Promise<UpdatesResult>

viewUpdates(viewName: ViewName, params?: Omit<MultpornUpdatesParams, 'view_name'>): Promise<UpdatesResult>

alphabetLetters(section: 'comics' | 'manga' | 'pictures' | 'video' | 'games'): Promise<AlphabetLetter[]>

alphabet(section: AlphabetSection, letter: string, page?: number): Promise<Page<ListingItem>>
```

### Key types (simplified)

```ts
type ListingItem = {
  title: string;
  url: string;
  thumb?: string;
};

type Page<T> = {
  items: T[];
  page: number;
  hasNext: boolean;
  totalPages: number;
};

type Post = {
  url: string;
  title: string;
  description?: string;
  images?: string[];
  videos?: string[];            // may be HLS files and/or direct MP4s
  thumb?: string;
  tags?: string[];
  recommendations?: ListingItem[];
};
```

---

## Pagination

All listing methods return `Page<ListingItem>` with `page`, `hasNext`, and `totalPages`.

```ts
let p = 0;
for (;;) {
  const page = await mp.listByPath('/munga', p);
  // process page.items
  if (!page.hasNext) break;
  p += 1;
}
```

---

## Search

Search uses a dual strategy: parse the regular HTML results first; if empty, fall back to Drupal AJAX (`/views/ajax`). That covers most search pages reliably.

```ts
const res = await mp.search('genshin', 0);
res.items.forEach(i => console.log(i.title, i.url, i.thumb));
```

If you want to display category badges like “Comics”, “Manga”, “Pictures”, “Gay porn comics”, derive a label from the first URL path segment (e.g. `comics`, `hentai_manga`, `pictures`, `gay_porn_comics`) and show it next to the title.

---

## Alphabet

Some hubs expose an alphabet. Use:

```ts
const letters = await mp.alphabetLetters('manga');       // list of available letters
const pageA   = await mp.alphabet('manga', 'A', 0);      // items for letter A
// or:
const pageA2  = await mp.listByPath('/munga', 0, { letter: 'A' });
```

---

## Example Dev Server

`examples/dev-server.mjs` ships a ready-to-use Express server over the SDK. It includes HTML pages for quick UI testing, REST endpoints, media proxies, and Swagger docs.

### Features

* **HTML pages**

  * `/hub?path=/munga[&letter=A][&page=0]` – hub preview with alphabet (pager hidden when there’s only one page)
  * `/viewer?url=...` – post preview (images as a gallery, videos via embedded `player.html`)
  * `/search?q=genshin[&page=0]` – search page with grouping and pagination
* **REST endpoints**

  * `/api/list` – hub listing (root `/` serves “latest”)
  * `/api/search` – search with pagination
  * `/api/resolve` – smart route detection (hub vs post)
  * `/api/post` – post details
  * `/api/updates` – Drupal Views feeds (e.g., `new_mini`, `updated_manga`, etc.)
  * `/api/alphabet/letters` – alphabet letters for a section
  * `/api/alphabet/items` – items for a letter in a section
* **Proxies**

  * `/img?url=...` – image proxy with proper `Referer`/`Origin`
  * `/vid?url=...` – video proxy with `Range` support (HLS/MP4)
  * `/raw?url=...` – raw upstream fetch
* **Docs**

  * Swagger UI at `/docs` backed by `/openapi.json` (endpoints, params, schemas, examples)

### Environment

* `BASE_URL` – upstream origin (default: `https://multporn.net`)
* `HOST` – bind host (default: `0.0.0.0`)
* `PORT` – server port (default: `5173`)
* `PUBLIC_BASE_URL` – public base URL (for links in OpenAPI/Swagger)

### Run

```bash
# 1) Build the SDK (to produce dist/*)
npm run build

# 2) Start the dev server
node examples/dev-server.mjs

# Then open:
# http://localhost:5173/docs
# http://localhost:5173/hub?path=/munga
# http://localhost:5173/search?q=genshin
# http://localhost:5173/viewer?url=https://multporn.net/comics/...
```

### REST examples

```bash
# Search
curl 'http://localhost:5173/api/search?q=genshin&page=0'

# Hub listing (page 0)
curl 'http://localhost:5173/api/list?path=/munga&page=0'

# Latest (homepage)
curl 'http://localhost:5173/api/list?page=0'

# Post
curl 'http://localhost:5173/api/post?url=https://multporn.net/comics/haywire'

# Smart resolve
curl 'http://localhost:5173/api/resolve?url=https://multporn.net/munga'
```

---

## Swagger / OpenAPI

The dev server serves an extended OpenAPI spec at `/openapi.json` and Swagger UI at `/docs`. All HTML pages and REST endpoints are listed with parameters, responses, and example payloads to simplify testing and integration.

---

## Frontend tips

* Always load thumbs through the image proxy: `/img?url=…`.
* Some cards may not have a `thumb`. Show a placeholder (e.g., “No image available”) instead of leaving the image empty.
* For search results, derive a readable badge from the first URL segment (e.g., `comics`, `hentai_manga`, `pictures`, `gay_porn_comics`) and prefix the title with it to clarify the type.

---

## Notes

* This is an **unofficial** scraper, intended for research/testing. Production usage should add caching, rate limits, retries, backoff, and robust error handling.
* If site structure changes, update parsers accordingly.
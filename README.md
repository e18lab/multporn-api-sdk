# `multporn-api-sdk`

**Unofficial** typed SDK for Multiporn HTML parsing. It works in **Node 18+** and in **Expo/React Native** (without Node-stdlib), uses `fetch` + `AbortController' (timeouts/delays), `cheerio` for parsing, supports:

* feeds/hubs (including pagination),
* **alphabetical** lists,
* **search** (HTML → fallback on Drupal AJAX),
* **posts/viewer** (images, videos, metadata, recommendations),
* "smart" route resolution (hub vs viewer).

> ⚠️ This is an **unofficial** scraper. Use it responsibly, follow the rules of the site and add cache/throttling in production.

---

## Installation

```bash
yarn add multporn-api-sdk
# or
npm i multiporn-api-sdk
```

### Requirements and compatibility

* **Node**: ≥ **18.17** ( Cheerio 1.x requirement). ([GitHub][2])
* **Expo/React Native**: compatible out of the box (the library does not use standard Node library modules that are missing from RN/Expo). Details: Expo does not supply Node-stdlib ("`node:stream`", etc.) — this is correct and expected. ([Expo Documentation][1])

---

## Quick start

### Node / Bun / Deno (Node-compatible runtime)

```ts
import { MultpornClient } from 'multporn-api-sdk';

const mp = new MultpornClient({
  baseURL: 'https://multporn.net',
  timeoutMs: 15000,
  retry: { retries: 3 },
});

const latest = await mp.latest(0);
console.log(latest.items.slice(0, 3));

const manga = await mp.listByPath('/munga', 0);
console.log(manga.items.length, manga.hasNext);

const letters = await mp.alphabetLetters('manga');
const mangaA = await mp.alphabet('manga', 'A', 0);

const found = await mp.search('naruto', 0);
console.log(found.items.slice(0, 3));

const post = await mp.getPost('/comics/haywire');
console.log(post.title, post.images?.length || 0);

const resolved = await mp.resolveSmart('https://multporn.net/munga ');
if (resolved.route === 'listing') {
console.log('Hub, elements:', resolved.data.items.length);
} else {
  console.log('Post, type:', resolved.data.viewer.kind);
}
```

### Expo / React Native

The library uses **only the Web API** (`fetch`, `AbortController') and does not pull `node:*`, so it can be connected directly:

```ts
import { MultpornClient } from 'multporn-api-sdk';

const mp = new MultpornClient({ timeoutMs: 15000 });

export async function fetchLatest() {
  const page0 = await mp.latest(0);
  return page0.items; // draw a FlatList, etc.
}
```

> Note: Expo/RN does not contain modules of the Node standard library (for example, `node:stream`). This is standard: choose libraries that are independent of Node-stdlib (like this SDK). ([Expo Documentation][1])

---

## API (overview)

```ts
new MultpornClient(options?: {
  baseURL?: string;
  timeoutMs?: number;
  retry?: { retries?: number; factor?: number; minDelayMs?: number; maxDelayMs?: number };
  headers?: Record<string, string>;
  userAgent?: string;
})

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

alphabetLetters(section: AlphabetSection): Promise<AlphabetLetter[]>

alphabet(section: AlphabetSection, letter: string, page?: number): Promise<Page<ListingItem>>
```

### Important types (simplified)

```ts
type ListingItem = { title: string; url: string; thumb?: string; };

type Page<T> = {
  items: T[];
  page: number;
  hasNext: boolean;
  totalPages?: number;
  pageSize?: number;
  alphabet?: AlphabetBlock;
  sorting?: SortingUI;
};

type Post = {
  title: string;
  url: string;
  images: string[];
  tags: string[];
  author: string | null;
};
```

---

## Pagination

```ts
let p = 0;
for (;;) {
  const page = await mp.listByPath('/munga', p);
  // processing of page.items
  if (!page.hasNext) break;
  p += 1;
}
```

---

## Search

First, the usual HTML output is parsed; if empty, Drupal AJAX (`/views/ajax`) is used. This covers different search patterns.

```ts
const res = await mp.search('genshin', 0);
res.items.forEach(i => console.log(i.title, i.url, i.thumb));
```

---

## Alphabet

```ts
const letters = await mp.alphabetLetters('manga');
const pageA   = await mp.alphabet('manga', 'A', 0);

// Equivalent via listByPath:
const pageA2  = await mp.listByPath('/munga', 0, { letter: 'A' });
```

---

## Updates (Drupal Views)

``ts
// universal
const upd = await mp.updates({ view_name: 'new_mini', first: 0, last: 8 });

// or wrapper presets
await mp.viewUpdates('updated_manga');
await mp.viewUpdates('random_top_comics');
```

---

## Example of a dev server (for testing the SDK in the repository)

The repo has an example of an Express server with HTML pages and REST endpoints (Swagger/OpenAPI). It is **not required** for the Expo application, but it is convenient for debugging in a Node environment.

```bash
#1) Build SDK (dist/*)
npm run build

#2) Run an example
node examples/dev-server.mjs

# Open:
# http://localhost:5173/docs
# http://localhost:5173/hub?path=/munga
# http://localhost:5173/search?q=genshin
# http://localhost:5173/viewer?url=https://multporn.net/comics/...
```

---

## License

MIT
# @e18lab/multporn-api

**Unofficial** HTML scraper for Multporn (Node 18+). It can paginate hubs (/comic, /munga, etc.), work with the **alphabet**, search, fetch posts (images and video metadata), and also *smartly* determine whether a link is a hub or a specific post.

## Installation

```bash
yarn add @e18lab/multporn-api
# or
npm i @e18lab/multporn-api
```

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

// “Manga” alphabet: letters
const letters = await mp.alphabetLetters('manga');
console.log('letters:', letters.map(l => l.label).join(' '));

// “Manga” alphabet: entries for letter A
const mangaA = await mp.alphabet('manga', 'A', 0);
// same via listByPath:
const mangaA2 = await mp.listByPath('/munga', 0, { letter: 'A' });

// Search
const found = await mp.search('naruto', 0);
console.log('found:', found.items.slice(0, 3));

// Post (URL or relative slug)
const post = await mp.getPost('/comics/haywire'); // full URL also works
console.log(post.title, 'images:', post.images?.length || 0);

// Smart-resolve: figures out whether it’s a hub or a post
const resolved = await mp.resolveSmart('https://multporn.net/munga');
if (resolved.route === 'listing') {
  console.log('This is a hub. items:', resolved.data.items.length);
} else if (resolved.route === 'viewer') {
  console.log('This is a post. kind:', resolved.data.viewer.kind);
}
```

## Dev server example

`examples/dev-server.mjs` ships a ready-to-use Express server:

* `/hub?path=/munga[&letter=A][&page=0]` — hub preview with alphabet; hides the pager when there’s only one page
* `/viewer?url=...` — post preview (videos via the embedded `player.html`, images as a gallery)
* `/img?url=...` and `/vid?url=...` — media proxies (set proper Referer/Origin; `/vid` supports HLS and Range)
* REST endpoints: `/api/list`, `/api/search`, `/api/resolve`, `/api/alphabet/*`, `/api/post`, `/api/updates`

Run:

```bash
node examples/dev-server.mjs
```
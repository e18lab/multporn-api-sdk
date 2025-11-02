# @your-scope/multporn-api

**Неофициальный** HTML‑скрейпер для Multporn (Node 18+). Позволяет искать публикации, листать ленту, получать изображения из поста. Пакет не содержит явного контента — только код для парсинга публичных страниц.

> ⚠️ **Дисклеймер**: Используйте на свой риск, соблюдайте условия сайта, robots.txt и законы вашей юрисдикции. Ограничивайте скорость запросов и кэшируйте результаты.

## Установка

```bash
yarn add @your-scope/multporn-api
# или
npm i @your-scope/multporn-api
```

## Быстрый старт

```ts
import { MultpornClient } from '@your-scope/multporn-api';

const mp = new MultpornClient({
  baseURL: 'https://multporn.net', // по умолчанию
  timeoutMs: 15000,
  retry: { retries: 3 },
});

// Последние публикации (главная)
const latest = await mp.latest(0);
console.log(latest.items.slice(0, 5));

// Поиск
const found = await mp.search('naruto', 0);

// Пост (url или относительный slug)
const post = await mp.getPost('/post/some-slug'); // или полная ссылка
console.log(post.title, post.images.length);
```

## API

```ts
class MultpornClient {
  constructor(opts?: {
    baseURL?: string; // 'https://multporn.net' по умолчанию
    headers?: Record<string, string>;
    timeoutMs?: number; // 15s по умолчанию
    retry?: {
      retries?: number;
      factor?: number;
      minDelayMs?: number;
      maxDelayMs?: number;
      retryOn?: (status?: number) => boolean;
    };
    userAgent?: string; // нативный браузер UA по умолчанию
  });

  latest(page?: number): Promise<Page<ListingItem>>;
  search(query: string, page?: number): Promise<Page<ListingItem>>;
  byTag(tagSlug: string, page?: number): Promise<Page<ListingItem>>;
  getPost(urlOrSlug: string): Promise<Post>;
}

type ListingItem = { title: string; url: string; thumb?: string; tags?: string[] };
type Post = {
  title: string;
  url: string;
  images: string[];
  tags?: string[];
  author?: string | null;
};
type Page<T> = { items: T[]; page: number; hasNext: boolean };
```

## Сборка и тесты

```bash
yarn install
yarn build
yarn test
```

## Публикация

```bash
yarn npm login
yarn publish --access public
```

## Практические советы

- Добавьте локальный кэш (например, `keyv`) чтобы не дёргать страницу повторно.
- Рейтлимит (например, `p-limit` или очередь) если планируете массовое сканирование.
- Структура страниц может меняться — держите парсеры изолированными и покрывайте тестами.
- Если сайт отдаёт WebP/AVIF — используйте конвертацию на стороне вашего приложения при необходимости.

### Updates (jcarousel)

```ts
const { items } = await mp.updates({ first: 1, last: 8 });
console.log(items[0]); // { title, url, thumb }
```

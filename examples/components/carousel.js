class MPBlobImageCache {
  constructor(limit = 200) {
    this.limit = limit;
    /** @type {Map<string, {blobUrl?:string, promise?:Promise<string>}>} */
    this.map = new Map();
    window.addEventListener('beforeunload', () => this.clear());
  }
  _touch(key) {
    const v = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, v);
  }
  _evict() {
    while (this.map.size > this.limit) {
      const [oldKey, oldVal] = this.map.entries().next().value;
      if (oldVal?.blobUrl) URL.revokeObjectURL(oldVal.blobUrl);
      this.map.delete(oldKey);
    }
  }
  clear() {
    for (const [, v] of this.map) if (v?.blobUrl) URL.revokeObjectURL(v.blobUrl);
    this.map.clear();
  }
  async get(url) {
    if (!url) throw new Error('Empty URL');
    const hit = this.map.get(url);
    if (hit?.blobUrl) {
      this._touch(url);
      return hit.blobUrl;
    }

    if (!hit?.promise) {
      const p = fetch(url, { cache: 'default', credentials: 'omit', mode: 'cors' })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.blob();
        })
        .then((blob) => {
          const obj = URL.createObjectURL(blob);
          const slot = this.map.get(url) || {};
          if (slot.blobUrl && slot.blobUrl !== obj) URL.revokeObjectURL(slot.blobUrl);
          this.map.set(url, { blobUrl: obj });
          this._touch(url);
          this._evict();
          return obj;
        })
        .catch((err) => {
          this.map.delete(url);
          throw err;
        });
      this.map.set(url, { promise: p });
    }
    return this.map.get(url).promise;
  }
  prime(url) {
    if (!url) return;
    this.get(url).catch(() => {});
  }
}

if (!window.MPImageCache) window.MPImageCache = new MPBlobImageCache(200);

class MPCarousel extends HTMLElement {
  static get observedAttributes() {
    return ['preload', 'start'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    /** @type {{src:string, thumb?:string}[]} */ this._items = [];
    this._index = 0;
    this._preload = 3;
    this._thumbIO = null;
    this._loadToken = 0;

    this.shadowRoot.innerHTML = /*html*/ `
      <style>
        :host{
          --bg:#0b0f15; --card:#0f141c; --line:rgba(255,255,255,.08);
          --fg:#e6edf3; --muted:#8b949e; --accent:#58a6ff;
          display:block; user-select:none; -webkit-user-select:none; outline:none;
        }
        .wrap{ background:var(--card); border:1px solid var(--line);
               border-radius:12px; overflow:hidden; }
        .stage{ position:relative; background:#000; min-height:46vh; }
        .stage .inner{
          display:grid; place-items:center; width:100%; height:100%; background:#000;
        }
        .stage .inner { cursor: crosshair; }
        .stage img.main{
          max-width:100%; max-height:76vh; width:auto; height:auto;
          image-rendering:auto; -webkit-user-drag:none; user-drag:none; background:#000;
        }
        .film{
          display:flex; gap:8px; align-items:center;
          height:96px; padding:8px;
          overflow-x:auto; overflow-y:hidden; scrollbar-gutter:stable;
          background:#0c1118; border-top:1px solid var(--line);
        }
        .film:focus{ outline:none; }
        .film::-webkit-scrollbar{ height:8px }
        .film::-webkit-scrollbar-thumb{ background:rgba(255,255,255,.15); border-radius:8px }
        .thumb{
          flex:0 0 auto; width:72px; height:72px; border-radius:8px;
          border:1px solid var(--line); background:#0b0f15;
          display:grid; place-items:center; cursor:pointer; position:relative;
          overflow:hidden; content-visibility:auto;
        }
        .thumb img{ width:100%; height:100%; object-fit:cover; display:block }
        .thumb[aria-current="true"]{ outline:2px solid var(--accent); outline-offset:0 }
        .thumb::after{
          content:attr(data-page);
          position:absolute; right:6px; bottom:4px;
          font:600 11px/1 system-ui,Segoe UI,Roboto;
          background:rgba(0,0,0,.55); color:#fff; padding:2px 6px; border-radius:999px;
        }
      </style>
      <div class="wrap" part="wrap">
        <div class="stage" part="stage" id="stage">
          <div class="inner" id="stageInner" title="Лево/право — листать, центр — на весь экран">
            <img class="main" id="main" alt="page" referrerpolicy="no-referrer" />
          </div>
        </div>
        <div class="film" part="film" id="film" tabindex="0" aria-label="Pages thumbnails"></div>
      </div>
    `;

    this.$film = this.shadowRoot.getElementById('film');
    this.$stage = this.shadowRoot.getElementById('stage');
    this.$stageInner = this.shadowRoot.getElementById('stageInner');
    this.$main = this.shadowRoot.getElementById('main');

    if (!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '0');
    if (!this.hasAttribute('role')) this.setAttribute('role', 'region');
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'Image carousel');

    const onKey = (e) => {
      if (e.key === 'ArrowRight') {
        this.next();
        e.preventDefault();
      } else if (e.key === 'ArrowLeft') {
        this.prev();
        e.preventDefault();
      }
    };
    this.addEventListener('keydown', onKey);
    this.$film.addEventListener('keydown', onKey);

    this.$stageInner.addEventListener('click', (e) => {
      const rect = this.$stage.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = rect.width > 0 ? x / rect.width : 0.5;
      if (ratio < 0.33) this.prev();
      else if (ratio > 0.67) this.next();
      else {
        this.dispatchEvent(
          new CustomEvent('request-fullscreen', {
            detail: { index: this._index, items: this._items.slice() },
            bubbles: true,
            composed: true,
          }),
        );
      }
    });

    let touchX = null;
    this.addEventListener(
      'touchstart',
      (e) => {
        touchX = e.touches?.[0]?.clientX ?? null;
      },
      { passive: true },
    );
    this.addEventListener(
      'touchend',
      (e) => {
        if (touchX == null) return;
        const dx = (e.changedTouches?.[0]?.clientX ?? touchX) - touchX;
        if (Math.abs(dx) > 50) dx < 0 ? this.next() : this.prev();
        touchX = null;
      },
      { passive: true },
    );

    if ('IntersectionObserver' in window) {
      this._thumbIO = new IntersectionObserver(
        (entries) => {
          for (const ent of entries) {
            if (!ent.isIntersecting) continue;
            const img = ent.target;
            if (img.dataset.src && !img.src) img.src = img.dataset.src;
            this._thumbIO.unobserve(img);
          }
        },
        { root: this.$film, rootMargin: '200px' },
      );
    }
  }

  attributeChangedCallback(name, _old, val) {
    if (name === 'preload') {
      const n = parseInt(val, 10);
      if (Number.isFinite(n)) this._preload = Math.max(0, Math.min(6, n));
    }
    if (name === 'start') {
      const i = parseInt(val, 10);
      if (Number.isFinite(i)) this.go(i);
    }
  }

  setImages(arr = []) {
    const items = Array.from(arr || [])
      .map(String)
      .filter(Boolean)
      .map((src) => ({ src }));
    this.setItems(items, parseInt(this.getAttribute('start') || '0', 10) || 0);
  }
  set images(arr) {
    this.setImages(arr);
  }
  get index() {
    return this._index;
  }
  getItems() {
    return this._items.slice();
  }

  setItems(items = [], start = 0) {
    const norm = [];
    for (const it of items || []) {
      if (!it) continue;
      if (typeof it === 'string') norm.push({ src: it });
      else if (typeof it === 'object') {
        const src = String(it.src || it.url || '');
        if (!src) continue;
        const thumb = it.thumb ? String(it.thumb) : undefined;
        norm.push({ src, thumb });
      }
    }
    this._items = norm;
    this._buildFilmstrip();
    const s = Number.isFinite(start) ? start : 0;
    this.go(s);
  }

  next() {
    this.go(this._index + 1);
  }
  prev() {
    this.go(this._index - 1);
  }

  async go(i) {
    if (!this._items.length) return;
    const max = this._items.length - 1;
    this._index = Math.max(0, Math.min(max, i | 0));
    const url = this._items[this._index].src;

    const token = ++this._loadToken;
    try {
      const blobUrl = await window.MPImageCache.get(url);
      if (this._loadToken === token) {
        if (this.$main.src !== blobUrl) this.$main.src = blobUrl;
        this.$main.alt = `page ${this._index + 1} of ${this._items.length}`;
      }
    } catch {
      if (this._loadToken === token) this.$main.src = url;
    }

    this._markCurrentThumb();
    this._preloadAround(this._index);

    this.dispatchEvent(new CustomEvent('change', { detail: { index: this._index, url } }));
  }

  _markCurrentThumb() {
    const thumbs = this.$film.querySelectorAll('.thumb');
    thumbs.forEach((t, idx) => t.setAttribute('aria-current', String(idx === this._index)));
    const cur = thumbs[this._index];
    if (cur) {
      const cb = cur.getBoundingClientRect();
      const fb = this.$film.getBoundingClientRect();
      if (cb.left < fb.left || cb.right > fb.right) {
        cur.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  _preloadAround(i) {
    const preload = Math.max(0, this._preload);
    for (let d = 1; d <= preload; d++) {
      const a = i + d,
        b = i - d;
      if (a < this._items.length) window.MPImageCache.prime(this._items[a].src);
      if (b >= 0) window.MPImageCache.prime(this._items[b].src);
    }
  }

  _buildFilmstrip() {
    this.$film.innerHTML = '';
    this._items.forEach((it, i) => {
      const btn = document.createElement('button');
      btn.className = 'thumb';
      btn.type = 'button';
      btn.dataset.page = String(i + 1);
      btn.setAttribute('aria-current', 'false');
      btn.addEventListener('click', () => this.go(i));

      const img = document.createElement('img');
      img.alt = `thumb ${i + 1}`;
      img.decoding = 'async';
      img.loading = 'lazy';
      img.draggable = false;
      img.dataset.src = it.thumb || it.src;

      btn.appendChild(img);
      this.$film.appendChild(btn);

      if (this._thumbIO) this._thumbIO.observe(img);
      else img.src = it.thumb || it.src;
    });
  }
}

if (!customElements.get('image-carousel')) {
  customElements.define('image-carousel', MPCarousel);
}
if (!customElements.get('mp-carousel')) {
  class MPCarouselAlias extends MPCarousel {}
  customElements.define('mp-carousel', MPCarouselAlias);
}

export default MPCarousel;

class AppHeader extends HTMLElement {
  static get observedAttributes() {
    return ['title', 'nosticky'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._closeTimers = new WeakMap();
  }

  connectedCallback() {
    this.#render();
    this.#wireGlobals();
    this.#updateActiveLinks();
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.#render(true);
      this.#updateActiveLinks();
    }
  }

  #wireGlobals() {
    const sr = this.shadowRoot;

    sr.addEventListener('click', (e) => {
      const a = e.composedPath().find((el) => el?.tagName === 'A');
      if (!a || !a.href) return;
      try {
        const u = new URL(a.href, location.origin);
        if (u.origin === location.origin) {
          window.dispatchEvent(new CustomEvent('app-nav-start', { detail: { href: u.href } }));
        }
      } catch {}
    });

    sr.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.#closeAll();
    });

    document.addEventListener('click', (evt) => {
      const within = evt.composedPath().includes(this);
      if (!within) this.#closeAll();
    });

    window.addEventListener('popstate', () => this.#updateActiveLinks());
  }

  #closeAll() {
    const sr = this.shadowRoot;
    sr.querySelectorAll('.has-sub[aria-expanded="true"]').forEach((li) => {
      li.setAttribute('aria-expanded', 'false');
    });
    const drawer = sr.getElementById('drawer');
    const burger = sr.getElementById('burger');
    if (drawer) drawer.removeAttribute('data-open');
    if (burger) burger.setAttribute('aria-expanded', 'false');
    sr.querySelectorAll('.m-item[aria-expanded="true"]').forEach((li) =>
      li.setAttribute('aria-expanded', 'false'),
    );
  }

  #toggleDrawer() {
    const sr = this.shadowRoot;
    const drawer = sr.getElementById('drawer');
    const burger = sr.getElementById('burger');
    const open = drawer.hasAttribute('data-open');
    if (open) {
      drawer.removeAttribute('data-open');
      burger.setAttribute('aria-expanded', 'false');
      sr.querySelectorAll('.m-item[aria-expanded="true"]').forEach((li) =>
        li.setAttribute('aria-expanded', 'false'),
      );
    } else {
      drawer.setAttribute('data-open', '');
      burger.setAttribute('aria-expanded', 'true');
    }
  }

  #render() {
    const nosticky = this.hasAttribute('nosticky');

    const data = [
      { label: 'Home', href: '/' },

      {
        label: 'Сomics',
        href: '/viewer?path=/comic',
        sub: [
          { label: 'By Tags', href: '/viewer?path=/category_comic' },
          { label: 'By User Tags', href: '/viewer?path=/user_tags' },
          { label: 'By Characters', href: '/viewer?path=/characters' },
          { label: 'By Author', href: '/viewer?path=/authors_comics' },
          { label: 'Comics Russian', href: '/viewer?path=/comics_rus' },
          { label: 'Comics Deutsch', href: '/viewer?path=/comics_de' },
          { label: 'Comics Chinese', href: '/viewer?path=/comics_zh' },
        ],
      },

      { label: 'Uploads 🚀', href: '/viewer?path=/user_content' },

      {
        label: 'Pictures',
        href: '/viewer?path=/pipictures',
        sub: [
          { label: 'Pictures 2', href: '/viewer?path=/pictures_2' },
          { label: 'Rule 63', href: '/viewer?path=/rule_63' },
          { label: 'Hentai Pictures', href: '/viewer?path=/hentai_pipictures' },
          { label: 'GIF', href: '/viewer?path=/porn_gifs' },
          { label: 'Artist albums', href: '/viewer?path=/authors' },
        ],
      },

      {
        label: 'Manga',
        href: '/viewer?path=/munga',
        sub: [
          { label: 'By Tags', href: '/viewer?path=/manga_tags' },
          { label: 'By Characters', href: '/viewer?path=/characters_hentai' },
          { label: 'By Author', href: '/viewer?path=/authors_hentai' },
        ],
      },

      { label: 'Humor', href: '/viewer?path=/humor' },

      {
        label: 'Video',
        href: '/viewer?path=/video',
        sub: [
          { label: 'Video tags', href: '/viewer?path=/video_tags' },
          { label: 'Video authors', href: '/viewer?path=/video_authors' },
          { label: 'Hentai video', href: '/viewer?path=/hentai_videos' },
        ],
      },

      {
        label: 'Best',
        href: '/viewer?path=/bebest',
      },

      {
        label: 'New',
        href: '/viewer?path=/new',
        sub: [
          { label: 'Updated Comics', href: '/viewer?path=/updated_comics' },
          { label: 'Updated Manga', href: '/viewer?path=/updated_manga' },
        ],
      },

      { label: 'Random', href: '/viewer?path=/random' },

      {
        label: 'Search',
        href: '/search',
        external: true,
        sub: [
          { label: 'Search old', href: '/search-old' },
          { label: 'Sort comics', href: '/viewer?path=/sort_comics' },
        ],
      },
    ];

    const sr = this.shadowRoot;
    const esc = (s) =>
      String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

    const renderSub = (arr) => {
      if (!arr?.length) return '';
      return `
        <div class="submenu" role="menu">
          <ol class="submenu-col">
            ${arr
              .map((it) => {
                const isExt = !!it.external || /^https?:\/\//i.test(it.href || '');
                const target = isExt ? ' target="_blank" rel="noopener"' : '';
                return `<li class="subitem" role="none">
                  <a class="navlink sub" role="menuitem" href="${esc(it.href)}"${target} title="${esc(
                    it.title || it.label,
                  )}">${esc(it.label)}</a>
                </li>`;
              })
              .join('')}
          </ol>
        </div>`;
    };

    const renderItem = (it, idx) => {
      const hasSub = Array.isArray(it.sub) && it.sub.length > 0;
      const isExt = !!it.external || /^https?:\/\//i.test(it.href || '');
      const target = isExt ? ' target="_blank" rel="noopener"' : '';
      const cls = ['item'];
      if (hasSub) cls.push('has-sub');
      const id = `mi-${idx}`;
      return `
        <li class="${cls.join(' ')}" role="none" ${hasSub ? 'aria-expanded="false"' : ''}>
          <a class="navlink top"
             role="menuitem"
             aria-haspopup="${hasSub ? 'true' : 'false'}"
             data-path="${esc(this.#guessPath(it.href))}"
             id="${id}"
             href="${esc(it.href)}"${target}>
            ${esc(it.label)}
            ${hasSub ? '<span class="caret" aria-hidden>▾</span>' : ''}
          </a>
          ${hasSub ? renderSub(it.sub) : ''}
          ${hasSub ? `<button class="sub-toggle" aria-controls="${id}" aria-label="Открыть подменю"></button>` : ''}
        </li>`;
    };

    const htmlMenu = data.map((it, i) => renderItem(it, i)).join('');

    sr.innerHTML = `
      <style>
        :host {
          --bg: #0e1117;
          --fg: #e6edf3;
          --muted: #8b949e;
          --card: #161b22;
          --accent: #58a6ff;
          --accent-hover: #79b8ff;
          --border: rgba(255, 255, 255, 0.08);
          --tag-bg: #1a2230;
          --tag-hover: #232c3d;
          --shadow: 0 10px 30px rgba(0,0,0,.45);
          display: block;
        }
        header.hdr {
          ${nosticky ? 'position:static;' : 'position:sticky; top:0;'}
          z-index: 1000;
        }
        .bar {
            display: flex;
            align-items: center;
            gap: 12px;
            max-width: 1240px;
            margin: 0 auto;
            padding: 10px 16px;
            justify-content: flex-end;
        }

        .burger {
          width:38px; height:34px; border-radius:10px;
          display:none; place-items:center;
          background: var(--tag-bg); color: var(--fg);
          border:1px solid var(--border);
          flex:0 0 auto;
          transition: background .2s, border-color .2s, transform .15s;
        }
        .burger:active { transform: translateY(1px); }
        .burger:hover { background: var(--tag-hover); border-color: var(--accent); }
        .burger svg { width:20px; height:20px; }

        .mainWrap { flex: 1 1 auto; min-width: 0; }
        nav.main {
            width: 100%;
            display: flex;
            justify-content: center;
        }
        ul.menu {
          display:flex;
          flex-wrap: wrap;
          gap: 6px 8px;
          align-items: center;
          margin: 0; padding: 0; list-style: none;
        }
        li.item { position: relative; }

        a.navlink.top {
          display:inline-flex; align-items:center; gap:6px;
          padding:8px 12px;
          border-radius:12px;
          color:var(--fg); text-decoration:none; font-size:13px;
          border:1px solid var(--border);
          background: var(--tag-bg);
          transition: background .2s, border-color .2s, box-shadow .2s, transform .05s;
          white-space: nowrap;
          line-height: 1;
        }
        a.navlink.top:hover { background: var(--tag-hover); border-color: var(--accent); }
        a.navlink.top:active { transform: translateY(1px); }
        a.navlink[aria-current="page"] {
          color: var(--accent);
          border-color: var(--accent);
        }
        a.navlink[aria-current="page"] span {
          color: var(--accent);
        }
        .caret { opacity:.85; transform: translateY(-1px); font-size: 12px; }

        .has-sub .submenu {
          position: absolute; left: 0; top: 100%;
          margin-top: 6px;
          min-width: max-content; max-width: 360px;
          background: #0b1018;
          border:1px solid var(--border);
          border-radius:12px; padding:10px;
          box-shadow: var(--shadow);
          display: none;
          z-index: 20;
          animation: sb-in .12s ease-out;
        }
        @keyframes sb-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .has-sub[aria-expanded="true"] > .submenu { display:block; }
        .submenu-col { list-style:none; margin:0; padding:0; display:grid; gap:4px; }
        a:-webkit-any-link {
            text-decoration: none;
        }
        a.navlink.sub {
          display:block; padding:8px 10px; border-radius:8px; font-size:13px;
          color:var(--fg); text-decoration:none; border:1px solid transparent;
          transition: background .2s, border-color .2s;
        }
        a.navlink.sub:hover { background: var(--tag-hover); border-color: var(--border); }

        .sub-toggle {
          position:absolute; right:4px; top:4px;
          width:24px; height:24px; border-radius:8px;
          border:1px solid var(--border); background: var(--tag-bg);
          display:none;
        }

        .drawer {
          display:none;
          border-top:1px solid var(--border);
          background: rgba(10,13,19,.98);
        }
        .drawer[data-open] { display:block; }
        .m-list { list-style:none; margin:0; padding:8px; display:grid; gap:8px; }
        .m-item { border:1px solid var(--border); border-radius:12px; background: var(--card); overflow: hidden; }
        .m-head {
          display:flex; align-items:center; justify-content:space-between; gap:8px;
          padding:12px 14px; cursor:pointer;
        }
        .m-head .lbl { 
          font-size: 14px;
          color: white;
          font-weight: 500; 
        }
        .m-head .op { opacity:.8; transition: transform .16s ease; }
        .m-item[aria-expanded="true"] .m-head .op { transform: rotate(180deg); }
        .m-sub { display:none; padding:6px 8px 10px 8px; border-top:1px solid var(--border); }
        .m-item[aria-expanded="true"] .m-sub { display:block; }
        .m-sub a { display:block; padding:9px 10px; border-radius:8px; font-size:13px; color:var(--fg); text-decoration:none; }
        .m-sub a:hover { background: var(--tag-hover); }

        @media (max-width: 540px) {
          .burger { 
            display: grid;
            width: -webkit-fill-available;
          }
          .mainWrap { display:none; }
          .sub-toggle { display:block; }
        }
      </style>

      <header class="hdr" role="banner">
        <div class="bar">
          <button class="burger" id="burger" type="button" aria-label="Меню" aria-expanded="false">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg>
          </button>

          <div class="mainWrap">
            <nav class="main" aria-label="Главная навигация" role="navigation">
              <ul class="menu" role="menubar">
                ${htmlMenu}
              </ul>
            </nav>
          </div>
        </div>

        <div class="drawer" id="drawer" role="dialog" aria-label="Меню">
          <ul class="m-list">
            ${data
              .map((it, i) => {
                const isExt = !!it.external || /^https?:\/\//i.test(it.href || '');
                const target = isExt ? ' target="_blank" rel="noopener"' : '';
                const hasSub = Array.isArray(it.sub) && it.sub.length > 0;
                const pid = `m-${i}`;
                return `
                <li class="m-item" ${hasSub ? 'aria-expanded="false"' : ''}>
                  <div class="m-head" ${hasSub ? `data-toggle="${pid}"` : ''}>
                    <a class="navlink" href="${esc(it.href)}"${target}>
                      <span class="lbl">${esc(it.label)}</span>
                    </a>
                    <span class="op" aria-hidden="true">${hasSub ? '▾' : '›'}</span>
                  </div>
                  ${
                    hasSub
                      ? `<div class="m-sub" id="${pid}">
                        ${it.sub
                          .map((s) => {
                            const ie = !!s.external || /^https?:\/\//i.test(s.href || '');
                            const t = ie ? ' target="_blank" rel="noopener"' : '';
                            return `<a class="navlink" href="${esc(s.href)}"${t}>${esc(s.label)}</a>`;
                          })
                          .join('')}
                      </div>`
                      : ''
                  }
                </li>`;
              })
              .join('')}
          </ul>
        </div>
      </header>
    `;

    this.#bindDesktopDropdowns();
    this.#bindMobile();
  }

  #bindDesktopDropdowns() {
    const sr = this.shadowRoot;

    sr.querySelectorAll('.has-sub').forEach((li) => {
      const topLink = li.querySelector('a.top');
      const toggler = li.querySelector('.sub-toggle');
      const submenu = li.querySelector('.submenu');

      const clearTimer = () => {
        const t = this._closeTimers.get(li);
        if (t) {
          clearTimeout(t);
          this._closeTimers.delete(li);
        }
      };
      const scheduleClose = () => {
        clearTimer();
        const t = setTimeout(() => {
          li.setAttribute('aria-expanded', 'false');
        }, 160);
        this._closeTimers.set(li, t);
      };

      li.addEventListener('mouseenter', () => {
        clearTimer();
        li.setAttribute('aria-expanded', 'true');
      });
      li.addEventListener('mouseleave', () => {
        scheduleClose();
      });

      li.addEventListener('focusin', () => {
        clearTimer();
        li.setAttribute('aria-expanded', 'true');
      });
      li.addEventListener('focusout', (e) => {
        const next = e.relatedTarget;
        if (!next || !li.contains(next)) scheduleClose();
      });

      if (topLink) {
        topLink.addEventListener('click', (e) => {
          const isOpen = li.getAttribute('aria-expanded') === 'true';
          const hasHref = !!topLink.getAttribute('href');
          if (!isOpen) {
            e.preventDefault();
            li.setAttribute('aria-expanded', 'true');
          } else if (hasHref && submenu) {
          }
        });
      }

      if (toggler) {
        toggler.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const isOpen = li.getAttribute('aria-expanded') === 'true';
          if (isOpen) {
            li.setAttribute('aria-expanded', 'false');
          } else {
            li.setAttribute('aria-expanded', 'true');
          }
        });
      }
    });
  }

  #bindMobile() {
    const sr = this.shadowRoot;
    const burger = sr.getElementById('burger');
    burger?.addEventListener('click', () => this.#toggleDrawer());

    sr.querySelectorAll('.m-head[data-toggle]').forEach((head) => {
      head.addEventListener('click', (e) => {
        if (e.target && e.target.tagName === 'A') return;
        const li = head.closest('.m-item');
        const isOpen = li.getAttribute('aria-expanded') === 'true';
        li.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      });
    });
  }

  #guessPath(href = '') {
    try {
      const u = new URL(href, location.origin);
      if (u.pathname === '/hub' || u.pathname === '/viewer') {
        return new URLSearchParams(u.search).get('path') || '/';
      }
      return u.pathname || '/';
    } catch {
      return '/';
    }
  }

  #updateActiveLinks() {
    const sr = this.shadowRoot;
    const url = new URL(location.href);
    const currentPath =
      url.pathname === '/hub' || url.pathname === '/viewer'
        ? new URLSearchParams(url.search).get('path') || '/'
        : url.pathname;

    sr.querySelectorAll('a.navlink').forEach((a) => {
      const p = a.getAttribute('data-path') || this.#guessPath(a.getAttribute('href') || '');
      const isActive =
        p === '/'
          ? currentPath === '/'
          : currentPath === p || currentPath.startsWith(p.endsWith('/') ? p : p + '/');

      if (isActive) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }
}

customElements.define('app-header', AppHeader);

/* OpenStickies site: nav menu, latest-release download links, screenshot lightbox, copy button.
   Everything here is progressive enhancement; the page works without it. */
(function () {
  'use strict';

  var API_URL = 'https://api.github.com/repos/ItsCetla/OpenStickies/releases/latest';
  var CACHE_KEY = 'openstickies:latest-release:v1';
  var CACHE_OK_MS = 60 * 60 * 1000;    // a found release
  var CACHE_FAIL_MS = 10 * 60 * 1000;  // 404 (nothing published yet) or 403 (rate limited)

  var root = document.documentElement;
  var $$ = function (sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); };

  /* ---------- header: scrolled state + mobile menu ---------- */
  function initHeader() {
    var header = document.querySelector('.site-header');
    if (!header) return;
    var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 4); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    var toggle = header.querySelector('.nav-toggle');
    var nav = document.getElementById('primary-nav');
    if (!toggle || !nav) return;
    var setOpen = function (open) {
      header.classList.toggle('nav-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
    };
    toggle.addEventListener('click', function () { setOpen(!header.classList.contains('nav-open')); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('click', function (e) {
      if (header.classList.contains('nav-open') && !header.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && header.classList.contains('nav-open')) { setOpen(false); toggle.focus(); }
    });
    var wide = window.matchMedia('(min-width: 820px)');
    var onWide = function () { if (wide.matches) setOpen(false); };
    if (wide.addEventListener) wide.addEventListener('change', onWide);
  }

  /* ---------- latest release ---------- */
  function readCache() {
    try {
      var raw = window.sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      var ttl = c && c.ok ? CACHE_OK_MS : CACHE_FAIL_MS;
      if (!c || typeof c.t !== 'number' || Date.now() - c.t > ttl) return null;
      return c;
    } catch (e) { return null; }
  }

  function writeCache(entry) {
    try {
      entry.t = Date.now();
      window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
    } catch (e) { /* storage blocked or full: just skip caching */ }
  }

  function pickAsset(assets, re) {
    for (var i = 0; i < assets.length; i++) {
      var a = assets[i];
      if (a && typeof a.name === 'string' && re.test(a.name) && a.browser_download_url) {
        return { name: a.name, url: a.browser_download_url, size: a.size };
      }
    }
    return null;
  }

  // The asset file names carry the app's own version (electron-builder puts it there), so they
  // win over the release tag/title, which are free text (e.g. a tag called "Release").
  function findVersion(release, files) {
    var i, m;
    for (i = 0; i < files.length; i++) {
      m = files[i] && files[i].name.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\.exe$/i);
      if (m) return m[1];
    }
    var labels = [release.tag_name, release.name];
    for (i = 0; i < labels.length; i++) {
      m = typeof labels[i] === 'string' && labels[i].match(/^v?(\d+\.\d+(?:\.\d+)?)/i);
      if (m) return m[1];
    }
    return '';
  }

  function summarize(release) {
    var assets = Array.isArray(release.assets) ? release.assets : [];
    var installer = pickAsset(assets, /setup.*\.exe$/i);
    var portable = pickAsset(assets, /portable.*\.exe$/i);
    return {
      ok: !!(installer || portable),
      version: findVersion(release, [installer, portable]),
      date: release.published_at || '',
      page: release.html_url || '',
      installer: installer,
      portable: portable
    };
  }

  function loadRelease() {
    var cached = readCache();
    if (cached) return Promise.resolve(cached.ok ? cached : null);
    if (!window.fetch) return Promise.resolve(null);

    var controller = window.AbortController ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 8000) : 0;

    return fetch(API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      // 404: no published release yet (drafts are invisible). 403/429: rate limited.
      if (!res.ok) { writeCache({ ok: false, status: res.status }); return null; }
      return res.json().then(function (data) {
        var info = summarize(data || {});
        writeCache(info);
        return info.ok ? info : null;
      });
    }).catch(function () {
      // Offline, blocked or timed out: keep the Releases-page links. Not cached, so it retries next load.
      clearTimeout(timer);
      return null;
    });
  }

  function formatSize(bytes) {
    if (typeof bytes !== 'number' || !(bytes > 0)) return '';
    var mb = bytes / 1048576;
    return (mb >= 10 ? Math.round(mb) : mb.toFixed(1)) + ' MB';
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    try {
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) { return iso.slice(0, 10); }
  }

  function applyRelease(info) {
    if (!info) return;
    var version = info.version ? 'v' + info.version : '';

    $$('[data-release-version]').forEach(function (el) {
      el.textContent = version;
      el.hidden = !version;
    });

    ['installer', 'portable'].forEach(function (kind) {
      var asset = info[kind];
      if (!asset) return;
      $$('[data-dl="' + kind + '"]').forEach(function (a) { a.href = asset.url; });
      $$('[data-dl-file="' + kind + '"]').forEach(function (el) { el.textContent = asset.name; });
      var size = formatSize(asset.size);
      $$('[data-dl-size="' + kind + '"]').forEach(function (el) { el.textContent = size; el.hidden = !size; });
    });

    var date = formatDate(info.date);
    $$('[data-release-date]').forEach(function (el) {
      el.textContent = date ? 'Released ' + date : '';
      el.hidden = !date;
    });
    if (info.page) $$('[data-release-page]').forEach(function (a) { a.href = info.page; });
    if (version) $$('[data-release-info]').forEach(function (el) { el.hidden = false; });
  }

  function initRelease() {
    if (!document.querySelector('[data-dl], [data-release-version]')) return;
    loadRelease().then(applyRelease).catch(function () { /* never surface errors */ });
  }

  /* ---------- screenshot lightbox ---------- */
  function initLightbox() {
    var links = $$('a[data-lightbox]');
    if (!links.length || typeof window.HTMLDialogElement !== 'function') return; // links still open the image

    var dialog = document.createElement('dialog');
    dialog.className = 'lightbox';
    dialog.setAttribute('aria-label', 'Screenshot');
    dialog.innerHTML =
      '<button type="button" class="lb-close" aria-label="Close">' +
      '<svg class="i" aria-hidden="true"><use href="#i-close"/></svg></button>' +
      '<figure><img alt=""><figcaption aria-hidden="true"></figcaption></figure>';
    document.body.appendChild(dialog);
    if (typeof dialog.showModal !== 'function') { dialog.remove(); return; }

    var img = dialog.querySelector('img');
    var caption = dialog.querySelector('figcaption');
    var closeBtn = dialog.querySelector('.lb-close');
    var opener = null;

    links.forEach(function (link) {
      link.addEventListener('click', function (e) {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        var thumb = link.querySelector('img');
        var text = thumb ? thumb.alt : '';
        opener = link;
        img.src = link.href;
        img.alt = text;
        caption.textContent = text;
        dialog.showModal();
        root.classList.add('lb-open');
        closeBtn.focus();
      });
    });

    // Any click closes it: the backdrop, the picture or the button. Esc closes it natively.
    dialog.addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('close', function () {
      root.classList.remove('lb-open');
      img.removeAttribute('src');
      if (opener) { opener.focus({ preventScroll: true }); opener = null; }
    });
  }

  /* ---------- copy buttons ---------- */
  function initCopy() {
    $$('[data-copy]').forEach(function (btn) {
      var target = document.getElementById(btn.getAttribute('data-copy'));
      var label = btn.querySelector('span');
      if (!target || !label || !navigator.clipboard || !window.isSecureContext) return;
      btn.hidden = false;
      var timer = 0;
      btn.addEventListener('click', function () {
        navigator.clipboard.writeText(target.textContent.trim()).then(function () {
          label.textContent = 'Copied';
        }, function () {
          label.textContent = 'Press Ctrl+C';
          var range = document.createRange();
          range.selectNodeContents(target);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }).then(function () {
          clearTimeout(timer);
          timer = setTimeout(function () { label.textContent = 'Copy'; }, 1800);
        });
      });
    });
  }

  function init() {
    initHeader();
    initRelease();
    initLightbox();
    initCopy();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

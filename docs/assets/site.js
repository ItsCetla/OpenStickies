/* OpenStickies site: nav menu, download links for this computer and the latest release, Mac
   shortcut labels, screenshot lightbox, copy button.
   Everything here is progressive enhancement; the page works without it. */
(function () {
  'use strict';

  var API_URL = 'https://api.github.com/repos/ItsCetla/OpenStickies/releases/latest';
  var CACHE_KEY = 'openstickies:latest-release:v2'; // v2: every platform's files
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

  /* ---------- which computer is this? ---------- */
  // 'windows' | 'mac' | 'linux' | '' (phones, tablets, ChromeOS and anything unknown).
  function detectOS() {
    var nav = window.navigator || {};
    var hint = nav.userAgentData && typeof nav.userAgentData.platform === 'string' ? nav.userAgentData.platform : '';
    var ua = String(nav.userAgent || '');
    var plat = String(nav.platform || '');
    var all = (hint + ' ' + plat + ' ' + ua).toLowerCase();
    if (/android|iphone|ipad|ipod|cros|chrome os/.test(all)) return '';
    if (/win/.test(hint.toLowerCase() || plat.toLowerCase()) || /windows/.test(ua.toLowerCase())) return 'windows';
    if (/mac/.test(all)) {
      // iPads ask for the desktop site and say "Macintosh"; they are the ones with a touch screen.
      if (nav.maxTouchPoints > 1) return '';
      return 'mac';
    }
    if (/linux|x11|bsd/.test(all)) return 'linux';
    return '';
  }

  // Browsers on Apple silicon Macs still say "Intel" in their user agent. Chromium can tell the
  // real CPU when asked; everywhere else this stays unknown and both builds are offered as equals.
  function detectMacArch() {
    var data = window.navigator && window.navigator.userAgentData;
    if (!data || typeof data.getHighEntropyValues !== 'function') return Promise.resolve('');
    return data.getHighEntropyValues(['architecture']).then(function (v) {
      var a = v && typeof v.architecture === 'string' ? v.architecture.toLowerCase() : '';
      return a === 'arm' ? 'arm64' : a === 'x86' ? 'x64' : '';
    }, function () { return ''; });
  }

  /* ---------- shortcut labels on a Mac ---------- */
  // Mirrors src/renderer/shared/keys.js: Ctrl reads as ⌘, Alt as ⌥, Shift as ⇧, and macOS orders
  // them Control, Option, Shift, Command. A <kbd data-key="Control"> really is the Control key.
  var MAC_SYMBOL = { Ctrl: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧' };
  var MAC_NAME = { '⌘': 'Command', '⌃': 'Control', '⌥': 'Option', '⇧': 'Shift' };
  var MAC_ORDER = ['⌃', '⌥', '⇧', '⌘'];

  function macChord(text) {
    return String(text).replace(/\b((?:(?:Ctrl|Control|Alt|Shift)\+)+)/g, function (chord) {
      var syms = chord.split('+').filter(Boolean).map(function (n) { return MAC_SYMBOL[n] || n; });
      return syms.sort(function (a, b) { return MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b); }).join('');
    });
  }

  function initMacKeys() {
    root.classList.add('is-mac');
    $$('.keys').forEach(function (group) {
      var mods = [];
      var rest = [];
      Array.prototype.slice.call(group.childNodes).forEach(function (node) {
        var isKbd = node.nodeName === 'KBD';
        var name = isKbd ? (node.getAttribute('data-key') || node.textContent.trim()) : '';
        if (isKbd && MAC_SYMBOL[name]) { mods.push(MAC_SYMBOL[name]); return; }
        var text = isKbd ? node.textContent.trim() : node.textContent.replace(/\+/g, '').trim();
        if (!text) return;
        // "⌘-click", as macOS and src/renderer/shared/keys.js write it.
        if (/^click$/i.test(text)) rest.push({ text: '-click' });
        else rest.push(isKbd ? { kbd: text } : { text: text });
      });
      if (!mods.length) return;
      mods.sort(function (a, b) { return MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b); });
      group.textContent = '';
      mods.forEach(function (sym) {
        var kbd = document.createElement('kbd');
        kbd.textContent = sym;
        kbd.title = MAC_NAME[sym];
        group.appendChild(kbd);
      });
      rest.forEach(function (part) {
        if (part.text) { group.appendChild(document.createTextNode(part.text)); return; }
        var kbd = document.createElement('kbd');
        kbd.textContent = part.kbd;
        group.appendChild(kbd);
      });
    });
    $$('[data-keys]').forEach(function (el) { el.textContent = macChord(el.textContent); });
    $$('[data-mac-text]').forEach(function (el) { el.textContent = el.getAttribute('data-mac-text'); });
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

  // Release files, by the names electron-builder gives them (see "build" in package.json):
  //   OpenStickies-Setup-4.0.0.exe, OpenStickies-Portable-4.0.0.exe,
  //   OpenStickies-4.0.0-mac-arm64.dmg / -mac-x64.dmg (and .zip),
  //   OpenStickies-4.0.0-linux-x86_64.AppImage, openstickies_4.0.0_amd64.deb, SHA256SUMS.txt
  var ASSETS = {
    installer: /setup.*\.exe$/i,
    portable: /portable.*\.exe$/i,
    'mac-arm64': /mac.*arm64.*\.dmg$/i,
    'mac-x64': /mac.*x64.*\.dmg$/i,
    'mac-arm64-zip': /mac.*arm64.*\.zip$/i,
    'mac-x64-zip': /mac.*x64.*\.zip$/i,
    appimage: /linux.*(x86_64|x64).*\.AppImage$/i,
    deb: /(amd64|x64).*\.deb$/i,
    sums: /^SHA256SUMS(\.txt)?$/i
  };

  // The asset file names carry the app's own version (electron-builder puts it there), so they
  // win over the release tag/title, which are free text (e.g. a tag called "Release").
  function findVersion(release, files) {
    var i, m;
    for (i = 0; i < files.length; i++) {
      m = files[i] && files[i].name.match(/[-_](\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+?)?)(?:-(?:mac|linux)-|_(?:amd64|arm64)\.|\.exe$)/i);
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
    var files = {};
    var found = [];
    Object.keys(ASSETS).forEach(function (kind) {
      var a = pickAsset(assets, ASSETS[kind]);
      if (!a) return;
      files[kind] = a;
      if (kind !== 'sums') found.push(a);
    });
    return {
      ok: found.length > 0,
      version: findVersion(release, found),
      date: release.published_at || '',
      page: release.html_url || '',
      files: files
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
    if (!info || !info.files) return;
    var version = info.version ? 'v' + info.version : '';

    $$('[data-release-version]').forEach(function (el) {
      el.textContent = version;
      el.hidden = !version;
    });

    Object.keys(info.files).forEach(function (kind) {
      var asset = info.files[kind];
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

  /* ---------- download button for this computer ---------- */
  var OS_LABEL = { windows: 'Windows', mac: 'Mac', linux: 'Linux' };

  function initPlatform(os) {
    if (!os) return;
    root.setAttribute('data-os', os);

    $$('[data-hero-dl]').forEach(function (a) {
      a.href = '#download-' + os;
      var label = a.querySelector('[data-hero-label]');
      if (label) label.textContent = 'Download for ' + OS_LABEL[os];
    });
    if (os === 'mac') $$('[data-hero-mac]').forEach(function (el) { el.hidden = false; });

    // Put this computer's downloads first and mark them, without hiding the others.
    var group = document.getElementById('download-' + os);
    if (group && group.parentNode) {
      group.parentNode.insertBefore(group, group.parentNode.firstElementChild);
      group.classList.add('is-yours');
      var badge = group.querySelector('[data-yours]');
      if (badge) badge.hidden = false;
    }

    if (os === 'mac') {
      detectMacArch().then(function (arch) {
        if (!arch) return;
        $$('[data-mac-arch="' + arch + '"]').forEach(function (el) { el.hidden = false; });
      });
    }
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
          label.textContent = root.classList.contains('is-mac') ? 'Press ⌘C' : 'Press Ctrl+C';
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
    var os = detectOS();
    initHeader();
    if (os === 'mac') initMacKeys();
    initPlatform(os);
    initRelease();
    initLightbox();
    initCopy();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

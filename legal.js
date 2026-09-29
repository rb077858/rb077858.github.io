// Hebrew / English switch for privacy.html and terms.html.
(function () {
  var buttons = document.querySelectorAll('.lang button');
  var docs = document.querySelectorAll('article[lang]');

  function pick() {
    var q = new URLSearchParams(location.search).get('lang');
    if (q === 'he' || q === 'en') return q;
    try {
      var saved = localStorage.getItem('legal-lang');
      if (saved === 'he' || saved === 'en') return saved;
    } catch (e) { /* storage blocked */ }
    return /^he\b/i.test(navigator.language || '') ? 'he' : 'en';
  }

  function set(lang) {
    docs.forEach(function (a) { a.hidden = a.lang !== lang; });
    buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.lang === lang)); });
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    var active = document.querySelector('article[lang="' + lang + '"]');
    if (active && active.dataset.title) document.title = active.dataset.title;
    try { localStorage.setItem('legal-lang', lang); } catch (e) { /* storage blocked */ }
  }

  buttons.forEach(function (b) { b.addEventListener('click', function () { set(b.dataset.lang); }); });
  set(pick());
})();

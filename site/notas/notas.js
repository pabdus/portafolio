/* Notas · selector ES/EN y botón de tema.
   Idioma: comparte la preferencia con la portada (localStorage 'pd-lang').
   Tema: /theme.js fija html[data-theme] antes de pintar (localStorage 'pd-theme' o el sistema); aquí solo se cambia.
   Se carga en <head> sin defer: fija data-lang antes de pintar, así no parpadea el otro idioma.
   La CSP es script-src 'self': nada de scripts en línea ni onclick. */
(function () {
  var root = document.documentElement;
  var BAR = { light: '#f6f7f3', dark: '#0b0d11' }; // color de la barra del navegador móvil, igual a --bg

  function pickLang() {
    try {
      var saved = localStorage.getItem('pd-lang');
      if (saved === 'es' || saved === 'en') return saved;
    } catch (e) {}
    return navigator.language && !/^es\b/i.test(navigator.language) ? 'en' : 'es';
  }

  function theme() { return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }

  function paintTheme() {
    var light = theme() === 'light', es = root.getAttribute('data-lang') !== 'en';
    var btn = document.getElementById('theme-btn');
    if (btn) btn.setAttribute('aria-label', es ? (light ? 'Tema oscuro' : 'Tema claro') : (light ? 'Dark theme' : 'Light theme'));
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', BAR[theme()]);
  }

  function apply(lang) {
    root.setAttribute('data-lang', lang);
    root.lang = lang;
    var title = root.getAttribute('data-title-' + lang);
    if (title) document.title = title;
    var opts = document.querySelectorAll('[data-lang-opt]');
    for (var i = 0; i < opts.length; i++) {
      opts[i].classList.toggle('on', opts[i].getAttribute('data-lang-opt') === lang);
    }
    var btn = document.getElementById('lang-btn');
    if (btn) {
      // El nombre del botón va en el idioma de destino: lang hace que el lector lo lea con esa voz (WCAG 3.1.2).
      btn.setAttribute('aria-label', lang === 'es' ? 'Switch to English' : 'Cambiar a español');
      btn.setAttribute('lang', lang === 'es' ? 'en' : 'es');
    }
    // Nombres accesibles traducidos (p. ej. la navegación «Principal» / «Main»): data-aria-es y data-aria-en.
    var named = document.querySelectorAll('[data-aria-es]');
    for (var j = 0; j < named.length; j++) {
      var label = named[j].getAttribute('data-aria-' + lang);
      if (label) named[j].setAttribute('aria-label', label);
    }
    paintTheme();
  }

  if (!root.getAttribute('data-theme')) root.setAttribute('data-theme', 'dark'); // por si /theme.js no cargó
  apply(pickLang());

  document.addEventListener('DOMContentLoaded', function () {
    apply(root.getAttribute('data-lang') === 'en' ? 'en' : 'es');

    var langBtn = document.getElementById('lang-btn');
    if (langBtn) langBtn.addEventListener('click', function () {
      var next = root.getAttribute('data-lang') === 'es' ? 'en' : 'es';
      apply(next);
      try { localStorage.setItem('pd-lang', next); } catch (e) {}
    });

    var themeBtn = document.getElementById('theme-btn');
    if (themeBtn) themeBtn.addEventListener('click', function () {
      var next = theme() === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('pd-theme', next); } catch (e) {}
      paintTheme();
    });
  });
})();

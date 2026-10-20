/* Idioma y tema compartidos por las páginas de laboratorio y /estado.
   Idioma: localStorage 'pd-lang' (igual que la portada); si no hay, el del navegador.
   Tema: lo fija /theme.js antes de pintar; aquí solo el botón que lo cambia.
   Uso: LAB.lang() → 'es' | 'en'; LAB.onLang(fn) se llama al cambiar; LAB.t({es, en}) o LAB.t('es|en').
   LAB.demoDown(id, cb): cb(true) si la demo está caída según /data/estado.json, con la misma regla que la portada.
   Los elementos con data-aria-es y data-aria-en reciben el aria-label del idioma activo. */
(function () {
  var root = document.documentElement, subs = [];
  var lang = 'es';
  try { var s = localStorage.getItem('pd-lang'); if (s === 'es' || s === 'en') lang = s; else if (navigator.language && !/^es\b/i.test(navigator.language)) lang = 'en'; } catch (e) {}

  function apply() {
    root.setAttribute('data-lang', lang); root.lang = lang;
    // El nombre del botón está en el idioma de destino: lang hace que el lector lo pronuncie con esa voz.
    var b = document.getElementById('lab-lang'); if (b) { Array.prototype.forEach.call(b.querySelectorAll('[data-lang-opt]'), function (o) { o.classList.toggle('on', o.getAttribute('data-lang-opt') === lang); }); b.setAttribute('aria-label', lang === 'es' ? 'Switch to English' : 'Cambiar a español'); b.setAttribute('lang', lang === 'es' ? 'en' : 'es'); }
    Array.prototype.forEach.call(document.querySelectorAll('[data-aria-es][data-aria-en]'), function (el) { el.setAttribute('aria-label', el.getAttribute('data-aria-' + lang)); });
    var th = document.getElementById('lab-theme'); if (th) { var light = root.getAttribute('data-theme') === 'light'; th.textContent = light ? '☾' : '☀'; th.setAttribute('aria-label', lang === 'es' ? (light ? 'Tema oscuro' : 'Tema claro') : (light ? 'Dark theme' : 'Light theme')); }
    var tt = root.getAttribute('data-title-' + lang); if (tt) document.title = tt;
    var lt = root.getAttribute('data-theme') === 'light';
    Array.prototype.forEach.call(document.querySelectorAll('meta[name="theme-color"]'), function (m) { m.setAttribute('content', lt ? '#f6f7f3' : '#0b0d11'); });
    subs.forEach(function (fn) { try { fn(lang); } catch (e) { if (window.console) console.error(e); } });
  }
  /* Estado de las demos. /data/estado.json lo escribe cada 15 min una Lambda (infra/estado). Misma regla que la
     portada (app.js): una demo está caída si sus dos últimos chequeos fallaron y el archivo tiene 45 min o menos.
     Si el archivo falta, no se lee o está desactualizado, cb(false): ante la duda, el botón se muestra.
     El archivo se pide una sola vez por página. */
  var estado = null;
  function demoDown(id, cb) {
    function done(v) { try { cb(v); } catch (e) { if (window.console) console.error(e); } }
    if (!window.fetch || !window.Promise) { done(false); return; }
    if (!estado) estado = fetch('/data/estado.json', { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    estado.then(function (j) {
      var down = false;
      if (j && Array.isArray(j.historial) && Array.isArray(j.demos)) {
        var h = j.historial.slice(-2), age = (Date.now() - Date.parse(j.actualizado)) / 60000;
        down = age <= 45 && h.length === 2 &&
          j.demos.some(function (d) { return d && d.id === id; }) &&
          h.every(function (e) { return !!(e && e.r && e.r[id] && e.r[id][0] === 0); });
      }
      done(down);
    });
  }

  function t(x) { if (x == null) return ''; if (typeof x === 'string') { var p = x.split('|'); return p.length === 2 ? p[lang === 'es' ? 0 : 1] : x; } return x[lang] != null ? x[lang] : x.es; }

  window.LAB = {
    lang: function () { return lang; },
    t: t,
    onLang: function (fn) { subs.push(fn); },
    theme: function () { return root.getAttribute('data-theme') || 'dark'; },
    demoDown: demoDown
  };

  document.addEventListener('DOMContentLoaded', function () {
    var b = document.getElementById('lab-lang');
    if (b) b.addEventListener('click', function () { lang = lang === 'es' ? 'en' : 'es'; try { localStorage.setItem('pd-lang', lang); } catch (e) {} apply(); });
    var th = document.getElementById('lab-theme');
    if (th) th.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next); try { localStorage.setItem('pd-theme', next); } catch (e) {}
      apply();
    });
    apply();
  });
})();

/* Página /estado.html: lee /data/estado.json (lo publica cada 15 min la Lambda de infra/estado) y lo muestra.
   Formato: {actualizado, intervalo_min, demos: [{id, ok, codigo, ms}], historial: [{t, r: {id: [ok01, ms]}}]}.
   Sin archivo o con un archivo ilegible muestra un estado vacío; no escribe nada en la consola. */
(function () {
  'use strict';

  var URL_DATOS = '/data/estado.json';
  var TIRA = 96;                 // últimos 96 chequeos ≈ 24 h a 15 min
  var DIA = 864e5;
  var REFRESCO = 5 * 60 * 1000;  // vuelve a leer el archivo cada 5 min mientras la pestaña está visible

  // Nombres de las demos conocidas, en el orden en que se muestran.
  var NOMBRES = {
    facturas: { es: 'Demo de facturas (AWS Lambda + Bedrock)', en: 'Invoice demo (AWS Lambda + Bedrock)' },
    sitio: { es: 'Sitio pabloduque.dev', en: 'pabloduque.dev website' }
  };

  var root = document.getElementById('est-root');
  if (!root || !window.LAB) return;
  var LAB = window.LAB;

  var estado = { tipo: 'cargando' };   // 'cargando' | 'vacio' | 'datos'
  var ultimaLectura = 0;

  /* ---------- utilidades ---------- */
  function T(es, en) { return LAB.lang() === 'en' ? en : es; }
  function loc() { return LAB.lang() === 'en' ? 'en-US' : 'es-CO'; }

  function h(tag, props, kids) {
    var el = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  var fmtCache = {};
  function fmt(kind) {
    var key = kind + '|' + loc();
    if (!fmtCache[key]) {
      var o = kind === 'largo'
        ? { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }
        : { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' };
      try { fmtCache[key] = new Intl.DateTimeFormat(loc(), o); }
      catch (e) { fmtCache[key] = { format: function (d) { return d.toLocaleString(); } }; }
    }
    return fmtCache[key];
  }
  function fecha(t, kind) { return fmt(kind || 'corto').format(new Date(t)); }

  function num(n) {
    try { return Math.round(n).toLocaleString(loc()); } catch (e) { return String(Math.round(n)); }
  }
  function ms(n) { return num(n) + ' ms'; }

  // Porcentaje truncado a un decimal: nunca muestra 100 % si hubo algún fallo.
  function pct(ok, n) {
    var v = Math.floor(ok / n * 1000) / 10;
    var dec = (ok === n || ok === 0) ? 0 : 1;
    var s;
    try { s = v.toLocaleString(loc(), { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
    catch (e) { s = v.toFixed(dec); }
    return s + (LAB.lang() === 'en' ? '%' : ' %');
  }

  function hace(diff) {
    var m = Math.max(0, Math.floor(diff / 60000));
    var en = LAB.lang() === 'en';
    if (m < 1) return en ? 'less than 1 min ago' : 'hace menos de 1 min';
    if (m < 120) return en ? m + ' min ago' : 'hace ' + m + ' min';
    if (m < 48 * 60) {
      var hh = Math.floor(m / 60), mm = m % 60, s = hh + ' h' + (mm ? ' ' + mm + ' min' : '');
      return en ? s + ' ago' : 'hace ' + s;
    }
    var d = Math.floor(m / 1440);
    return en ? d + ' days ago' : 'hace ' + d + ' días';
  }

  // Percentil por rango más cercano sobre un arreglo ordenado: siempre devuelve un valor observado.
  function rango(sorted, q) { return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]; }

  /* ---------- lectura y validación ---------- */
  function normalizar(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.demos)) return null;
    var act = Date.parse(d.actualizado);
    if (isNaN(act)) return null;
    var intervalo = Number(d.intervalo_min) > 0 ? Number(d.intervalo_min) : 15;
    var demos = d.demos.filter(function (x) { return x && typeof x.id === 'string'; });
    var hist = (Array.isArray(d.historial) ? d.historial : []).map(function (e) {
      if (!e || typeof e.t !== 'string' || !e.r || typeof e.r !== 'object') return null;
      var t = Date.parse(e.t);
      return isNaN(t) ? null : { t: t, r: e.r };
    }).filter(Boolean).sort(function (a, b) { return a.t - b.t; });

    // Orden: primero las conocidas que aparecen en los datos, luego cualquier otra que traiga "demos".
    var ids = [], visto = {};
    var ultimo = hist.length ? hist[hist.length - 1].r : {};
    Object.keys(NOMBRES).forEach(function (id) {
      if (demos.some(function (x) { return x.id === id; }) || id in ultimo) { ids.push(id); visto[id] = 1; }
    });
    demos.forEach(function (x) { if (!visto[x.id]) { ids.push(x.id); visto[x.id] = 1; } });

    return { act: act, intervalo: intervalo, demos: demos, hist: hist, ids: ids };
  }

  function cargar(manual) {
    ultimaLectura = Date.now();
    fetch(URL_DATOS, { cache: 'no-cache', credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) return { error: r.status === 404 || r.status === 403 ? 'sinarchivo' : 'http', status: r.status };
        return r.json().then(function (j) {
          var d = normalizar(j);
          return d ? { datos: d } : { error: 'formato' };
        }, function () { return { error: 'formato' }; });
      }, function () { return { error: 'red' }; })
      .then(function (res) {
        if (res.datos) {
          var cambio = estado.tipo !== 'datos' || estado.datos.act !== res.datos.act || manual;
          estado = { tipo: 'datos', datos: res.datos };
          if (cambio) pintar(); else tictac();
        } else if (estado.tipo !== 'datos') {
          // Si ya había datos y falla una relectura, se conservan: el aviso de antigüedad avisará si envejecen.
          estado = { tipo: 'vacio', error: res.error, status: res.status };
          pintar();
        }
      });
  }

  /* ---------- cálculo por demo ---------- */
  function calcular(id, D) {
    var cur = null;
    D.demos.forEach(function (x) { if (x.id === id) cur = x; });
    var filas = D.hist.map(function (e) {
      var v = e.r[id];
      return { t: e.t, v: Array.isArray(v) && v.length ? v : null };
    });
    var conDato = filas.filter(function (f) { return f.v; });

    function ventana(dur) { return conDato.filter(function (f) { return f.t > D.act - dur; }); }
    function okDe(arr) { return arr.filter(function (f) { return !!f.v[0]; }).length; }
    var d1 = ventana(DIA), d7 = ventana(7 * DIA);
    var lat = d1.filter(function (f) { return f.v[0] && isFinite(f.v[1]); })
      .map(function (f) { return Number(f.v[1]); }).sort(function (a, b) { return a - b; });

    var seguidos = 0;
    for (var i = conDato.length - 1; i >= 0 && !conDato[i].v[0]; i--) seguidos++;

    var tira = filas.slice(-TIRA);
    var fallosTira = tira.filter(function (f) { return f.v && !f.v[0]; });

    return {
      cur: cur,
      est: !cur ? 'nodata' : (cur.ok ? 'up' : 'down'),
      d1: { n: d1.length, ok: okDe(d1) },
      d7: { n: d7.length, ok: okDe(d7) },
      lat: lat,
      seguidos: seguidos,
      tira: tira,
      fallosTira: fallosTira
    };
  }

  /* ---------- pintado ---------- */
  function nombre(id) { var n = NOMBRES[id]; return n ? (LAB.lang() === 'en' ? n.en : n.es) : id; }

  function avisoViejo(D) {
    var edad = Date.now() - D.act;
    if (edad <= 3 * D.intervalo * 60000) return null;
    return h('p', { class: 'est-warn' }, [
      h('span', { class: 'est-warn-i', 'aria-hidden': 'true', text: '!' }),
      h('span', null, [
        h('strong', { text: T('El chequeo no se ha actualizado.', 'The check has not updated.') }),
        ' ',
        T('El último chequeo fue ' + hace(edad) + ' y debería llegar uno cada ' + D.intervalo + ' min. Las cifras de abajo corresponden a esa hora.',
          'The latest check was ' + hace(edad) + ', and one should arrive every ' + D.intervalo + ' min. The figures below are as of that time.')
      ])
    ]);
  }

  function resumen(D, calcs) {
    var total = D.ids.length, up = 0, down = 0;
    D.ids.forEach(function (id) { if (calcs[id].est === 'up') up++; else if (calcs[id].est === 'down') down++; });
    var txt = T(up + ' de ' + total + ' operativas', up + ' of ' + total + ' up');
    var cls = 'read' + (total && up === total ? ' good' : (down ? ' bad' : ''));

    var card = h('section', { class: 'card est-sum', tabindex: '-1', 'aria-label': T('Resumen', 'Summary') }, [
      h('div', { class: 'est-sum-row' }, [
        h('div', null, [
          h('div', { class: 'lbl', text: T('Última actualización (tu hora local)', 'Last update (your local time)') }),
          h('div', { class: 'est-sum-v' }, [h('time', { datetime: new Date(D.act).toISOString(), text: fecha(D.act, 'largo') })]),
          h('div', { class: 'est-age', 'data-age': '1', text: hace(Date.now() - D.act) })
        ]),
        h('div', null, [
          h('div', { class: 'lbl', text: T('Demos', 'Demos') }),
          h('div', { class: cls + ' est-sum-n', text: total ? txt : T('ninguna en el archivo', 'none in the file') }),
          down ? h('div', { class: 'est-age', text: T(down === 1 ? '1 caída' : down + ' caídas', down + ' down') }) : null
        ])
      ]),
      h('div', { 'data-warn': '1' }, [avisoViejo(D)])
    ]);
    return card;
  }

  function insignia(est) {
    var txt = est === 'up' ? T('Operativa', 'Up') : est === 'down' ? T('Caída', 'Down') : T('Sin datos', 'No data');
    return h('span', { class: 'est-badge ' + est }, [h('span', { class: 'est-dot', 'aria-hidden': 'true' }), txt]);
  }

  function lineaActual(c) {
    if (!c.cur) return T('Sin chequeo en la última lectura.', 'Not checked in the latest reading.');
    var cod = Number(c.cur.codigo);
    var resp = cod > 0 ? 'HTTP ' + cod : T('sin respuesta (DNS, TLS o tiempo agotado)', 'no response (DNS, TLS or timeout)');
    var lat = isFinite(c.cur.ms) ? ' · ' + ms(Number(c.cur.ms)) : '';
    return T('Último chequeo: ', 'Latest check: ') + resp + lat;
  }

  function dato(lbl, valor, sub, cls) {
    return h('div', null, [
      h('dt', { class: 'lbl', text: lbl }),
      h('dd', null, [h('div', { class: 'read' + (cls ? ' ' + cls : ''), text: valor }), h('div', { class: 'est-sub', text: sub })])
    ]);
  }

  function disp(w) {
    if (!w.n) return { v: '—', s: T('sin chequeos', 'no checks'), cls: '' };
    return {
      v: pct(w.ok, w.n),
      s: T(num(w.ok) + ' de ' + num(w.n) + ' chequeos', num(w.ok) + ' of ' + num(w.n) + ' checks'),
      cls: w.ok === w.n ? 'good' : ''   // sin un objetivo fijado, un fallo no es "fuera de límite": cifra en color neutro
    };
  }

  function tira(c) {
    var celdas = [], faltan = TIRA - c.tira.length, ok = 0, ko = 0, na = 0;
    for (var i = 0; i < faltan; i++) { celdas.push(h('span', { class: 'na' })); na++; }
    c.tira.forEach(function (f) {
      var cls, tt = fecha(f.t) + ' · ';
      if (!f.v) { cls = 'na'; na++; tt += T('sin dato', 'no data'); }
      else if (f.v[0]) { cls = 'ok'; ok++; tt += T('correcto', 'pass') + (isFinite(f.v[1]) ? ' · ' + ms(Number(f.v[1])) : ''); }
      else { cls = 'ko'; ko++; tt += T('fallo', 'fail') + (isFinite(f.v[1]) ? ' · ' + ms(Number(f.v[1])) : ''); }
      celdas.push(h('span', { class: cls, title: tt }));
    });
    var label = T(
      'Últimos ' + TIRA + ' chequeos, del más antiguo al más reciente: ' + ok + ' correctos, ' + ko + ' con fallo' + (na ? ', ' + na + ' sin dato' : '') + '.',
      'Last ' + TIRA + ' checks, oldest to newest: ' + ok + ' passed, ' + ko + ' failed' + (na ? ', ' + na + ' without data' : '') + '.'
    );
    var primero = c.tira.length ? c.tira[0].t : null, ultimo = c.tira.length ? c.tira[c.tira.length - 1].t : null;

    var fallos;
    if (!c.tira.length) fallos = T('Todavía no hay chequeos en el historial.', 'No checks in the history yet.');
    else if (!c.fallosTira.length) fallos = T('Fallos en esta tira: ninguno.', 'Failures in this strip: none.');
    else {
      var u = c.fallosTira[c.fallosTira.length - 1].t;
      fallos = T('Fallos en esta tira: ' + c.fallosTira.length + ' · el más reciente: ' + fecha(u),
        'Failures in this strip: ' + c.fallosTira.length + ' · most recent: ' + fecha(u));
    }

    return h('div', { class: 'est-tira' }, [
      h('div', { class: 'est-tira-h' }, [
        h('span', { class: 'lbl', text: T('Últimos ' + TIRA + ' chequeos', 'Last ' + TIRA + ' checks') }),
        h('span', { class: 'est-ley', 'aria-hidden': 'true' }, [
          h('span', null, [h('i', { class: 'ok' }), T('correcto', 'pass')]),
          h('span', null, [h('i', { class: 'ko' }), T('fallo', 'fail')]),
          h('span', null, [h('i', { class: 'na' }), T('sin dato', 'no data')])
        ])
      ]),
      h('div', { class: 'est-strip', role: 'img', 'aria-label': label }, celdas),
      h('div', { class: 'est-axis', 'aria-hidden': 'true' }, [
        // Con relleno a la izquierda (historial más corto que la tira), la fecha del primer chequeo no quedaría bajo su barra.
        h('span', { text: faltan > 0 ? (c.tira.length ? T('sin historial', 'no history') : '') : fecha(primero) }),
        h('span', { text: ultimo != null ? fecha(ultimo) : '' })
      ]),
      h('p', { class: 'est-fallos' + (c.fallosTira.length ? ' bad' : ''), text: fallos })
    ]);
  }

  function tarjeta(id, c) {
    var med = c.lat.length ? ms(rango(c.lat, 0.5)) : '—';
    var p95 = c.lat.length ? ms(rango(c.lat, 0.95)) : '—';
    var nLat = T(num(c.lat.length) + ' chequeos correctos', num(c.lat.length) + ' passing checks');
    var a = disp(c.d1), b = disp(c.d7);
    var hid = 'est-n-' + id.replace(/[^A-Za-z0-9_-]/g, '_');

    return h('article', { class: 'card est-card est-' + c.est, 'aria-labelledby': hid }, [
      h('div', { class: 'est-head' }, [
        h('h2', { id: hid, text: nombre(id) }),
        insignia(c.est)
      ]),
      h('p', { class: 'est-now' }, [lineaActual(c)]),
      c.seguidos >= 2 ? h('p', { class: 'est-seg', text: T(c.seguidos + ' fallos seguidos.', c.seguidos + ' failures in a row.') }) : null,
      h('dl', { class: 'est-stats' }, [
        dato(T('Disponibilidad 24 h', 'Availability 24 h'), a.v, a.s, a.cls),
        dato(T('Disponibilidad 7 días', 'Availability 7 days'), b.v, b.s, b.cls),
        dato(T('Latencia mediana 24 h', 'Median latency 24 h'), med, nLat),
        dato(T('Latencia p95 24 h', 'p95 latency 24 h'), p95, nLat)
      ]),
      tira(c)
    ]);
  }

  function vacio() {
    var det;
    if (estado.error === 'sinarchivo') det = T('El archivo /data/estado.json aún no existe. Lo crea la primera ejecución del chequeo, que corre cada 15 minutos.',
      'The file /data/estado.json does not exist yet. The first run of the check creates it; it runs every 15 minutes.');
    else if (estado.error === 'http') det = T('No se pudo leer /data/estado.json (HTTP ' + estado.status + ').', 'Could not read /data/estado.json (HTTP ' + estado.status + ').');
    else if (estado.error === 'formato') det = T('El archivo /data/estado.json no tiene el formato esperado.', 'The file /data/estado.json is not in the expected format.');
    else det = T('No se pudo leer /data/estado.json: error de red.', 'Could not read /data/estado.json: network error.');

    var btn = h('button', { class: 'lab-btn', type: 'button', id: 'est-retry', text: T('Volver a intentar', 'Try again') });
    btn.addEventListener('click', function () {
      if (btn.getAttribute('aria-disabled') === 'true') return;
      // aria-disabled en lugar de disabled: el botón conserva el foco mientras se relee el archivo.
      btn.setAttribute('aria-disabled', 'true');
      btn.textContent = T('Leyendo…', 'Reading…');
      cargar(true);
    });
    return h('section', { class: 'card est-empty', 'aria-labelledby': 'est-empty-t' }, [
      h('h2', { id: 'est-empty-t', text: estado.error === 'sinarchivo' ? T('Todavía no hay datos de chequeo', 'No check data yet') : T('No se pudieron leer los datos de chequeo', 'Could not read the check data') }),
      h('p', { text: det }),
      btn
    ]);
  }

  function pintar() {
    var teniaFoco = document.activeElement && document.activeElement.id === 'est-retry';
    root.textContent = '';
    if (estado.tipo === 'cargando') {
      root.setAttribute('aria-busy', 'true');
      root.appendChild(h('div', { class: 'card est-empty' }, [
        h('p', { class: 'note', role: 'status', text: T('Leyendo el último chequeo…', 'Reading the latest check…') })
      ]));
      return;
    }
    root.setAttribute('aria-busy', 'false');
    if (estado.tipo === 'vacio') {
      root.appendChild(vacio());
      if (teniaFoco) { var b = document.getElementById('est-retry'); if (b) b.focus(); }
      return;
    }
    var D = estado.datos, calcs = {};
    D.ids.forEach(function (id) { calcs[id] = calcular(id, D); });
    var sum = resumen(D, calcs);
    root.appendChild(sum);
    var grid = h('div', { class: 'est-grid' }, D.ids.map(function (id) { return tarjeta(id, calcs[id]); }));
    root.appendChild(grid);
    if (teniaFoco) sum.focus();   // el reintento trajo datos: el foco pasa al resumen
  }

  // Actualiza "hace N min" y el aviso de antigüedad sin repintar las tarjetas.
  function tictac() {
    if (estado.tipo !== 'datos') return;
    var D = estado.datos;
    var age = root.querySelector('[data-age]');
    if (age) age.textContent = hace(Date.now() - D.act);
    var w = root.querySelector('[data-warn]');
    if (w) { w.textContent = ''; var a = avisoViejo(D); if (a) w.appendChild(a); }
  }

  LAB.onLang(function () { if (estado.tipo !== 'cargando') pintar(); });
  setInterval(function () {
    tictac();
    if (document.visibilityState !== 'hidden' && Date.now() - ultimaLectura >= REFRESCO) cargar(false);
  }, 30000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - ultimaLectura >= REFRESCO) cargar(false);
  });

  cargar(false);
})();

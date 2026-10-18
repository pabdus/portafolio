/* Tema claro u oscuro antes de pintar, para que no parpadee. Prioridad: elección guardada del visitante
   ('pd-theme'), luego la preferencia del sistema. Sin JavaScript el sitio queda en oscuro. */
(function () {
  var t = null;
  try { t = localStorage.getItem('pd-theme'); } catch (e) {}
  if (t !== 'light' && t !== 'dark') t = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
})();

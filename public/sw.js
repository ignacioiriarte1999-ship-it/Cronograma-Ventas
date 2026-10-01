// ============================================================
//  SERVICE WORKER
// ============================================================
// Cachea sólo lo estático y propio: el HTML, el CSS, los módulos y los
// íconos. Nada de Supabase.
//
// Eso último no es una preferencia, es la regla que hace que esto sea seguro.
// Las respuestas de Supabase llevan turnos, perfiles y sesiones: guardarlas en
// una caché del navegador significaría que el siguiente que abra la app en ese
// equipo vea los datos del anterior, y que un cambio del admin no llegue nunca.
// Como Supabase vive en otro origen, alcanza con no tocar nada que no sea del
// propio sitio.

const VERSION = 'cronogramas-v2';

// El armazón mínimo para que la app arranque. Las dependencias que vienen de
// esm.sh quedan afuera a propósito: son de otro origen y cambian solas.
const ESTATICOS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/manifest.webmanifest',
  '/iconos/icono-192.png',
  '/iconos/icono-512.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(VERSION)
      // Si alguno falla, que no se caiga la instalación entera.
      .then((c) => Promise.allSettled(ESTATICOS.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Otro origen —Supabase, esm.sh, la API de feriados— pasa de largo sin que
  // el service worker lo toque.
  if (url.origin !== self.location.origin) return;

  // Todo lo propio va primero a la red, y la caché queda sólo como respaldo
  // para cuando no hay conexión.
  //
  // La tentación es servir el CSS y los módulos desde la caché, que es más
  // rápido. El problema es que el HTML sí tiene que ir a la red —si no, un
  // deploy no se vería nunca— y entonces queda la peor combinación posible:
  // index.html nuevo pidiendo módulos viejos. Los archivos no llevan hash en
  // el nombre, así que nada avisaría del desfasaje. Esta app necesita red
  // igual para hablar con Supabase: ahorrarse un viaje no vale ese riesgo.
  ev.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(VERSION).then((c) => c.put(req, copia));
        }
        return resp;
      })
      .catch(() => caches.match(req).then(
        (r) => r || (req.mode === 'navigate' ? caches.match('/index.html') : undefined),
      )),
  );
});

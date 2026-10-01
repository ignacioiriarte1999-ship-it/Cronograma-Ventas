// ============================================================
//  TEMA CLARO / OSCURO
// ============================================================
// Tres estados, no dos: "sistema" es el valor por defecto y respeta lo que
// tenga configurado el teléfono o la computadora. Elegir claro u oscuro a mano
// es pisar esa decisión, y por eso se guarda; "sistema" se guarda borrando la
// clave, así el que nunca tocó nada no arrastra una preferencia vieja.
//
// Quién pinta qué lo decide el CSS. Acá sólo se mueve un atributo.

const CLAVE = 'crono:tema';
const COLOR = { claro: '#eef1f6', oscuro: '#0f1621' };

const prefiereOscuro = () =>
  window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

/** 'claro', 'oscuro' o 'sistema'. */
export function temaElegido() {
  try {
    const t = localStorage.getItem(CLAVE);
    return t === 'claro' || t === 'oscuro' ? t : 'sistema';
  } catch (e) {
    return 'sistema';
  }
}

/** El que realmente se está viendo. */
export const temaEfectivo = () => {
  const t = temaElegido();
  return t === 'sistema' ? (prefiereOscuro() ? 'oscuro' : 'claro') : t;
};

/**
 * La barra del navegador en el celular.
 *
 * El HTML trae dos etiquetas con `media`, que alcanzan mientras manda el
 * sistema. Con una elección manual dejan de servir —la del sistema seguiría
 * ganando— así que se reemplazan por una sola sin `media`.
 */
function pintarBarra() {
  const color = COLOR[temaEfectivo()];
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = color;
  document.head.appendChild(meta);
}

export function elegirTema(t) {
  const v = t === 'claro' || t === 'oscuro' ? t : 'sistema';
  try {
    if (v === 'sistema') localStorage.removeItem(CLAVE);
    else localStorage.setItem(CLAVE, v);
  } catch (e) { /* modo privado: vale para esta pestaña igual */ }

  if (v === 'sistema') delete document.documentElement.dataset.tema;
  else document.documentElement.dataset.tema = v;
  pintarBarra();
}

export function iniciarTema() {
  // El atributo ya lo puso el script del <head>, para que no haya parpadeo.
  pintarBarra();
  // Con "sistema" elegido, seguir al sistema cuando cambia solo al anochecer.
  window.matchMedia?.('(prefers-color-scheme: dark)')
    .addEventListener?.('change', () => { if (temaElegido() === 'sistema') pintarBarra(); });
}

/**
 * Deja la app instalable. Sólo fuera de la demo: el service worker se
 * registra en la raíz y desde /demo/ no tendría alcance, y además una
 * demostración no gana nada funcionando sin conexión.
 */
export function registrarServiceWorker(demo) {
  if (demo || !('serviceWorker' in navigator)) return;
  const seguro = location.protocol === 'https:' || location.hostname === 'localhost';
  if (!seguro) return;
  navigator.serviceWorker.register('/sw.js')
    .catch((e) => console.warn('No se registró el service worker:', e.message));
}

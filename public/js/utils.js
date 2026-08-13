// ============================================================
//  UTILIDADES DE FECHA Y FORMATO
// ============================================================

export const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const DIAS = ['D', 'L', 'Ma', 'Mi', 'J', 'V', 'S'];
export const DIAS_LARGOS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const pad2 = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function formatShort(d) {
  return `${DIAS[d.getDay()]} ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
}

export function formatLargo(d) {
  return `${DIAS_LARGOS[d.getDay()]}, ${d.getDate()} de ${MESES_LARGOS[d.getMonth()]}`;
}

export function hoyISO() {
  const h = new Date();
  h.setHours(0, 0, 0, 0);
  return toISO(h);
}

/**
 * Escapa texto antes de interpolarlo en HTML.
 * Los nombres de vendedores y los motivos de feriado los tipea el admin,
 * así que se sanean para que no puedan inyectar markup.
 */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Agrupa fechas ISO ordenadas en semanas que arrancan el lunes. */
export function agruparPorSemanaDesde(fechas) {
  const semanas = [];
  let actual = null;
  for (const iso of fechas) {
    const d = fromISO(iso);
    if (d.getDay() === 1) {
      if (actual) semanas.push(actual);
      actual = { lunes: iso, dias: [iso] };
    } else if (actual) {
      actual.dias.push(iso);
    }
  }
  if (actual) semanas.push(actual);
  return semanas;
}

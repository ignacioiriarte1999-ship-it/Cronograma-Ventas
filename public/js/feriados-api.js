// ============================================================
//  FERIADOS DESDE UNA FUENTE EXTERNA
// ============================================================
// Los feriados argentinos no se pueden calcular del todo: los trasladables
// los mueve un decreto y los puentes turísticos se fijan año a año. La app ya
// calcula lo que sí es predecible —inamovibles, Carnaval y Semana Santa— y
// esto le agrega lo que hay que consultar.
//
// La fuente es ArgentinaDatos, que responde con CORS abierto, así que la
// consulta la hace el navegador y no hace falta ningún servidor intermedio.
// Si no contesta, se cae al cálculo propio: es preferible un año con los
// inamovibles puestos que un panel vacío.

import { feriadosDeAnio } from './periodo.js';

const URL_API = (anio) => `https://api.argentinadatos.com/v1/feriados/${anio}`;

/** Cuánto esperar antes de darla por caída. */
const TIMEOUT_MS = 8000;

/**
 * Feriados de un año.
 *
 * Devuelve `{ fuente, feriados }`, donde fuente es 'api' o 'calculo'. Quien
 * llame tiene que poder decirle al usuario de dónde salieron: con el cálculo
 * propio faltan los puentes y los traslados, y eso hay que avisarlo.
 */
export async function traerFeriados(anio) {
  try {
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const resp = await fetch(URL_API(anio), { signal: ctrl.signal });
    clearTimeout(reloj);

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const datos = await resp.json();
    if (!Array.isArray(datos) || !datos.length) throw new Error('respuesta vacía');

    return {
      fuente: 'api',
      feriados: datos
        .filter((f) => f && f.fecha && f.nombre)
        .map((f) => ({ iso: f.fecha, motivo: f.nombre, tipo: f.tipo || 'inamovible' }))
        .sort((a, b) => a.iso.localeCompare(b.iso)),
    };
  } catch (e) {
    console.warn(`Feriados ${anio}: la API no respondió (${e.message}); se usa el cálculo propio.`);
    return {
      fuente: 'calculo',
      feriados: Object.entries(feriadosDeAnio(anio))
        .map(([iso, motivo]) => ({ iso, motivo, tipo: 'inamovible' }))
        .sort((a, b) => a.iso.localeCompare(b.iso)),
    };
  }
}

/**
 * Los que todavía no están cargados y caen dentro del cronograma.
 *
 * Se comparan por fecha, no por nombre: si un feriado ya está con otro texto
 * —cargado a mano en su momento— no se vuelve a agregar ni se pisa lo que
 * escribió el admin.
 */
export function nuevosPara(mod, feriados) {
  return feriados.filter((f) => !mod.feriados[f.iso] && mod.cronograma[f.iso]);
}

/** Los turnos que ese feriado va a borrar, para avisar antes de aplicarlo. */
export function turnosQuePisa(mod, iso) {
  const c = mod.cronograma[iso];
  if (!c || c.closed) return [];
  return ['manana', 'tarde'].filter((t) => c[t]).map((t) => ({ turno: t, vendedor: c[t] }));
}

/** Los años que toca el cronograma, más el siguiente al último. */
export function aniosOfrecidos(mod) {
  const desde = Number((mod.desde || '').slice(0, 4));
  const hasta = Number((mod.hasta || '').slice(0, 4));
  if (!desde || !hasta) return [new Date().getFullYear()];
  const anios = [];
  for (let a = desde; a <= hasta + 1; a++) anios.push(a);
  return anios;
}

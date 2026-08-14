// ============================================================
//  EL PERÍODO Y SU ESQUELETO
// ============================================================
// Vive aparte de schedule.js a propósito: los generadores de cronograma son
// lógica pura y no deben arrastrar el cliente de base de datos. Así se pueden
// ejecutar y verificar sin conexión ni sesión.

import { INICIO_SEMESTRE, FIN_SEMESTRE } from './config.js';
import { toISO, fromISO, addDays } from './utils.js';

/** Todas las fechas ISO del rango, día por día. */
export function generarFechasSemestre(desde = INICIO_SEMESTRE, hasta = FIN_SEMESTRE) {
  const fechas = [];
  let d = fromISO(desde);
  const fin = fromISO(hasta);
  while (d <= fin) {
    fechas.push(toISO(d));
    d = addDays(d, 1);
  }
  return fechas;
}

/** El lunes de la semana de una fecha, y el domingo que la cierra. */
export const lunesDe = (iso) => {
  const d = fromISO(iso);
  return toISO(addDays(d, d.getDay() === 0 ? -6 : 1 - d.getDay()));
};
export const domingoDe = (iso) => {
  const d = fromISO(iso);
  return toISO(addDays(d, d.getDay() === 0 ? 0 : 7 - d.getDay()));
};

/**
 * Rango que cubren unas fechas, redondeado a semanas completas.
 * Se usa para que cada punto de venta muestre exactamente lo que tiene
 * cargado, en vez de un período fijo que deja semanas vacías al final.
 */
export function rangoDeFechas(fechas) {
  if (!fechas.length) return [INICIO_SEMESTRE, FIN_SEMESTRE];
  let min = fechas[0];
  let max = fechas[0];
  for (const f of fechas) {
    if (f < min) min = f;
    if (f > max) max = f;
  }
  return [lunesDe(min), domingoDe(max)];
}

// ============================================================
//  FERIADOS
// ============================================================

/** Domingo de Pascua por el algoritmo gregoriano anónimo. */
function pascua(anio) {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(anio, mes - 1, dia);
}

/**
 * Feriados argentinos de un año, con lo que se puede afirmar sin decreto:
 * los inamovibles, los que dependen de Pascua y los trasladables en su fecha
 * nominal.
 *
 * NO incluye los "no laborables con fines turísticos": el Poder Ejecutivo los
 * fija cada año por decreto y no hay forma de calcularlos. Tampoco aplica el
 * traslado de los trasladables, que también se define por decreto. Ambos se
 * cargan a mano desde el panel de feriados cuando se publican.
 */
export function feriadosDeAnio(anio) {
  const f = {};
  const dom = pascua(anio);
  const poner = (d, nombre) => { f[toISO(d)] = nombre; };

  poner(addDays(dom, -48), 'Carnaval');
  poner(addDays(dom, -47), 'Carnaval');
  poner(addDays(dom, -3), 'Jueves Santo');
  poner(addDays(dom, -2), 'Viernes Santo');

  const fijos = [
    ['01-01', 'Año Nuevo'],
    ['03-24', 'Día Nacional de la Memoria por la Verdad y la Justicia'],
    ['04-02', 'Día del Veterano y de los Caídos en la Guerra de Malvinas'],
    ['05-01', 'Día del Trabajador'],
    ['05-25', 'Día de la Revolución de Mayo'],
    ['06-20', 'Paso a la Inmortalidad Gral. Manuel Belgrano'],
    ['07-09', 'Día de la Independencia'],
    ['08-17', 'Paso a la Inmortalidad Gral. José de San Martín'],
    ['09-24', 'Día de la Batalla de Tucumán'],
    ['10-12', 'Día del Respeto a la Diversidad Cultural'],
    ['11-20', 'Día de la Soberanía Nacional'],
    ['12-08', 'Inmaculada Concepción de María'],
    ['12-25', 'Navidad'],
  ];
  for (const [md, nombre] of fijos) f[`${anio}-${md}`] = nombre;
  return f;
}

/** Feriados de todos los años que toca un rango. */
export function feriadosDelRango(desde, hasta) {
  const f = {};
  const a1 = fromISO(desde).getFullYear();
  const a2 = fromISO(hasta).getFullYear();
  for (let a = a1; a <= a2; a++) {
    for (const [iso, nombre] of Object.entries(feriadosDeAnio(a))) {
      if (iso >= desde && iso <= hasta) f[iso] = nombre;
    }
  }
  return f;
}

/** Semestre vacío: domingos cerrados y los feriados que se le pasen marcados. */
export function esqueletoSemestre(feriados = {}, desde = INICIO_SEMESTRE, hasta = FIN_SEMESTRE) {
  const cronograma = {};
  for (const iso of generarFechasSemestre(desde, hasta)) {
    cronograma[iso] = {
      manana: null,
      tarde: null,
      holiday: Boolean(feriados[iso]),
      closed: fromISO(iso).getDay() === 0,
    };
  }
  return cronograma;
}

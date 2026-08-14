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

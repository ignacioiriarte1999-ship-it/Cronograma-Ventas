// ============================================================
//  EL PERÍODO Y SU ESQUELETO
// ============================================================
// Vive aparte de schedule.js a propósito: los generadores de cronograma son
// lógica pura y no deben arrastrar el cliente de base de datos. Así se pueden
// ejecutar y verificar sin conexión ni sesión.

import { INICIO_SEMESTRE, FIN_SEMESTRE } from './config.js';
import { toISO, fromISO, addDays } from './utils.js';

/** Todas las fechas ISO del semestre, día por día. */
export function generarFechasSemestre() {
  const fechas = [];
  let d = fromISO(INICIO_SEMESTRE);
  const fin = fromISO(FIN_SEMESTRE);
  while (d <= fin) {
    fechas.push(toISO(d));
    d = addDays(d, 1);
  }
  return fechas;
}

/** Semestre vacío: domingos cerrados y los feriados que se le pasen marcados. */
export function esqueletoSemestre(feriados = {}) {
  const cronograma = {};
  for (const iso of generarFechasSemestre()) {
    cronograma[iso] = {
      manana: null,
      tarde: null,
      holiday: Boolean(feriados[iso]),
      closed: fromISO(iso).getDay() === 0,
    };
  }
  return cronograma;
}

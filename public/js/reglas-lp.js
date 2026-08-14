// ============================================================
//  CRONOGRAMA — LAPRIDA 235
// ============================================================
// Reglas:
//  - 12 vendedores en cola cíclica.
//  - Cada semana ocupa 11 slots (L-M, L-T, Ma-M, Ma-T, Mi-M, Mi-T, J-M, J-T,
//    V-M, V-T, S-M). El vendedor que cae en la posición 12 descansa.
//  - La cola avanza +1 posición por semana: sobre 26 semanas cada vendedor
//    cubre cada franja unas 2,17 veces (26/12).
//  - Feriados: los slots del día no se cubren; quien hubiera caído ahí
//    simplemente no trabaja esa semana.
//  - No aplica la regla del cierre (mismo criterio que el cronograma original).
//
// Correcciones respecto del cronograma en papel:
//  a) "Díaz" y "Diaz" eran la misma persona: queda un solo nombre.
//  b) El orden inicial alfabético deja a Juarez (posición 4) cubriendo el
//     sábado en las semanas 6 y 18 — antes no le tocaba ninguno.

import { esqueletoSemestre, lunesDe } from './periodo.js';
import { toISO, fromISO, addDays, formatShort, agruparPorSemanaDesde } from './utils.js';

export const LP_VENDS = ['Arevalo', 'De la Rosa', 'Diaz', 'Erazo', 'Juarez', 'Orellana',
  'Quiroga', 'Rios', 'Santillan', 'Soria', 'Valdez', 'Varas'];

// slot 11 = descanso, no se asigna.
const LP_SLOTS = [
  { dia: 0, turno: 'manana' }, // L-M
  { dia: 0, turno: 'tarde' },  // L-T
  { dia: 1, turno: 'manana' }, // Ma-M
  { dia: 1, turno: 'tarde' },  // Ma-T
  { dia: 2, turno: 'manana' }, // Mi-M
  { dia: 2, turno: 'tarde' },  // Mi-T
  { dia: 3, turno: 'manana' }, // J-M
  { dia: 3, turno: 'tarde' },  // J-T
  { dia: 4, turno: 'manana' }, // V-M
  { dia: 4, turno: 'tarde' },  // V-T
  { dia: 5, turno: 'manana' }, // S-M
];

function generar(feriados = {}, desde, hasta) {
  const cronograma = esqueletoSemestre(feriados, desde, hasta);
  const semanas = agruparPorSemanaDesde(Object.keys(cronograma).sort());

  for (let w = 0; w < semanas.length; w++) {
    const lunes = fromISO(semanas[w].lunes);
    for (let slot = 0; slot < LP_SLOTS.length; slot++) {
      // El vendedor con posición inicial p ocupa el slot (p + w) mod 12 en la
      // semana w. Invertido: quien ocupa el slot s es el vendedor (s - w) mod 12.
      const vendedor = LP_VENDS[((slot - w) % 12 + 12) % 12];
      const { dia, turno } = LP_SLOTS[slot];
      const iso = toISO(addDays(lunes, dia));
      if (!cronograma[iso] || cronograma[iso].holiday) continue;
      cronograma[iso][turno] = vendedor;
    }
  }
  return cronograma;
}

function detectarProblemas(sem) {
  const issues = [];
  const diasLab = sem.dias.slice(0, 6).filter((iso) => {
    const c = this.cronograma[iso];
    return c && !c.holiday && !c.closed;
  });

  const vacios = [];
  const cuenta = {};
  for (const v of this.vendedores) cuenta[v] = 0;

  for (const iso of diasLab) {
    const c = this.cronograma[iso];
    const esSabado = fromISO(iso).getDay() === 6;
    const turnos = esSabado ? ['manana'] : ['manana', 'tarde'];
    for (const t of turnos) {
      if (c[t]) cuenta[c[t]] = (cuenta[c[t]] || 0) + 1;
      else vacios.push({ iso, turno: t });
    }
  }

  // Regla A — no deben quedar slots sin cubrir.
  if (vacios.length > 0) {
    issues.push({
      regla: 'A-slot-vacio', severidad: 'warn',
      descripcion: `${vacios.length} slot(s) vacío(s) en la semana.`, autoFix: null,
    });
  }

  // Regla B — con 12 vendedores y 11 slots, nadie hace más de un turno semanal.
  for (const [v, n] of Object.entries(cuenta)) {
    if (n > 1) {
      issues.push({
        regla: 'B-duplicado', severidad: 'err',
        descripcion: `${v} aparece ${n} veces esta semana; debería ser máximo 1.`, autoFix: null,
      });
    }
  }

  // Regla C — nombres del padrón (detecta typos tipo "Díaz" vs "Diaz").
  for (const iso of diasLab) {
    const c = this.cronograma[iso];
    for (const t of ['manana', 'tarde']) {
      if (c[t] && !this.vendedores.includes(c[t])) {
        issues.push({
          regla: 'C-typo', severidad: 'err',
          descripcion: `El nombre "${c[t]}" en ${formatShort(fromISO(iso))} ${t === 'manana' ? 'mañana' : 'tarde'} no está en la lista de vendedores.`,
          autoFix: null,
        });
      }
    }
  }

  return issues;
}


// ------------------------------------------------------------
//  CONTINUACIÓN DE LA COLA
// ------------------------------------------------------------
// Para extender el cronograma no se recalcula desde cero: se lee la cola real
// de la última semana completa y se la hace avanzar. Así la continuación
// respeta las permutas que se hayan hecho a mano en el camino.

const rotar = (cola) => [cola[cola.length - 1], ...cola.slice(0, -1)];

/** La cola de una semana: [slot0..slot10, quien descansa], o null si no se puede leer. */
export function colaDeSemana(cronograma, lunesISO, vendedores) {
  const L = fromISO(lunesISO);
  const fila = [];
  const vistos = new Set();
  for (const { dia, turno } of LP_SLOTS) {
    const c = cronograma[toISO(addDays(L, dia))];
    if (!c || c.holiday || c.closed || !c[turno]) return null;
    fila.push(c[turno]);
    vistos.add(c[turno]);
  }
  const descansa = vendedores.filter((v) => !vistos.has(v));
  if (descansa.length !== 1) return null;
  return [...fila, descansa[0]];
}

/**
 * Genera los turnos entre `desde` y `hasta` continuando la cola existente.
 * Devuelve { fechaISO: {manana, tarde} } sólo de las fechas nuevas.
 */
function extender(cronograma, feriados, desde, hasta, vendedores) {
  const lunesNuevo = lunesDe(desde);

  // Última semana completa anterior, para saber en qué punto está la cola.
  const previos = Object.keys(cronograma)
    .filter((i) => i < lunesNuevo && fromISO(i).getDay() === 1).sort();
  let cola = null;
  let lunesRef = null;
  for (let i = previos.length - 1; i >= 0; i--) {
    cola = colaDeSemana(cronograma, previos[i], vendedores);
    if (cola) { lunesRef = previos[i]; break; }
  }
  if (!cola) { cola = [...vendedores]; lunesRef = lunesNuevo; }

  // Avanzar la cola hasta la primera semana nueva.
  const semanas = Math.round((fromISO(lunesNuevo) - fromISO(lunesRef)) / 604800000);
  for (let i = 0; i < semanas; i++) cola = rotar(cola);

  const nuevo = {};
  let lunes = fromISO(lunesNuevo);
  const fin = fromISO(hasta);
  while (lunes <= fin) {
    for (let s = 0; s < LP_SLOTS.length; s++) {
      const { dia, turno } = LP_SLOTS[s];
      const iso = toISO(addDays(lunes, dia));
      if (iso < desde || iso > hasta || feriados[iso]) continue;
      (nuevo[iso] = nuevo[iso] || { manana: null, tarde: null })[turno] = cola[s];
    }
    cola = rotar(cola);
    lunes = addDays(lunes, 7);
  }
  return nuevo;
}

export const CONFIG_LP = {
  id: 'lp',
  nombre: 'Laprida 235',
  subtitulo: '12 vendedores en cola cíclica · rotación +1 por semana · 1 descansa cada semana',
  vendedores: LP_VENDS,
  generar,
  extender,
  detectarProblemas,
  reglas: {
    aplicaReglaCierre: false,
    horarioManana: '8 a 14',
    horarioTarde: '14 a 20',
  },
};

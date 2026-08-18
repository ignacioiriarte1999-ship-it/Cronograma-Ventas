// ============================================================
//  CRONOGRAMA — CONTACCENTER
// ============================================================
// Reglas:
//  - 3 vendedores: Imbaud, Ortiz, De Santis.
//  - Ciclo de 3 semanas que rota el cerrador entre los tres:
//      Tipo A: abre Imbaud (L-M)    → cierra Ortiz (S-M)
//      Tipo B: abre Ortiz           → cierra De Santis
//      Tipo C: abre De Santis       → cierra Imbaud
//  - Imbaud: 3 turnos/semana = 2 mañanas + 1 tarde. El sábado-mañana cuenta
//    como mañana en las semanas que le toca cerrar.
//  - Ortiz y De Santis: 4 turnos cada uno, siempre.
//  - Sábado: sólo mañana, la cubre el cerrador del ciclo.
//  - Regla del cierre: quien cierra el sábado abre el lunes siguiente.
//  - Feriados: el día queda cerrado y el ciclo NO se altera.
//  - Los días puntuales que Imbaud toma como 2M+1T y las combinaciones M/T de
//    Ortiz y De Santis rotan entre 12 patrones, para que nadie quede atado a
//    una franja fija (por ejemplo, siempre viernes a la mañana).

import { esqueletoSemestre, lunesDe } from './periodo.js';
import { toISO, fromISO, addDays, formatShort, agruparPorSemanaDesde } from './utils.js';

export const CC_VENDS = ['Imbaud', 'Ortiz', 'De Santis'];

// Semanas tomadas del cronograma real (Excel Jul 2026 – Ene 2027).
// El generador respeta estos valores exactos y el detector no las cuestiona.
// Reemplazaron a una versión anterior que venía de capturas de pantalla y
// discrepaba del Excel en 10 de los 17 turnos de estas tres semanas.
export const CC_SEMANAS_FIJAS = {
  // 03/08 al 08/08 — cierra De Santis
  '2026-08-03': {
    '2026-08-03': { manana: 'Imbaud',     tarde: 'Ortiz' },
    '2026-08-04': { manana: 'De Santis',  tarde: 'Ortiz' },
    '2026-08-05': { manana: 'De Santis',  tarde: 'Ortiz' },
    '2026-08-06': { manana: 'De Santis',  tarde: 'Imbaud' },
    '2026-08-07': { manana: 'Imbaud',     tarde: 'Ortiz' },
    '2026-08-08': { manana: 'De Santis',  tarde: null },
  },
  // 10/08 al 15/08 — cierra Imbaud
  '2026-08-10': {
    '2026-08-10': { manana: 'De Santis',  tarde: 'Imbaud' },
    '2026-08-11': { manana: 'Imbaud',     tarde: 'Ortiz' },
    '2026-08-12': { manana: 'De Santis',  tarde: 'Ortiz' },
    '2026-08-13': { manana: 'De Santis',  tarde: 'Ortiz' },
    '2026-08-14': { manana: 'De Santis',  tarde: 'Ortiz' },
    '2026-08-15': { manana: 'Imbaud',     tarde: null },
  },
  // 17/08 al 22/08 — lunes feriado, cierra Imbaud
  '2026-08-17': {
    '2026-08-18': { manana: 'De Santis',  tarde: 'Ortiz' },
    '2026-08-19': { manana: 'De Santis',  tarde: 'Ortiz' },
    '2026-08-20': { manana: 'Ortiz',      tarde: 'Imbaud' },
    '2026-08-21': { manana: 'Imbaud',     tarde: 'De Santis' },
    '2026-08-22': { manana: 'Imbaud',     tarde: null },
  },
};

export const CC_TIPOS = {
  A: { abre: 'Imbaud',    cierra: 'Ortiz' },
  B: { abre: 'Ortiz',     cierra: 'De Santis' },
  C: { abre: 'De Santis', cierra: 'Imbaud' },
};

export const CC_TIPO_NOMBRES = {
  A: 'Abre Imbaud → Cierra Ortiz',
  B: 'Abre Ortiz → Cierra De Santis',
  C: 'Abre De Santis → Cierra Imbaud',
};

const TIPOS_ORDEN = ['A', 'B', 'C'];
export const tipoDeSemana = (si) => TIPOS_ORDEN[si % 3];

// Combinaciones rotativas para los turnos "libres" de Imbaud.
// Índices de día medio: Ma=1, Mi=2, J=3, V=4.
const COMBOS_1M_1T = [[1, 2], [1, 3], [1, 4], [2, 1], [2, 3], [2, 4],
  [3, 1], [3, 2], [3, 4], [4, 1], [4, 2], [4, 3]];
const COMBOS_2M_1T = [[1, 2, 3], [1, 2, 4], [1, 3, 2], [1, 3, 4], [1, 4, 2], [1, 4, 3],
  [2, 3, 1], [2, 3, 4], [2, 4, 1], [2, 4, 3], [3, 4, 1], [3, 4, 2]];

export /** Con qué tipo empalma una semana, según quién cerró la anterior. */
const tipoQueAbre = (vendedor) =>
  Object.keys(CC_TIPOS).find((t) => CC_TIPOS[t].abre === vendedor) || null;

export function generarSemana(tipo, semIdx) {
  const { abre, cierra } = CC_TIPOS[tipo];
  const w = [{}, {}, {}, {}, {}, {}]; // L, Ma, Mi, J, V, S

  // Fijos por la regla del cierre.
  w[0].manana = abre;
  w[5].manana = cierra;
  w[5].tarde = null;

  if (tipo === 'B') {
    // Imbaud no abre ni cierra: necesita 2 mañanas medias + 1 tarde media.
    const [m1, m2, t] = COMBOS_2M_1T[semIdx % 12];
    w[m1].manana = 'Imbaud';
    w[m2].manana = 'Imbaud';
    w[t].tarde = 'Imbaud';
  } else {
    // Tipo A: ya tiene L-M. Tipo C: ya tiene S-M (cuenta como mañana).
    // En ambos casos le falta 1 mañana media + 1 tarde media.
    const [mM, mT] = COMBOS_1M_1T[semIdx % 12];
    w[mM].manana = 'Imbaud';
    w[mT].tarde = 'Imbaud';
  }

  // Reparto de los slots restantes entre Ortiz y De Santis.
  // Cupos lunes a viernes, descontando el L-M / S-M ya asignados:
  const targets = tipo === 'A' ? { Ortiz: 3, 'De Santis': 4 }
    : tipo === 'B' ? { Ortiz: 3, 'De Santis': 3 }
      : { Ortiz: 4, 'De Santis': 3 };
  const counts = { Ortiz: 0, 'De Santis': 0 };

  const elegir = (par, dia, desempatePar) => {
    // Si el otro turno del mismo día ya lo cubre un no-Imbaud, va el opuesto:
    // nadie hace mañana y tarde el mismo día.
    const parNoImbaud = par && par !== 'Imbaud' ? par : null;
    if (parNoImbaud) return parNoImbaud === 'Ortiz' ? 'De Santis' : 'Ortiz';
    const necO = targets.Ortiz - counts.Ortiz;
    const necD = targets['De Santis'] - counts['De Santis'];
    if (necO > necD) return 'Ortiz';
    if (necD > necO) return 'De Santis';
    return (semIdx + dia) % 2 === 0 ? desempatePar[0] : desempatePar[1];
  };

  for (let d = 0; d < 5; d++) {
    if (!w[d].manana) {
      const pick = elegir(w[d].tarde, d, ['Ortiz', 'De Santis']);
      w[d].manana = pick;
      counts[pick]++;
    }
    if (!w[d].tarde) {
      const pick = elegir(w[d].manana, d, ['De Santis', 'Ortiz']);
      w[d].tarde = pick;
      counts[pick]++;
    }
  }

  return w;
}

function generar(feriados = {}, desde, hasta) {
  const cronograma = esqueletoSemestre(feriados, desde, hasta);
  const semanas = agruparPorSemanaDesde(Object.keys(cronograma).sort());

  for (let i = 0; i < semanas.length; i++) {
    const sem = semanas[i];

    // Semanas verificadas: se copian tal cual.
    const fija = CC_SEMANAS_FIJAS[sem.lunes];
    if (fija) {
      for (const iso of Object.keys(fija)) {
        if (!cronograma[iso] || cronograma[iso].holiday) continue;
        cronograma[iso].manana = fija[iso].manana || null;
        cronograma[iso].tarde = fija[iso].tarde || null;
      }
      continue;
    }

    // El tipo sale de quién cerró el sábado anterior, no del índice: las
    // semanas fijas vienen del cronograma real y corren la fase del ciclo, así
    // que contarlas como si nada rompía la regla del cierre en la costura.
    const lunes = fromISO(sem.lunes);
    const sabAnterior = cronograma[toISO(addDays(lunes, -2))];
    const cerradorPrevio = sabAnterior && !sabAnterior.holiday ? sabAnterior.manana : null;
    const w = generarSemana(tipoQueAbre(cerradorPrevio) || tipoDeSemana(i), i);
    for (let d = 0; d < 6; d++) {
      const iso = toISO(addDays(lunes, d));
      if (!cronograma[iso] || cronograma[iso].holiday) continue;
      cronograma[iso].manana = w[d].manana || null;
      cronograma[iso].tarde = w[d].tarde || null;
    }
  }
  return cronograma;
}

/** Busca un swap M↔T del mismo día para devolverle a Imbaud el 2M+1T. */
function fixImbaudMT(sem, stats) {
  const objetivo = stats.Imbaud.M > 2 && stats.Imbaud.T === 0 ? 'manana'
    : stats.Imbaud.M < 2 && stats.Imbaud.T > 0 ? 'tarde'
      : null;
  if (!objetivo) return null;
  const otro = objetivo === 'manana' ? 'tarde' : 'manana';

  for (const iso of sem.dias.slice(0, 5)) {
    const c = this.cronograma[iso];
    if (!c || c.holiday || c.closed) continue;
    if (c[objetivo] === 'Imbaud' && c[otro] && c[otro] !== 'Imbaud') {
      return {
        iso, turno: objetivo, antes: 'Imbaud', despues: c[otro],
        swapPar: { iso, turno: otro, antes: c[otro], despues: 'Imbaud' },
      };
    }
  }
  return null;
}

function detectarProblemas(sem) {
  const issues = [];
  // Reglas relajadas donde hay feriado y en las semanas verificadas a mano.
  if (this.tieneFeriado(sem)) return issues;
  if (CC_SEMANAS_FIJAS[sem.lunes]) return issues;

  const stats = this.statsSemana(sem);
  const tI = stats.Imbaud.total;
  const tO = stats.Ortiz.total;
  const tD = stats['De Santis'].total;

  // Regla A — Imbaud: 3 turnos, 1 tarde, 2 mañanas (contando el sábado).
  if (tI !== 3) {
    issues.push({
      regla: 'A-imbaud-total', severidad: 'err',
      descripcion: `Imbaud tiene ${tI} turnos; debe tener 3.`, autoFix: null,
    });
  }
  if (stats.Imbaud.T !== 1) {
    issues.push({
      regla: 'A-imbaud-T', severidad: 'err',
      descripcion: `Imbaud debe tener 1 tarde (tiene ${stats.Imbaud.T}).`,
      autoFix: fixImbaudMT.call(this, sem, stats),
    });
  }
  const imbaudManTot = stats.Imbaud.M + stats.Imbaud.S;
  if (imbaudManTot !== 2) {
    issues.push({
      regla: 'A-imbaud-M', severidad: 'err',
      descripcion: `Imbaud debe tener 2 mañanas en la semana (tiene ${imbaudManTot}: ${stats.Imbaud.M} lun-vie + ${stats.Imbaud.S} sáb).`,
      autoFix: fixImbaudMT.call(this, sem, stats),
    });
  }

  // Regla B — totales: Ortiz y De Santis siempre 4. La suma da 11.
  const sumaTotal = tI + tO + tD;
  if (sumaTotal !== 11) {
    issues.push({
      regla: 'B-suma-total', severidad: 'err',
      descripcion: `Suma total de turnos = ${sumaTotal}; debería ser 11.`, autoFix: null,
    });
  }
  if (tO !== 4) {
    issues.push({
      regla: 'B-total-ortiz', severidad: 'err',
      descripcion: `Ortiz tiene ${tO} turnos; debería tener 4.`, autoFix: null,
    });
  }
  if (tD !== 4) {
    issues.push({
      regla: 'B-total-ds', severidad: 'err',
      descripcion: `De Santis tiene ${tD} turnos; debería tener 4.`, autoFix: null,
    });
  }

  // Regla C — el sábado tiene cerrador.
  const sabIso = sem.dias.find((iso) => fromISO(iso).getDay() === 6);
  const cSab = sabIso && this.cronograma[sabIso];
  if (cSab && !cSab.holiday && !cSab.manana) {
    issues.push({
      regla: 'C-sabado-vacio', severidad: 'err',
      descripcion: 'El sábado no tiene mañana asignada.', autoFix: null,
    });
  }

  // Regla D — quien cerró el sábado abre el lunes.
  const lunes = fromISO(sem.lunes);
  const cAnt = this.cronograma[toISO(addDays(lunes, -2))];
  if (cAnt && !cAnt.holiday && !cAnt.closed && cAnt.manana) {
    const cerrador = cAnt.manana;
    const primerIso = sem.dias.slice(0, 6).find((iso) => {
      const c = this.cronograma[iso];
      return c && !c.holiday && !c.closed;
    });
    if (primerIso) {
      const cAct = this.cronograma[primerIso];
      if (cAct.manana && cAct.manana !== cerrador) {
        const actual = cAct.manana;
        const swapValido = cAct.tarde === cerrador;
        issues.push({
          regla: 'D-cierre', severidad: 'err',
          descripcion: `Regla del cierre: ${cerrador} cerró el sábado y debe abrir el ${formatShort(fromISO(primerIso))}. Actualmente tiene a ${actual} en la mañana.`,
          autoFix: swapValido ? {
            iso: primerIso, turno: 'manana', antes: actual, despues: cerrador,
            swapPar: { iso: primerIso, turno: 'tarde', antes: cerrador, despues: actual },
          } : null,
        });
      }
    }
  }

  return issues;
}


// ------------------------------------------------------------
//  CONTINUACIÓN DEL CICLO
// ------------------------------------------------------------
// El tipo de la primera semana nueva no sale de un índice: sale de quién cerró
// el último sábado cargado. Así la extensión empalma con lo que realmente pasó,
// aunque en el camino se haya editado a mano.


/**
 * Genera los turnos entre `desde` y `hasta` continuando el ciclo existente.
 * Devuelve { fechaISO: {manana, tarde} } sólo de las fechas nuevas.
 */
function extender(cronograma, feriados, desde, hasta) {
  const lunesNuevo = lunesDe(desde);

  // Último sábado con cerrador antes del tramo nuevo.
  const sabados = Object.keys(cronograma)
    .filter((i) => i < lunesNuevo && fromISO(i).getDay() === 6).sort();
  let cerrador = null;
  for (let i = sabados.length - 1; i >= 0; i--) {
    const c = cronograma[sabados[i]];
    if (c && !c.holiday && c.manana) { cerrador = c.manana; break; }
  }

  // Quien cerró abre la semana siguiente: ese es el tipo con el que arranca.
  const ORDEN = ['A', 'B', 'C'];
  const inicial = tipoQueAbre(cerrador) || 'A';
  let idx = ORDEN.indexOf(inicial);

  // El contador de combos sigue contando semanas, para que los días puntuales
  // de Imbaud no se repitan al reanudar.
  let semIdx = Object.keys(cronograma).filter((i) => fromISO(i).getDay() === 1).length;

  const nuevo = {};
  let lunes = fromISO(lunesNuevo);
  const fin = fromISO(hasta);
  while (lunes <= fin) {
    const w = generarSemana(ORDEN[idx % 3], semIdx);
    for (let d = 0; d < 6; d++) {
      const iso = toISO(addDays(lunes, d));
      if (iso < desde || iso > hasta || feriados[iso]) continue;
      nuevo[iso] = { manana: w[d].manana || null, tarde: d === 5 ? null : (w[d].tarde || null) };
    }
    idx++; semIdx++;
    lunes = addDays(lunes, 7);
  }
  return nuevo;
}

export const CONFIG_CC = {
  id: 'cc',
  nombre: 'ContacCenter',
  subtitulo: '3 vendedores · ciclo de 3 semanas que rota el sábado · Imbaud 3 turnos (2M+1T) · Ortiz y De Santis 4 turnos · regla del cierre activa',
  vendedores: CC_VENDS,
  generar,
  extender,
  detectarProblemas,
  reglas: {
    aplicaReglaCierre: true,
    horarioManana: '8 a 14',
    horarioTarde: '14 a 20',
  },
};

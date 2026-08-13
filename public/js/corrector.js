// ============================================================
//  CORRECTOR DE REGLAS
// ============================================================
// Recorre las semanas, detecta violaciones a las reglas del cronograma y
// propone (o aplica) los intercambios que las resuelven.

import { fromISO, formatShort, esc, agruparPorSemanaDesde } from './utils.js';

let pendientes = [];

const semanasDe = (mod) => agruparPorSemanaDesde(Object.keys(mod.cronograma).sort());

/** Aplica un fix al cronograma y lo anota en el historial. Devuelve el registro. */
function aplicar(mod, problema, sufijoRegla = '') {
  const af = problema.autoFix;
  const antes = mod.cronograma[af.iso][af.turno];
  mod.cronograma[af.iso][af.turno] = af.despues;
  if (af.swapPar) {
    mod.cronograma[af.swapPar.iso][af.swapPar.turno] = af.swapPar.despues;
  }
  const registro = {
    ts: Date.now(),
    regla: problema.regla + sufijoRegla,
    estado: 'aplicada',
    descripcion: problema.descripcion,
    diff: {
      antes: `${formatShort(fromISO(af.iso))} ${af.turno}: ${antes || '—'}`,
      despues: String(af.despues),
    },
  };
  mod.historial.push(registro);
  return registro;
}

// ------------------------------------------------------------
//  REVISIÓN CON APROBACIÓN MANUAL
// ------------------------------------------------------------
export function revisar(mod, forzarTodo) {
  const semanas = semanasDe(mod);
  const fixes = [];
  let revisadas = 0;
  let salteadas = 0;

  for (let si = 0; si < semanas.length; si++) {
    const sem = semanas[si];
    const firma = mod.firmarSemana(sem);
    if (!forzarTodo && mod.revisiones[sem.lunes] === firma) { salteadas++; continue; }
    revisadas++;
    for (const p of mod.detectarProblemas(sem, si)) {
      fixes.push({ modId: mod.id, sem, semIdx: si, problema: p });
    }
    mod.revisiones[sem.lunes] = firma;
  }

  mod.guardar();
  mostrarModal(mod, fixes, revisadas, salteadas);
}

function mostrarModal(mod, fixes, revisadas, salteadas) {
  pendientes = fixes.map((f) => ({ ...f, mod, resuelto: false }));

  document.getElementById('modal-fixes-summary').innerHTML =
    `Se revisaron <b>${revisadas}</b> semana(s) (${salteadas} sin cambios desde la última revisión). ` +
    (fixes.length === 0
      ? '<span class="ok-txt">Sin problemas detectados. 🎉</span>'
      : `Se detectaron <b>${fixes.length}</b> problema(s).`);

  const conFix = fixes.filter((f) => f.problema.autoFix).length;
  document.getElementById('modal-fixes-acciones').style.display = conFix > 0 ? 'flex' : 'none';

  document.getElementById('modal-fixes-list').innerHTML = pendientes.map((f, i) => {
    const af = f.problema.autoFix;
    const cambio = af
      ? `<div class="cambio">${formatShort(fromISO(af.iso))} ${af.turno}:
           <span class="before">${esc(af.antes || '—')}</span> → <span class="after">${esc(af.despues)}</span></div>`
      : '<div class="cambio muted">Sin corrección automática — requiere edición manual.</div>';
    return `<div class="fix-item" id="fix-${i}">
      <div>
        <span class="regla">${esc(f.problema.regla)}</span>
        <span class="sev-${f.problema.severidad}">${f.problema.severidad.toUpperCase()}</span>
        <span class="muted small">Sem ${f.semIdx + 1} (${formatShort(fromISO(f.sem.lunes))})</span>
      </div>
      <div class="mt-4">${esc(f.problema.descripcion)}</div>
      ${cambio}
      <div class="actions">
        ${af ? `<button class="btn-primary" data-accion="fix-aplicar" data-i="${i}">Aplicar</button>` : ''}
        <button class="btn-secondary" data-accion="fix-rechazar" data-i="${i}">Rechazar</button>
      </div>
    </div>`;
  }).join('');

  document.getElementById('modal-fixes').classList.add('open');
}

export function aplicarFix(i) {
  const f = pendientes[i];
  if (!f || f.resuelto || !f.problema.autoFix) return;
  aplicar(f.mod, f.problema);
  f.resuelto = true;
  f.mod.guardar();
  document.getElementById(`fix-${i}`)?.classList.add('applied');
  f.mod.onCambio?.(f.mod);
}

export function rechazarFix(i) {
  const f = pendientes[i];
  if (!f || f.resuelto) return;
  f.mod.historial.push({
    ts: Date.now(), regla: f.problema.regla, estado: 'rechazada',
    descripcion: f.problema.descripcion, diff: null,
  });
  f.resuelto = true;
  f.mod.guardar();
  document.getElementById(`fix-${i}`)?.classList.add('rejected');
  f.mod.onCambio?.(f.mod);
}

export function aplicarTodas() {
  pendientes.forEach((f, i) => { if (f.problema.autoFix) aplicarFix(i); });
}

export function rechazarTodas() {
  pendientes.forEach((_, i) => rechazarFix(i));
}

// ------------------------------------------------------------
//  CORRECCIÓN EN CADENA
// ------------------------------------------------------------
// Aplica repetidamente la corrección de mayor prioridad hasta que no quedan
// fixes automáticos. Corta si vuelve a ver un estado ya visitado, porque eso
// significa que dos reglas se están pisando y el ciclo no converge.

const PRIORIDAD = [
  'D-cierre', 'A-imbaud-T', 'A-imbaud-M', 'A-imbaud-total',
  'B-total-ortiz', 'B-total-ds', 'B-suma-total',
  'A-slot-vacio', 'B-duplicado', 'C-typo', 'C-sabado-vacio',
];
const rank = (regla) => {
  const i = PRIORIDAD.indexOf(regla);
  return i === -1 ? 999 : i;
};

export function corregirAutomatico(mod) {
  const stats = { iters: 0, aplicadas: 0, sinFix: 0, oscilacion: false };
  const vistos = new Set();
  const MAX = 200;

  for (let iter = 0; iter < MAX; iter++) {
    stats.iters++;

    const firma = JSON.stringify(mod.cronograma);
    if (vistos.has(firma)) { stats.oscilacion = true; break; }
    vistos.add(firma);

    const semanas = semanasDe(mod);
    const problemas = [];
    for (let si = 0; si < semanas.length; si++) {
      for (const p of mod.detectarProblemas(semanas[si], si)) problemas.push(p);
    }
    if (problemas.length === 0) break;

    problemas.sort((a, b) => rank(a.regla) - rank(b.regla));
    const siguiente = problemas.find((p) => p.autoFix);
    if (!siguiente) {
      // Sólo quedan problemas que requieren decisión humana.
      stats.sinFix = problemas.length;
      break;
    }

    aplicar(mod, siguiente, ' (auto)');
    stats.aplicadas++;
  }

  mod.guardar();
  mod.onCambio?.(mod);
  mostrarResumen(stats);
}

function mostrarResumen(stats) {
  document.getElementById('modal-ia-body').innerHTML = `
    <div class="info-box">Se revisó el cronograma en cadena, aplicando las reglas de mayor a menor prioridad.</div>
    <div class="stat-row"><span class="lbl">Pasadas</span><span class="val">${stats.iters}</span></div>
    <div class="stat-row"><span class="lbl">Correcciones aplicadas</span><span class="val ok-txt">${stats.aplicadas}</span></div>
    <div class="stat-row"><span class="lbl">Pendientes de resolver a mano</span><span class="val warn-txt">${stats.sinFix}</span></div>
    ${stats.oscilacion ? '<div class="warn-box mt-10">⚠️ Se detectó una oscilación: la misma configuración se repitió. Se cortó para no entrar en loop; revisá esas semanas a mano.</div>' : ''}
    <div class="muted small mt-12">Mirá el historial en el panel lateral para ver el detalle de cada corrección.</div>`;
  document.getElementById('modal-ia').classList.add('open');
}

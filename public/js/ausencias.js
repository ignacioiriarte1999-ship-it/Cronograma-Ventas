// ============================================================
//  AUSENCIAS Y REEMPLAZOS
// ============================================================
// Cargar una ausencia no toca el cronograma por su cuenta. Lo que hace es
// listar los turnos que quedan descubiertos y proponer para cada uno un
// reemplazo, que el admin aprueba o rechaza de a uno. Aplicarlos solo sería
// más rápido y mucho peor: el reparto de turnos es algo que el encargado
// negocia con su gente, no una cuenta que cierre sola.

import { sb, traducirDb } from './db.js';
import { esc, fromISO, formatShort } from './utils.js';
import { nom, texto } from './alias.js';

const TURNOS = ['manana', 'tarde'];
const ETIQUETA = { manana: 'mañana', tarde: 'tarde' };

export const TIPOS = ['vacaciones', 'licencia', 'franco'];

// ------------------------------------------------------------
//  ALTA Y BAJA
// ------------------------------------------------------------

export async function crearAusencia({ vendedorId, tipo, desde, hasta, nota }) {
  if (!TIPOS.includes(tipo)) throw new Error(`Tipo desconocido: ${tipo}`);
  if (hasta < desde) throw new Error('La fecha de fin es anterior a la de inicio.');

  const { error } = await sb.from('ausencias')
    .insert({ vendedor_id: vendedorId, tipo, desde, hasta, nota: nota || null });
  if (error) throw new Error(traducirDb(error));
}

export async function borrarAusencia(id) {
  const { error } = await sb.from('ausencias').delete().eq('id', id);
  if (error) throw new Error(traducirDb(error));
}

// ------------------------------------------------------------
//  QUÉ QUEDA DESCUBIERTO
// ------------------------------------------------------------

/** Los turnos que el ausente tenía asignados dentro del tramo. */
export function turnosAfectados(mod, { vendedor, desde, hasta }) {
  const afectados = [];
  for (const [iso, celda] of Object.entries(mod.cronograma)) {
    if (iso < desde || iso > hasta) continue;
    if (celda.holiday || celda.closed) continue;
    for (const turno of TURNOS) {
      if (celda[turno] === vendedor) afectados.push({ iso, turno });
    }
  }
  return afectados.sort((a, b) => (a.iso === b.iso ? a.turno.localeCompare(b.turno) : a.iso.localeCompare(b.iso)));
}

/** Cuántos turnos tiene cada uno en la semana de esa fecha. */
function cargaDeLaSemana(mod, iso) {
  const d = fromISO(iso);
  const lunes = new Date(d);
  lunes.setDate(lunes.getDate() - ((d.getDay() + 6) % 7));
  const carga = new Map();

  for (let i = 0; i < 7; i++) {
    const dia = new Date(lunes);
    dia.setDate(dia.getDate() + i);
    const clave = `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, '0')}-${String(dia.getDate()).padStart(2, '0')}`;
    const celda = mod.cronograma[clave];
    if (!celda) continue;
    for (const turno of TURNOS) {
      const v = celda[turno];
      if (v) carga.set(v, (carga.get(v) || 0) + 1);
    }
  }
  return carga;
}

/** Quién ya trabaja ese día, en cualquier turno. */
const ocupadosEse = (mod, iso) =>
  TURNOS.map((t) => mod.cronograma[iso]?.[t]).filter(Boolean);

/**
 * Propone un reemplazo por turno descubierto.
 *
 * Elige entre los disponibles ese día, salteando a quien ya trabaja en la
 * jornada, y prefiere al que menos turnos tiene esa semana: así el hueco lo
 * cubre quien está más liviano y el reparto no se desbalancea.
 *
 * Devuelve `despues: null` cuando no hay nadie; el admin lo ve igual, porque
 * un turno sin cubrir es justamente lo que tiene que saber.
 */
export function proponerReemplazos(mod, ausencia) {
  const propuestas = [];

  for (const { iso, turno } of turnosAfectados(mod, ausencia)) {
    const carga = cargaDeLaSemana(mod, iso);
    const ocupados = ocupadosEse(mod, iso);

    const candidatos = mod.disponiblesEn(iso)
      .filter((v) => v !== ausencia.vendedor && !ocupados.includes(v))
      .sort((a, b) => (carga.get(a) || 0) - (carga.get(b) || 0));

    propuestas.push({ iso, turno, antes: ausencia.vendedor, despues: candidatos[0] || null });
  }
  return propuestas;
}

// ------------------------------------------------------------
//  MODAL DE APROBACIÓN
// ------------------------------------------------------------

let pendientes = [];
let moduloActual = null;

export function mostrarReemplazos(mod, ausencia, propuestas) {
  moduloActual = mod;
  pendientes = propuestas.map((p) => ({ ...p, estado: 'pendiente' }));

  const titulo = document.getElementById('modal-ia-titulo');
  const body = document.getElementById('modal-ia-body');
  if (!titulo || !body) return;

  titulo.textContent = `Turnos afectados por la ausencia de ${nom(ausencia.vendedor)}`;
  pintar();
  document.getElementById('modal-ia').classList.add('open');
}

function pintar() {
  const body = document.getElementById('modal-ia-body');
  if (!body) return;

  if (!pendientes.length) {
    body.innerHTML = '<div class="info-box">La ausencia no pisa ningún turno asignado. '
      + 'No hay nada que reemplazar.</div>';
    return;
  }

  const quedan = pendientes.filter((p) => p.estado === 'pendiente');
  const sinCubrir = pendientes.filter((p) => p.estado === 'pendiente' && !p.despues).length;

  body.innerHTML = `
    <div class="info-box">La ausencia no se aplica sola. Estos son los turnos que quedan
    descubiertos, con un reemplazo propuesto entre los disponibles de ese día — se prefiere
    a quien menos turnos tiene esa semana. Aprobá los que te sirvan.</div>
    ${sinCubrir ? `<div class="warn-box">${sinCubrir} turno(s) sin nadie disponible ese día.
      Hay que resolverlos a mano.</div>` : ''}
    <div class="fix-list">
      ${pendientes.map((p, i) => `
        <div class="fix-item ${p.estado}">
          <div class="regla">${esc(formatShort(fromISO(p.iso)))} · ${ETIQUETA[p.turno]}</div>
          <div class="desc">
            <span class="before">${esc(nom(p.antes))}</span> →
            ${p.despues
              ? `<span class="after">${esc(nom(p.despues))}</span>`
              : '<span class="warn-txt">sin reemplazo posible</span>'}
          </div>
          ${p.estado === 'pendiente' && p.despues ? `
            <div class="fix-acciones">
              <button class="btn-primary" data-accion="reemplazo-aplicar" data-i="${i}">Aprobar</button>
              <button class="btn-secondary" data-accion="reemplazo-rechazar" data-i="${i}">Rechazar</button>
            </div>` : `<div class="muted small">${esc(estadoTexto(p))}</div>`}
        </div>`).join('')}
    </div>
    ${quedan.some((p) => p.despues) ? `
      <div class="btn-row mt-8">
        <button class="btn-primary" data-accion="reemplazo-aplicar-todos">Aprobar todos los propuestos</button>
        <button class="btn-secondary" data-accion="reemplazo-rechazar-todos">Rechazar todos</button>
      </div>` : ''}`;
}

const estadoTexto = (p) => ({
  aplicado: '✓ aplicado',
  rechazado: 'rechazado',
  pendiente: 'sin reemplazo',
}[p.estado] || p.estado);

async function aplicar(i) {
  const p = pendientes[i];
  if (!p || p.estado !== 'pendiente' || !p.despues) return;
  const ok = await moduloActual.asignarCelda(p.iso, p.turno, p.despues);
  p.estado = ok ? 'aplicado' : 'pendiente';
  pintar();
}

export async function aplicarReemplazo(i) { await aplicar(Number(i)); }

export function rechazarReemplazo(i) {
  const p = pendientes[Number(i)];
  if (p) p.estado = 'rechazado';
  pintar();
}

export async function aplicarTodosLosReemplazos() {
  for (let i = 0; i < pendientes.length; i++) await aplicar(i);
}

export function rechazarTodosLosReemplazos() {
  for (const p of pendientes) if (p.estado === 'pendiente') p.estado = 'rechazado';
  pintar();
}

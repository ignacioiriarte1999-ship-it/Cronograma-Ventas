// ============================================================
//  INTERCAMBIOS DE TURNO
// ============================================================
// Un vendedor propone cambiar uno de sus turnos por el de un compañero. El
// pedido espera la aprobación de un admin; recién ahí se tocan los turnos, y
// sólo esos dos. Como cada turno es una fila propia, el cambio no se propaga
// a las semanas siguientes.

import { sb, traducirDb } from './db.js';
import { getSession, esAdmin } from './auth.js';
import { getModulo } from './modules.js';
import { fromISO, formatLargo, agruparPorSemanaDesde } from './utils.js';

const SELECT = `id, punto_venta, solicitante, motivo, estado, nota_admin, creado, resuelto,
  vendedor_pide, fecha_pide, turno_pide,
  vendedor_recibe, fecha_recibe, turno_recibe,
  pide:vendedores!intercambios_vendedor_pide_fkey ( nombre ),
  recibe:vendedores!intercambios_vendedor_recibe_fkey ( nombre )`;

const normalizar = (r) => ({
  id: r.id,
  puntoVenta: r.punto_venta,
  solicitante: r.solicitante,
  motivo: r.motivo,
  estado: r.estado,
  notaAdmin: r.nota_admin,
  creado: r.creado,
  resuelto: r.resuelto,
  pide: { id: r.vendedor_pide, nombre: r.pide?.nombre, fecha: r.fecha_pide, turno: r.turno_pide },
  recibe: { id: r.vendedor_recibe, nombre: r.recibe?.nombre, fecha: r.fecha_recibe, turno: r.turno_recibe },
});

export const describirTurno = (t) =>
  `${formatLargo(fromISO(t.fecha))} · ${t.turno === 'manana' ? 'mañana' : 'tarde'}`;

// ------------------------------------------------------------
//  CONSULTAS
// ------------------------------------------------------------
export async function listarPedidos({ estado = null, limite = 50 } = {}) {
  let q = sb.from('intercambios').select(SELECT).order('creado', { ascending: false }).limit(limite);
  if (estado) q = q.eq('estado', estado);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(normalizar);
}

export async function contarPendientes() {
  const { count, error } = await sb.from('intercambios')
    .select('*', { count: 'exact', head: true }).eq('estado', 'pendiente');
  return error ? 0 : (count || 0);
}

/** Avisa cuando cambia algo, para refrescar el contador sin recargar. */
export function suscribirPedidos(alCambiar) {
  return sb.channel('intercambios')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'intercambios' }, alCambiar)
    .subscribe();
}

// ------------------------------------------------------------
//  ALTA
// ------------------------------------------------------------
export async function crearPedido({ puntoVenta, mio, suyo, vendedorSuyoId, motivo }) {
  const sess = getSession();
  const mod = getModulo(puntoVenta);
  const vendedorMioId = mod?._idPorNombre.get(sess.vendedor);
  if (!vendedorMioId) throw new Error('No se pudo identificar tu ficha de vendedor.');

  const { error } = await sb.from('intercambios').insert({
    punto_venta: puntoVenta,
    solicitante: sess.uid,
    vendedor_pide: vendedorMioId,
    fecha_pide: mio.fecha,
    turno_pide: mio.turno,
    vendedor_recibe: vendedorSuyoId,
    fecha_recibe: suyo.fecha,
    turno_recibe: suyo.turno,
    motivo: motivo || null,
  });
  if (error) {
    if (error.code === '23505') {
      throw new Error('Ya hay un pedido pendiente sobre alguno de esos dos turnos.');
    }
    throw new Error(traducirDb(error));
  }
}

export async function cancelarPedido(id) {
  const { error } = await sb.from('intercambios').delete().eq('id', id);
  if (error) throw new Error(traducirDb(error));
}

// ------------------------------------------------------------
//  VALIDACIÓN
// ------------------------------------------------------------
/**
 * Simula el intercambio y reporta qué se rompería.
 *
 * En vez de reimplementar las reglas, aplica el cambio sobre una copia y
 * vuelve a correr el detector sobre las semanas afectadas: cualquier problema
 * que no existiera antes es consecuencia del cambio.
 */
export function revisarImpacto(mod, pedido) {
  const problemas = [];
  const { pide, recibe } = pedido;

  const cA = mod.cronograma[pide.fecha];
  const cB = mod.cronograma[recibe.fecha];
  if (!cA || !cB) return ['Alguno de los dos turnos está fuera del período cargado.'];
  if (cA.holiday || cA.closed) problemas.push(`El ${pide.fecha} es feriado o está cerrado.`);
  if (cB.holiday || cB.closed) problemas.push(`El ${recibe.fecha} es feriado o está cerrado.`);

  // ¿Siguen siendo de quienes decían? Pudo editarse desde que se pidió.
  if (cA[pide.turno] !== pide.nombre) {
    problemas.push(`El turno de ${describirTurno(pide)} ya no es de ${pide.nombre}, ahora es de ${cA[pide.turno] || 'nadie'}.`);
  }
  if (cB[recibe.turno] !== recibe.nombre) {
    problemas.push(`El turno de ${describirTurno(recibe)} ya no es de ${recibe.nombre}, ahora es de ${cB[recibe.turno] || 'nadie'}.`);
  }
  if (problemas.length) return problemas;

  // Copia con el cambio aplicado, para comparar contra el estado actual.
  const copia = {};
  for (const [iso, c] of Object.entries(mod.cronograma)) copia[iso] = { ...c };
  copia[pide.fecha][pide.turno] = recibe.nombre;
  copia[recibe.fecha][recibe.turno] = pide.nombre;

  const semanas = agruparPorSemanaDesde(Object.keys(copia).sort());
  const afectadas = semanas.filter((s) => s.dias.includes(pide.fecha) || s.dias.includes(recibe.fecha));
  const simulado = { ...mod, cronograma: copia };

  for (const sem of afectadas) {
    const antes = mod.detectarProblemas(sem).map((p) => p.descripcion);
    const despues = mod.detectarProblemas.call(simulado, sem).map((p) => p.descripcion);
    for (const d of despues) if (!antes.includes(d)) problemas.push(d);
  }
  return problemas;
}

// ------------------------------------------------------------
//  RESOLUCIÓN
// ------------------------------------------------------------
export async function aprobarPedido(pedido, nota = null) {
  if (!esAdmin()) throw new Error('Sólo un administrador puede aprobar un intercambio.');
  const mod = getModulo(pedido.puntoVenta);
  if (!mod) throw new Error('No se encontró el cronograma del pedido.');

  const { pide, recibe } = pedido;
  const ok = await mod.aplicarCambios([
    { iso: pide.fecha, turno: pide.turno, vendedor: recibe.nombre },
    { iso: recibe.fecha, turno: recibe.turno, vendedor: pide.nombre },
  ]);
  if (!ok) throw new Error('No se pudieron aplicar los turnos.');

  await mod.registrarHistorial({
    ts: Date.now(),
    regla: 'intercambio',
    estado: 'aplicada',
    descripcion: `Intercambio aprobado entre ${pide.nombre} y ${recibe.nombre}.`,
    diff: {
      antes: `${describirTurno(pide)}: ${pide.nombre}`,
      despues: `${recibe.nombre}`,
    },
  });

  const { error } = await sb.from('intercambios')
    .update({ estado: 'aprobado', nota_admin: nota }).eq('id', pedido.id);
  if (error) throw new Error(traducirDb(error));
}

export async function rechazarPedido(pedido, nota = null) {
  if (!esAdmin()) throw new Error('Sólo un administrador puede rechazar un intercambio.');
  const { error } = await sb.from('intercambios')
    .update({ estado: 'rechazado', nota_admin: nota }).eq('id', pedido.id);
  if (error) throw new Error(traducirDb(error));
}

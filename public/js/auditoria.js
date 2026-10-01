// ============================================================
//  HISTORIAL DE CAMBIOS
// ============================================================
// Quién tocó qué, cuándo, y con qué valores. Lo escriben triggers en la base,
// no la app: un insert desde el navegador se puede saltear llamando a la API
// directo, y entonces el historial deja de ser una garantía. Acá sólo se lee.
//
// La RLS deja leer la tabla únicamente al rol superadmin, así que esconder la
// sección es cosmética: un admin que llame a la API igual no ve nada.

import { sb } from './db.js';
import { esc, fromISO } from './utils.js';
import { nom, texto } from './alias.js';

/** Qué tabla es qué, en el idioma del panel. */
const ENTIDADES = {
  turnos: 'turno',
  feriados: 'feriado',
  perfiles: 'usuario',
  vendedores: 'vendedor',
  ausencias: 'ausencia',
  intercambios: 'pedido de cambio',
};

export const ETIQUETA_ENTIDAD = (e) => ENTIDADES[e] || e;

const ACCIONES = { alta: 'alta', cambio: 'cambio', baja: 'baja' };
export const ACCIONES_POSIBLES = Object.keys(ACCIONES);
export const ENTIDADES_POSIBLES = Object.keys(ENTIDADES);

/**
 * Lee el historial con los filtros del panel.
 *
 * `hasta` se corre un día para adelante porque la columna es un instante y el
 * filtro una fecha: sin eso, filtrar "hasta el 5" dejaría afuera todo lo que
 * pasó el 5 después de medianoche.
 */
export async function listarAuditoria({ desde, hasta, usuario, puntoVenta, entidad, accion, limite = 200 } = {}) {
  let q = sb.from('auditoria')
    .select('id, ts, actor_usuario, punto_venta, accion, entidad, clave, antes, despues')
    .order('ts', { ascending: false })
    .limit(limite);

  if (desde) q = q.gte('ts', `${desde}T00:00:00`);
  if (hasta) {
    const d = fromISO(hasta);
    d.setDate(d.getDate() + 1);
    q = q.lt('ts', `${d.toISOString().slice(0, 10)}T00:00:00`);
  }
  if (usuario) q = q.ilike('actor_usuario', `%${usuario}%`);
  if (puntoVenta) q = q.eq('punto_venta', puntoVenta);
  if (entidad) q = q.eq('entidad', entidad);
  if (accion) q = q.eq('accion', accion);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** Los usuarios que figuran en el historial, para el desplegable del filtro. */
export async function autoresDelHistorial() {
  const { data, error } = await sb
    .from('auditoria').select('actor_usuario').limit(1000);
  if (error) return [];
  return [...new Set((data || []).map((f) => f.actor_usuario).filter(Boolean))].sort();
}

/**
 * Resume un cambio en una línea legible.
 *
 * Las filas guardan el registro entero en JSON, que es lo correcto para
 * auditar pero ilegible para mirar. Acá se saca lo que cambió de verdad.
 */
export function describirCambio(f) {
  const antes = f.antes || {};
  const despues = f.despues || {};

  if (f.accion === 'alta') return resumirFila(f.entidad, despues);
  if (f.accion === 'baja') return resumirFila(f.entidad, antes);

  const campos = [...new Set([...Object.keys(antes), ...Object.keys(despues)])]
    .filter((k) => !['actualizado', 'creado', 'id'].includes(k))
    .filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k]));

  if (!campos.length) return 'sin cambios visibles';
  return campos.map((k) => `${k}: ${valor(k, antes[k])} → ${valor(k, despues[k])}`).join(' · ');
}

function resumirFila(entidad, fila) {
  if (entidad === 'turnos') return `${fila.fecha} ${fila.turno} → ${valor('vendedor_id', fila.vendedor_id)}`;
  if (entidad === 'feriados') return `${fila.fecha}: ${texto(fila.motivo || '')}`;
  if (entidad === 'perfiles') return `${fila.usuario} (${fila.rol})`;
  if (entidad === 'ausencias') return `${fila.tipo} ${fila.desde} → ${fila.hasta}`;
  return Object.entries(fila)
    .filter(([k]) => !['id', 'creado'].includes(k))
    .slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' · ');
}

// Los ids de vendedor no le dicen nada a nadie; el nombre sí. El mapa lo
// llena la app al abrir el panel, porque acá no hay módulos cargados.
let nombrePorId = new Map();
export const definirVendedores = (mapa) => { nombrePorId = mapa; };

function valor(campo, v) {
  if (v === null || v === undefined) return '—';
  if (campo === 'vendedor_id') return nom(nombrePorId.get(Number(v)) || `#${v}`);
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  return String(v);
}

/** La fila entera, para cuando el resumen no alcanza. */
export const detalleCrudo = (f) =>
  esc(JSON.stringify({ antes: f.antes, despues: f.despues }, null, 2));

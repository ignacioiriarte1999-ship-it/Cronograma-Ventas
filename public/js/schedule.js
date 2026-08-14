// ============================================================
//  MÓDULO DE CRONOGRAMA (base compartida CC / LP)
// ============================================================
// En memoria el cronograma sigue siendo { fechaISO: {manana, tarde, holiday,
// closed} }, que es lo que consumen el render y el corrector. En la base, en
// cambio, cada turno asignado es una fila: editar una celda toca una fila, no
// el semestre entero, así que dos admins editando a la vez ya no se pisan.

import { sb, traducirDb } from './db.js';
import { esAdmin, getSession } from './auth.js';
import { esqueletoSemestre, rangoDeFechas } from './periodo.js';
import { fromISO, DIAS_LARGOS } from './utils.js';

const avisarError = (contexto, error) => {
  console.error(contexto, error);
  alert(`${contexto}\n\n${traducirDb(error)}`);
};

export function crearModulo(config) {
  return {
    id: config.id,
    nombre: config.nombre,
    subtitulo: config.subtitulo,
    vendedores: config.vendedores,
    reglas: config.reglas,
    generar: config.generar,
    detectarProblemas: config.detectarProblemas,

    cronograma: {},
    feriados: {},
    desde: null,
    hasta: null,
    historial: [],
    revisiones: {},

    /** nombre → id y id → nombre, para traducir entre la app y la base. */
    _idPorNombre: new Map(),
    _nombrePorId: new Map(),
    _canal: null,
    onCambio: null,

    // --------------------------------------------------------
    //  CARGA
    // --------------------------------------------------------
    async cargar() {
      const pv = this.id;
      const [vend, turnos, feriados, hist, revs] = await Promise.all([
        sb.from('vendedores').select('id, nombre, orden').eq('punto_venta', pv).order('orden'),
        sb.from('turnos').select('fecha, turno, vendedor_id').eq('punto_venta', pv),
        sb.from('feriados').select('fecha, motivo').eq('punto_venta', pv),
        sb.from('historial').select('*').eq('punto_venta', pv).order('ts', { ascending: false }).limit(100),
        sb.from('revisiones').select('lunes, firma').eq('punto_venta', pv),
      ]);

      for (const r of [vend, turnos, feriados, hist, revs]) {
        if (r.error) { avisarError(`No se pudo cargar ${this.nombre}.`, r.error); return false; }
      }

      this._idPorNombre.clear();
      this._nombrePorId.clear();
      for (const v of vend.data) {
        this._idPorNombre.set(v.nombre, v.id);
        this._nombrePorId.set(v.id, v.nombre);
      }

      const faltantes = config.vendedores.filter((n) => !this._idPorNombre.has(n));
      if (faltantes.length) {
        console.warn(`${pv}: faltan vendedores en la base: ${faltantes.join(', ')}`);
      }

      this.feriados = Object.fromEntries(feriados.data.map((f) => [f.fecha, f.motivo]));

      // El período sale de lo que hay cargado, no de una constante: así cada
      // punto de venta muestra su propio alcance sin semanas vacías al final.
      const fechas = turnos.data.map((t) => t.fecha).concat(feriados.data.map((f) => f.fecha));
      [this.desde, this.hasta] = rangoDeFechas(fechas);

      this.cronograma = esqueletoSemestre(this.feriados, this.desde, this.hasta);
      for (const t of turnos.data) {
        const celda = this.cronograma[t.fecha];
        if (!celda) continue;
        celda[t.turno] = this._nombrePorId.get(t.vendedor_id) || null;
      }

      this.historial = hist.data.map((h) => ({
        ts: new Date(h.ts).getTime(),
        regla: h.regla,
        estado: h.estado,
        descripcion: h.descripcion,
        diff: h.diff_antes ? { antes: h.diff_antes, despues: h.diff_despues } : null,
      })).reverse();

      this.revisiones = Object.fromEntries(revs.data.map((r) => [r.lunes, r.firma]));

      console.info(`[${this.id}] cargado —`, {
        vendedores: vend.data.length,
        turnos: turnos.data.length,
        feriados: feriados.data.length,
        historial: hist.data.length,
      });
      return true;
    },

    /** ¿La base está vacía para este punto de venta? */
    estaVacio() {
      return !Object.values(this.cronograma).some((c) => c.manana || c.tarde);
    },

    // --------------------------------------------------------
    //  REALTIME
    // --------------------------------------------------------
    suscribir() {
      if (this._canal) return;
      let pendiente = null;
      const recargar = () => {
        // Una corrección en cadena dispara decenas de eventos seguidos;
        // sin esto recargaríamos una vez por fila.
        clearTimeout(pendiente);
        pendiente = setTimeout(async () => {
          await this.cargar();
          this.onCambio?.(this);
        }, 250);
      };

      this._canal = sb.channel(`cronograma-${this.id}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'turnos', filter: `punto_venta=eq.${this.id}` },
          recargar)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'feriados', filter: `punto_venta=eq.${this.id}` },
          recargar)
        .subscribe();
    },

    desuscribir() {
      if (this._canal) { sb.removeChannel(this._canal); this._canal = null; }
    },

    // --------------------------------------------------------
    //  CONSULTAS
    // --------------------------------------------------------
    idxVendedor(v) { return this.vendedores.indexOf(v); },
    pillClass(v) {
      const i = this.idxVendedor(v);
      return i >= 0 ? `v${i % 12}` : '';
    },

    firmarSemana(sem) {
      const p = [];
      for (const iso of sem.dias) {
        const c = this.cronograma[iso];
        if (!c) continue;
        if (c.holiday) p.push(`${iso}:H`);
        else if (c.closed) p.push(`${iso}:C`);
        else p.push(`${iso}:M=${c.manana || '-'}|T=${c.tarde || '-'}`);
      }
      return p.join('||');
    },

    statsSemana(sem) {
      const stats = {};
      for (const v of this.vendedores) stats[v] = { M: 0, T: 0, S: 0, total: 0 };
      for (const iso of sem.dias) {
        const c = this.cronograma[iso];
        if (!c || c.holiday || c.closed) continue;
        const esSabado = fromISO(iso).getDay() === 6;
        if (c.manana && stats[c.manana]) {
          if (esSabado) stats[c.manana].S++;
          else stats[c.manana].M++;
          stats[c.manana].total++;
        }
        if (c.tarde && stats[c.tarde]) {
          stats[c.tarde].T++;
          stats[c.tarde].total++;
        }
      }
      return stats;
    },

    tieneFeriado(sem) {
      return sem.dias.some((iso) => this.cronograma[iso]?.holiday);
    },

    // --------------------------------------------------------
    //  MUTACIONES
    // --------------------------------------------------------
    /** Traduce {iso, turno, vendedor} a las filas que hay que escribir o borrar. */
    _partirCambios(cambios) {
      const upserts = [];
      const borrados = [];
      for (const { iso, turno, vendedor } of cambios) {
        if (vendedor) {
          const id = this._idPorNombre.get(vendedor);
          if (!id) { console.warn(`Vendedor desconocido: ${vendedor}`); continue; }
          upserts.push({ punto_venta: this.id, fecha: iso, turno, vendedor_id: id });
        } else {
          borrados.push({ iso, turno });
        }
      }
      return { upserts, borrados };
    },

    /** Aplica una tanda de cambios en memoria y en la base. */
    async aplicarCambios(cambios) {
      for (const { iso, turno, vendedor } of cambios) {
        if (this.cronograma[iso]) this.cronograma[iso][turno] = vendedor;
      }
      this.onCambio?.(this);
      if (!esAdmin()) return false;

      const { upserts, borrados } = this._partirCambios(cambios);
      if (upserts.length) {
        const { error } = await sb.from('turnos')
          .upsert(upserts, { onConflict: 'punto_venta,fecha,turno' });
        if (error) { avisarError('No se pudo guardar el cambio.', error); return false; }
      }
      for (const { iso, turno } of borrados) {
        const { error } = await sb.from('turnos').delete()
          .match({ punto_venta: this.id, fecha: iso, turno });
        if (error) { avisarError('No se pudo vaciar el turno.', error); return false; }
      }
      return true;
    },

    rotarCelda(iso, turno) {
      const c = this.cronograma[iso];
      if (!c || c.holiday || c.closed) return;
      const idx = c[turno] ? this.vendedores.indexOf(c[turno]) : -1;
      const siguiente = (idx + 1) % (this.vendedores.length + 1);
      const vendedor = siguiente < this.vendedores.length ? this.vendedores[siguiente] : null;
      return this.aplicarCambios([{ iso, turno, vendedor }]);
    },

    async agregarFeriado(iso, motivo) {
      this.feriados[iso] = motivo;
      const c = this.cronograma[iso];
      if (c) { c.holiday = true; c.manana = null; c.tarde = null; }
      this.onCambio?.(this);
      if (!esAdmin()) return;

      const { error } = await sb.from('feriados')
        .upsert({ punto_venta: this.id, fecha: iso, motivo }, { onConflict: 'punto_venta,fecha' });
      if (error) { avisarError('No se pudo guardar el feriado.', error); return; }
      // El día queda cerrado: se liberan los turnos que tuviera.
      await sb.from('turnos').delete().match({ punto_venta: this.id, fecha: iso });
    },

    async quitarFeriado(iso) {
      delete this.feriados[iso];
      // No repone asignaciones: el admin edita a mano o regenera.
      if (this.cronograma[iso]) this.cronograma[iso].holiday = false;
      this.onCambio?.(this);
      if (!esAdmin()) return;

      const { error } = await sb.from('feriados').delete()
        .match({ punto_venta: this.id, fecha: iso });
      if (error) avisarError('No se pudo quitar el feriado.', error);
    },

    /** Descarta todo y vuelve a aplicar las reglas por defecto. */
    async regenerar() {
      // Sin el padrón cargado no hay a quién asignarle los turnos, y el
      // resultado sería un cronograma vacío sin ningún aviso.
      if (this._idPorNombre.size === 0) {
        alert(`No hay vendedores cargados para ${this.nombre}.\n\n`
          + 'Falta correr supabase/schema.sql en el SQL Editor: es el que siembra el padrón.');
        return;
      }

      const nuevo = this.generar(this.feriados, this.desde, this.hasta);
      this.cronograma = nuevo;
      this.revisiones = {};
      this.onCambio?.(this);
      if (!esAdmin()) return;

      const filas = [];
      for (const [iso, c] of Object.entries(nuevo)) {
        for (const turno of ['manana', 'tarde']) {
          const id = c[turno] && this._idPorNombre.get(c[turno]);
          if (id) filas.push({ punto_venta: this.id, fecha: iso, turno, vendedor_id: id });
        }
      }

      const { error: errDel } = await sb.from('turnos').delete().eq('punto_venta', this.id);
      if (errDel) { avisarError('No se pudo limpiar el cronograma.', errDel); return; }
      await sb.from('revisiones').delete().eq('punto_venta', this.id);

      // En tandas: un insert de ~300 filas de una excede el límite de la URL.
      for (let i = 0; i < filas.length; i += 200) {
        const { error } = await sb.from('turnos').insert(filas.slice(i, i + 200));
        if (error) { avisarError('No se pudo guardar el cronograma regenerado.', error); return; }
      }
    },

    // --------------------------------------------------------
    //  HISTORIAL Y REVISIONES
    // --------------------------------------------------------
    async registrarHistorial(entradas) {
      const lote = Array.isArray(entradas) ? entradas : [entradas];
      if (!lote.length) return;
      this.historial.push(...lote);
      if (!esAdmin()) return;
      const autor = getSession()?.uid || null;
      const { error } = await sb.from('historial').insert(lote.map((e) => ({
        punto_venta: this.id,
        regla: e.regla,
        estado: e.estado,
        descripcion: e.descripcion,
        diff_antes: e.diff?.antes || null,
        diff_despues: e.diff?.despues || null,
        autor,
      })));
      if (error) console.error('Historial:', error);
    },

    async limpiarHistorial() {
      this.historial = [];
      this.onCambio?.(this);
      if (!esAdmin()) return;
      const { error } = await sb.from('historial').delete().eq('punto_venta', this.id);
      if (error) avisarError('No se pudo limpiar el historial.', error);
    },

    async guardarRevision(lunes, firma) {
      this.revisiones[lunes] = firma;
      if (!esAdmin()) return;
      await sb.from('revisiones')
        .upsert({ punto_venta: this.id, lunes, firma }, { onConflict: 'punto_venta,lunes' });
    },

    // --------------------------------------------------------
    //  EXPORTAR
    // --------------------------------------------------------
    exportarCSV() {
      const rows = [['Fecha', 'Día', 'Mañana', 'Tarde', 'Nota']];
      for (const iso of Object.keys(this.cronograma).sort()) {
        const c = this.cronograma[iso];
        const dia = DIAS_LARGOS[fromISO(iso).getDay()];
        let man = '', tar = '', nota = '';
        if (c.holiday) nota = `FERIADO: ${this.feriados[iso] || ''}`;
        else if (c.closed) nota = 'CERRADO';
        else { man = c.manana || ''; tar = c.tarde || ''; }
        rows.push([iso, dia, man, tar, nota]);
      }
      // BOM para que Excel en Windows respete los acentos.
      const csv = '﻿' + rows
        .map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(','))
        .join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `cronograma_${this.id}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
  };
}

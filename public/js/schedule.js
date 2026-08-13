// ============================================================
//  MÓDULO DE CRONOGRAMA (base compartida CC / LP)
// ============================================================
import { db, ref, set, onValue } from './firebase.js';
import { esAdmin } from './auth.js';
import { FERIADOS_DEFAULT, INICIO_SEMESTRE, FIN_SEMESTRE } from './config.js';
import { toISO, fromISO, addDays, DIAS_LARGOS } from './utils.js';

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

/** Esqueleto del semestre con domingos cerrados y feriados marcados. */
export function esqueletoSemestre() {
  const cronograma = {};
  for (const iso of generarFechasSemestre()) {
    const d = fromISO(iso);
    cronograma[iso] = { manana: null, tarde: null, holiday: false, closed: false };
    if (d.getDay() === 0) cronograma[iso].closed = true;
    if (FERIADOS_DEFAULT[iso]) cronograma[iso].holiday = true;
  }
  return cronograma;
}

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
    feriados: { ...FERIADOS_DEFAULT },
    historial: [],
    revisiones: {},

    LS_KEY: `crono_state_${config.id}`,
    FB_PATH: `cronogramas/${config.id}`,
    _suscripto: false,
    /** Lo setea main.js para evitar una dependencia circular con render.js. */
    onCambio: null,

    // --------------------------------------------------------
    //  PERSISTENCIA
    // --------------------------------------------------------
    guardar() {
      const state = {
        cronograma: this.cronograma,
        feriados: this.feriados,
        historial: this.historial.slice(-100),
        revisiones: this.revisiones,
      };
      try {
        localStorage.setItem(this.LS_KEY, JSON.stringify(state));
      } catch (e) {
        console.warn('Cache local:', e);
      }
      // Las reglas rechazan la escritura de cualquiera que no sea admin; se
      // chequea acá también para no generar errores de permisos en la consola.
      if (!esAdmin()) return;
      set(ref(db, this.FB_PATH), state).catch((e) => {
        console.error('No se pudo guardar en la nube:', e);
        alert('No se pudo guardar el cambio en la nube. Revisá tu conexión.\n\n' + e.message);
      });
    },

    /** Copia local, para pintar algo mientras llega la nube (y si no hay señal). */
    cargarCache() {
      const raw = localStorage.getItem(this.LS_KEY);
      if (!raw) return false;
      try {
        const s = JSON.parse(raw);
        if (s.cronograma) this.cronograma = s.cronograma;
        if (s.feriados) this.feriados = s.feriados;
        if (s.historial) this.historial = Array.isArray(s.historial) ? s.historial : Object.values(s.historial);
        if (s.revisiones) this.revisiones = s.revisiones;
        return true;
      } catch (e) {
        return false;
      }
    },

    suscribir() {
      if (this._suscripto) return;
      this._suscripto = true;
      onValue(ref(db, this.FB_PATH), (snap) => {
        const data = snap.val();
        if (data?.cronograma && Object.keys(data.cronograma).length > 0) {
          this.cronograma = data.cronograma;
          this.feriados = data.feriados || {};
          this.historial = data.historial
            ? (Array.isArray(data.historial) ? data.historial : Object.values(data.historial))
            : [];
          this.revisiones = data.revisiones || {};
          try { localStorage.setItem(this.LS_KEY, JSON.stringify(data)); } catch (e) { /* cuota llena */ }
          this.onCambio?.(this);
          return;
        }
        // Nube vacía: el admin siembra el cronograma inicial; el vendedor sólo
        // ve un estado provisorio generado en su propio navegador.
        if (!this.cronograma || Object.keys(this.cronograma).length === 0) {
          this.cronograma = this.generar();
          this.feriados = { ...FERIADOS_DEFAULT };
        }
        if (esAdmin()) this.guardar();
        this.onCambio?.(this);
      }, (err) => {
        console.error(`Suscripción ${this.id}:`, err);
      });
    },

    // --------------------------------------------------------
    //  CONSULTAS
    // --------------------------------------------------------
    idxVendedor(v) { return this.vendedores.indexOf(v); },
    pillClass(v) {
      const i = this.idxVendedor(v);
      return i >= 0 ? `v${i % 12}` : '';
    },

    /** Huella de una semana; permite saltear las que no cambiaron al revisar. */
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
    //  MUTACIONES (sólo admin — las reglas lo exigen igual)
    // --------------------------------------------------------
    rotarCelda(iso, turno) {
      const c = this.cronograma[iso];
      if (!c || c.holiday || c.closed) return;
      const actual = c[turno];
      const idx = actual ? this.vendedores.indexOf(actual) : -1;
      const nuevoIdx = (idx + 1) % (this.vendedores.length + 1);
      c[turno] = nuevoIdx < this.vendedores.length ? this.vendedores[nuevoIdx] : null;
      this.guardar();
      this.onCambio?.(this);
    },

    agregarFeriado(iso, nombre) {
      this.feriados[iso] = nombre;
      const c = this.cronograma[iso];
      if (c) {
        c.holiday = true;
        c.manana = null;
        c.tarde = null;
      }
      this.guardar();
      this.onCambio?.(this);
    },

    quitarFeriado(iso) {
      delete this.feriados[iso];
      // No repone asignaciones: el admin edita a mano o regenera.
      if (this.cronograma[iso]) this.cronograma[iso].holiday = false;
      this.guardar();
      this.onCambio?.(this);
    },

    regenerar() {
      this.cronograma = this.generar();
      this.feriados = { ...FERIADOS_DEFAULT };
      this.revisiones = {};
      this.guardar();
      this.onCambio?.(this);
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

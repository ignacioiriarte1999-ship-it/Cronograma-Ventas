// ============================================================
//  MODO DEMO — BACKEND EN MEMORIA
// ============================================================
// Imita la parte del cliente de Supabase que usa la app, con los datos en
// memoria. Así se puede mandar una demo funcional a un tercero sin tocar la
// base real, sin cuentas y sin que nadie pueda romper nada: al recargar, todo
// vuelve al estado inicial.
//
// La lógica de reglas, el corrector, los intercambios y las vistas son las
// mismas que en producción. Lo único distinto es de dónde salen los datos.

import { feriadosDeAnio } from './periodo.js';
import { toISO, fromISO, addDays, hoyISO } from './utils.js';
import { definirAlias } from './alias.js';

// ------------------------------------------------------------
//  DETECCIÓN
// ------------------------------------------------------------
// Se activa desde /demo/, con ?demo en la URL, o con un host que empiece con
// "demo.". Queda anotado en la sesión para que sobreviva a un recargado.
const CLAVE = 'crono_demo';

export function esDemo() {
  try {
    if (sessionStorage.getItem(CLAVE) === '1') return true;
    const activa = location.pathname.startsWith('/demo')
      || new URLSearchParams(location.search).has('demo')
      || location.hostname.startsWith('demo.');
    if (activa) sessionStorage.setItem(CLAVE, '1');
    return activa;
  } catch (e) {
    return location.pathname.startsWith('/demo')
      || new URLSearchParams(location.search).has('demo');
  }
}

// ------------------------------------------------------------
//  NOMBRES DE FANTASÍA
// ------------------------------------------------------------
const ALIAS = {
  Imbaud: 'Aguirre', Ortiz: 'Benítez', 'De Santis': 'Cabral',
  Arevalo: 'Duarte', 'De la Rosa': 'Escobar', Diaz: 'Ferrari', Erazo: 'Gómez',
  Juarez: 'Herrera', Orellana: 'Ibarra', Quiroga: 'Lagos', Rios: 'Medina',
  Santillan: 'Navarro', Soria: 'Ortega', Valdez: 'Peralta', Varas: 'Quintana',
};
const LOCALES = { cc: 'Sucursal Centro', lp: 'Sucursal Norte' };

export const USUARIOS_DEMO = [
  { usuario: 'admin', pass: 'demo1234', rol: 'admin', vendedor: null, etiqueta: 'Administrador' },
  { usuario: 'aguirre', pass: 'demo1234', rol: 'vendedor', vendedor: 'Imbaud', etiqueta: 'Vendedor (Sucursal Centro)' },
  { usuario: 'duarte', pass: 'demo1234', rol: 'vendedor', vendedor: 'Arevalo', etiqueta: 'Vendedor (Sucursal Norte)' },
];

// ------------------------------------------------------------
//  TABLAS
// ------------------------------------------------------------
const T = {
  puntos_venta: [], vendedores: [], perfiles: [],
  turnos: [], feriados: [], historial: [], revisiones: [], intercambios: [],
};
let secuencias = { vendedores: 0, historial: 0, intercambios: 0 };
const proximo = (t) => ++secuencias[t];

const DESDE = '2026-07-06';
const HASTA = '2027-12-31';

/**
 * Llena las tablas. Va aparte de crearClienteDemo() y con import dinámico de
 * las reglas porque db.js importa este módulo: cargarlas de forma estática
 * cerraría un ciclo (reglas → schedule → db → demo).
 */
export async function sembrarDemo() {
  if (T.vendedores.length) return;          // ya sembrado
  const { CONFIG_CC } = await import('./reglas-cc.js');
  const { CONFIG_LP } = await import('./reglas-lp.js');
  definirAlias(ALIAS, LOCALES);

  T.puntos_venta = [
    { id: 'cc', nombre: LOCALES.cc, subtitulo: CONFIG_CC.subtitulo },
    { id: 'lp', nombre: LOCALES.lp, subtitulo: CONFIG_LP.subtitulo },
  ];

  // Los vendedores guardan el nombre interno; la traducción es al mostrar.
  for (const [pv, cfg] of [['cc', CONFIG_CC], ['lp', CONFIG_LP]]) {
    cfg.vendedores.forEach((nombre, i) => {
      T.vendedores.push({ id: proximo('vendedores'), punto_venta: pv, nombre, orden: i, activo: true });
    });
  }
  const idDe = (pv, nombre) => T.vendedores.find((v) => v.punto_venta === pv && v.nombre === nombre)?.id;

  // Feriados calculables de los dos años que abarca la demo.
  for (const pv of ['cc', 'lp']) {
    for (const anio of [2026, 2027]) {
      for (const [fecha, motivo] of Object.entries(feriadosDeAnio(anio))) {
        if (fecha >= DESDE && fecha <= HASTA) T.feriados.push({ punto_venta: pv, fecha, motivo });
      }
    }
  }
  const feriadosDe = (pv) => Object.fromEntries(
    T.feriados.filter((f) => f.punto_venta === pv).map((f) => [f.fecha, f.motivo]));

  // Cronogramas generados con las reglas reales.
  for (const [pv, cfg] of [['cc', CONFIG_CC], ['lp', CONFIG_LP]]) {
    const cron = cfg.generar(feriadosDe(pv), DESDE, HASTA);
    for (const [fecha, c] of Object.entries(cron)) {
      for (const turno of ['manana', 'tarde']) {
        const id = c[turno] && idDe(pv, c[turno]);
        if (id) T.turnos.push({ punto_venta: pv, fecha, turno, vendedor_id: id });
      }
    }
  }

  // Perfiles: un admin y un usuario por vendedor.
  T.perfiles.push({ id: 'uid-admin', usuario: 'admin', rol: 'admin', vendedor_id: null, pass_cambiada: true });
  for (const v of T.vendedores) {
    T.perfiles.push({
      id: `uid-${v.id}`,
      usuario: (ALIAS[v.nombre] || v.nombre).toLowerCase().replace(/[^a-z]/g, ''),
      rol: 'vendedor', vendedor_id: v.id, pass_cambiada: true,
    });
  }

  // Un pedido pendiente, para que la función se vea al entrar.
  const hoy = hoyISO();
  const futuros = (pv, nombre) => T.turnos
    .filter((t) => t.punto_venta === pv && t.fecha > hoy && t.vendedor_id === idDe(pv, nombre))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const a = futuros('lp', 'Arevalo')[2];
  const b = futuros('lp', 'Juarez')[3];
  if (a && b) {
    T.intercambios.push({
      id: proximo('intercambios'), punto_venta: 'lp',
      solicitante: `uid-${idDe('lp', 'Arevalo')}`,
      vendedor_pide: a.vendedor_id, fecha_pide: a.fecha, turno_pide: a.turno,
      vendedor_recibe: b.vendedor_id, fecha_recibe: b.fecha, turno_recibe: b.turno,
      motivo: 'Tengo turno médico esa mañana.',
      estado: 'pendiente', nota_admin: null,
      creado: new Date(Date.now() - 3600e3).toISOString(), resuelto: null, resuelto_por: null,
    });
  }

  // Algo de historial, para que el panel no se vea vacío.
  const ayer = new Date(Date.now() - 864e5).toISOString();
  T.historial.push({
    id: proximo('historial'), punto_venta: 'cc', ts: ayer,
    regla: 'D-cierre', estado: 'aplicada',
    descripcion: 'Regla del cierre: Ortiz cerró el sábado y debe abrir el lunes.',
    diff_antes: 'L 10/08 manana: De Santis', diff_despues: 'Ortiz', autor: 'uid-admin',
  });
}

// ------------------------------------------------------------
//  CONSULTAS
// ------------------------------------------------------------
const clona = (x) => JSON.parse(JSON.stringify(x));

/** Imita el encadenado de PostgREST sobre los arreglos en memoria. */
class Consulta {
  constructor(tabla) {
    this.tabla = tabla;
    this.op = 'select';
    this.filtros = [];
    this.orden = [];
    this.tope = null;
    this.uno = false;
    this.contar = false;
    this.soloCabecera = false;
    this.cols = '*';
    this.payload = null;
    this.onConflict = null;
    this.devolver = false;
  }

  select(cols = '*', opts = {}) {
    if (this.op === 'select') this.cols = cols;
    else this.devolver = true;              // insert/update/delete + .select()
    if (opts.count) { this.contar = true; this.soloCabecera = Boolean(opts.head); }
    return this;
  }
  insert(filas) { this.op = 'insert'; this.payload = [].concat(filas); return this; }
  upsert(filas, opts = {}) {
    this.op = 'upsert'; this.payload = [].concat(filas);
    this.onConflict = opts.onConflict ? opts.onConflict.split(',').map((s) => s.trim()) : null;
    return this;
  }
  update(cambios) { this.op = 'update'; this.payload = cambios; return this; }
  delete() { this.op = 'delete'; return this; }

  eq(col, val) { this.filtros.push((r) => String(r[col]) === String(val)); return this; }
  neq(col, val) { this.filtros.push((r) => String(r[col]) !== String(val)); return this; }
  gte(col, val) { this.filtros.push((r) => r[col] >= val); return this; }
  lte(col, val) { this.filtros.push((r) => r[col] <= val); return this; }
  in(col, vals) { this.filtros.push((r) => vals.map(String).includes(String(r[col]))); return this; }
  match(obj) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this; }
  order(col, opts = {}) { this.orden.push({ col, asc: opts.ascending !== false }); return this; }
  limit(n) { this.tope = n; return this; }
  maybeSingle() { this.uno = true; return this; }
  single() { this.uno = true; return this; }

  _pasa(r) { return this.filtros.every((f) => f(r)); }

  _expandir(filas) {
    // Las dos únicas relaciones que pide la app.
    if (this.tabla === 'intercambios' && String(this.cols).includes('pide:')) {
      return filas.map((r) => ({
        ...r,
        pide: { nombre: T.vendedores.find((v) => v.id === r.vendedor_pide)?.nombre },
        recibe: { nombre: T.vendedores.find((v) => v.id === r.vendedor_recibe)?.nombre },
      }));
    }
    if (this.tabla === 'perfiles' && String(this.cols).includes('vendedores')) {
      return filas.map((r) => {
        const v = T.vendedores.find((x) => x.id === r.vendedor_id);
        return { ...r, vendedores: v ? { nombre: v.nombre, punto_venta: v.punto_venta } : null };
      });
    }
    return filas;
  }

  _ejecutar() {
    const tabla = T[this.tabla];
    if (!tabla) {
      return { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${this.tabla}' in the schema cache` } };
    }

    if (this.op === 'insert' || this.op === 'upsert') {
      const escritas = [];
      for (const fila of this.payload) {
        const f = { ...fila };
        if (this.tabla in secuencias && f.id == null) f.id = proximo(this.tabla);
        if (this.tabla === 'historial' && !f.ts) f.ts = new Date().toISOString();
        if (this.tabla === 'intercambios') {
          f.estado = f.estado || 'pendiente';
          f.creado = f.creado || new Date().toISOString();
        }
        const claves = this.onConflict
          || (this.tabla === 'turnos' ? ['punto_venta', 'fecha', 'turno']
            : this.tabla === 'feriados' ? ['punto_venta', 'fecha']
              : this.tabla === 'revisiones' ? ['punto_venta', 'lunes'] : null);
        const i = claves ? tabla.findIndex((r) => claves.every((k) => String(r[k]) === String(f[k]))) : -1;
        if (i >= 0) { tabla[i] = { ...tabla[i], ...f }; escritas.push(tabla[i]); }
        else { tabla.push(f); escritas.push(f); }
      }
      return { data: this.devolver ? clona(escritas) : null, error: null };
    }

    if (this.op === 'update') {
      const tocadas = [];
      for (const r of tabla) if (this._pasa(r)) { Object.assign(r, this.payload); tocadas.push(r); }
      return { data: this.devolver ? clona(tocadas) : null, error: null };
    }

    if (this.op === 'delete') {
      const fuera = tabla.filter((r) => this._pasa(r));
      T[this.tabla] = tabla.filter((r) => !this._pasa(r));
      return { data: this.devolver ? clona(fuera) : null, error: null };
    }

    let filas = tabla.filter((r) => this._pasa(r));
    if (this.contar) {
      return { data: this.soloCabecera ? null : clona(filas), count: filas.length, error: null };
    }
    for (const o of [...this.orden].reverse()) {
      filas = [...filas].sort((a, b) => {
        const x = a[o.col], y = b[o.col];
        const c = x < y ? -1 : x > y ? 1 : 0;
        return o.asc ? c : -c;
      });
    }
    if (this.tope != null) filas = filas.slice(0, this.tope);
    filas = this._expandir(clona(filas));
    return { data: this.uno ? (filas[0] ?? null) : filas, count: filas.length, error: null };
  }

  // Thenable: permite await sobre la cadena, igual que el cliente real.
  then(resolver, rechazar) {
    try { resolver(this._ejecutar()); } catch (e) { rechazar(e); }
  }
}

// ------------------------------------------------------------
//  AUTENTICACIÓN
// ------------------------------------------------------------
let sesion = null;
const oyentes = [];
const avisar = (evento) => oyentes.forEach((f) => f(evento, sesion));

const auth = {
  async getSession() { return { data: { session: sesion }, error: null }; },
  onAuthStateChange(cb) {
    oyentes.push(cb);
    return { data: { subscription: { unsubscribe() { oyentes.length = 0; } } } };
  },
  async signInWithPassword({ email, password }) {
    const usuario = String(email).split('@')[0];
    const u = USUARIOS_DEMO.find((x) => x.usuario === usuario);
    if (!u || password !== u.pass) {
      return { data: null, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } };
    }
    const perfil = T.perfiles.find((p) => p.usuario === u.usuario)
      || T.perfiles.find((p) => p.rol === u.rol);
    sesion = { user: { id: perfil.id, email } };
    avisar('SIGNED_IN');
    return { data: { session: sesion }, error: null };
  },
  async signOut() { sesion = null; avisar('SIGNED_OUT'); return { error: null }; },
  async updateUser() { return { data: {}, error: null }; },
  async signUp({ email }) {
    return { data: { user: { id: `uid-nuevo-${Date.now()}`, email } }, error: null };
  },
  async setPersistence() {},
};

// ------------------------------------------------------------
//  CLIENTE FALSO
// ------------------------------------------------------------
const canalMudo = { on() { return this; }, subscribe() { return this; } };

export function crearClienteDemo() {
  return {
    from: (tabla) => new Consulta(tabla),
    auth,
    channel: () => canalMudo,
    removeChannel: () => {},
    rpc: async () => ({ data: null, error: null }),
  };
}

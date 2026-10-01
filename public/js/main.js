// ============================================================
//  ARRANQUE Y CABLEADO DE LA INTERFAZ
// ============================================================
import { vigilarConexion } from './db.js';
import {
  observarSesion, login, logout, getSession, esAdmin, esSuperadmin, traducirError,
  cambiarPassword, listarUsuarios, crearPadronFaltante, crearUsuario, listarVendedores,
  faltantesDelPadron, actualizarPerfil, setActivo, resetearPass, eliminarUsuario,
} from './auth.js';
import { MIN_PASS, passInicial, PADRON } from './config.js';
import { esc, fromISO, formatShort, formatLargo, hoyISO } from './utils.js';
import { nom, local, texto } from './alias.js';
import { DEMO } from './db.js';
import { getModulo, listaModulos } from './modules.js';
import {
  HORIZONTE_MINIMO_DIAS, objetivoDeCobertura, diasRestantes, bajaVendedor, renombrarVendedor,
} from './schedule.js';
import {
  TIPOS, crearAusencia, borrarAusencia, proponerReemplazos, mostrarReemplazos,
  aplicarReemplazo, rechazarReemplazo, aplicarTodosLosReemplazos, rechazarTodosLosReemplazos,
} from './ausencias.js';
import {
  listarAuditoria, autoresDelHistorial, describirCambio, definirVendedores,
  ETIQUETA_ENTIDAD, ENTIDADES_POSIBLES, ACCIONES_POSIBLES,
} from './auditoria.js';
import { temaElegido, elegirTema, iniciarTema, registrarServiceWorker } from './tema.js';
import {
  renderCronograma, renderMiHorario, elegirPeriodo, elegirVendedor, setPedidosPropios, irAHoy,
  elegirVista, moverSemana,
} from './render.js';
import { traerFeriados, nuevosPara, turnosQuePisa, aniosOfrecidos } from './feriados-api.js';
import {
  listarPedidos, contarPendientes, suscribirPedidos, crearPedido, cancelarPedido,
  aprobarPedido, rechazarPedido, revisarImpacto, describirTurno, estaInstalado,
} from './intercambios.js';
import {
  revisar, corregirAutomatico, aplicarFix, rechazarFix, aplicarTodas, rechazarTodas,
} from './corrector.js';

const $ = (id) => document.getElementById(id);
let tabActual = null;
let cargado = false;

// ------------------------------------------------------------
//  MODO DEMO
// ------------------------------------------------------------
// La siembra va antes de resolver la sesión: si no, la app consultaría tablas
// todavía vacías. El import es dinámico para no cargar el módulo en producción.
if (DEMO) {
  const { sembrarDemo, USUARIOS_DEMO } = await import('./demo.js');
  await sembrarDemo();
  document.body.classList.add('es-demo');
  $('demo-accesos').innerHTML = '<div class="demo-titulo">Demostración — elegí con qué perfil entrar</div>'
    + USUARIOS_DEMO.map((u) => `<button class="demo-btn" data-accion="demo-entrar"
        data-usuario="${u.usuario}" data-pass="${u.pass}">${esc(u.etiqueta)}</button>`).join('')
    + '<div class="demo-nota">Datos de ejemplo. Podés editar lo que quieras: nada se guarda '
    + 'y al recargar la página vuelve al estado inicial.</div>';
  $('demo-accesos').style.display = 'block';
  // Con optional chaining porque el HTML de /demo/ ya viene sin la marca del
  // cliente ni la ayuda con apellidos: esto sólo hace falta cuando se entra
  // por ?demo=1 sobre el index de producción.
  const sub = document.querySelector('#login-screen .sub');
  if (sub) sub.textContent = 'Gestión de turnos por sucursal';
  document.querySelector('#login-screen .login-hint')?.remove();
  document.title = 'Cronogramas — demostración';
}

// ------------------------------------------------------------
//  SESIÓN
// ------------------------------------------------------------
observarSesion((sess, aviso) => {
  if (!sess) {
    cargado = false;
    for (const mod of listaModulos()) mod.desuscribir();
    mostrarLogin(aviso);
    return;
  }
  iniciarApp(sess);
});

function mostrarLogin(aviso) {
  $('login-screen').style.display = 'flex';
  $('app-shell').style.display = 'none';
  $('pass-gate').style.display = 'none';
  $('li-err').textContent = aviso || '';
  $('li-pass').value = '';
}

async function hacerLogin() {
  const user = $('li-user').value.trim().toLowerCase();
  const pass = $('li-pass').value;
  const err = $('li-err');
  err.textContent = '';
  if (!user || !pass) { err.textContent = 'Ingresá usuario y contraseña.'; return; }

  const btn = $('li-btn');
  btn.disabled = true;
  btn.textContent = 'Ingresando…';
  try {
    await login(user, pass);
  } catch (e) {
    err.textContent = traducirError(e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ingresar';
  }
}

async function iniciarApp(sess) {
  $('login-screen').style.display = 'none';

  // Primer ingreso: no se entra sin cambiar la contraseña que dio el admin.
  if (!sess.passCambiada) {
    $('app-shell').style.display = 'none';
    $('pass-gate').style.display = 'flex';
    return;
  }
  $('pass-gate').style.display = 'none';
  $('app-shell').style.display = 'block';
  $('user-info').textContent = sess.user + (sess.vendedor ? ` (${nom(sess.vendedor)})` : '') + ` — ${sess.rol}`;

  if (cargado) return;
  cargado = true;

  armarTabs(sess);
  for (const mod of listaModulos()) {
    mod.onCambio = alCambiarModulo;
    avisoEnPanel(mod, `Cargando ${esc(local(mod.id, mod.nombre))}…`);

    let ok = false;
    try {
      ok = await mod.cargar();
    } catch (e) {
      console.error(`Cargando ${mod.id}:`, e);
      avisoEnPanel(mod, `No se pudo cargar ${esc(local(mod.id, mod.nombre))}.`, e.message);
      continue;
    }
    if (!ok) {
      avisoEnPanel(mod, `No se pudo cargar ${esc(local(mod.id, mod.nombre))}.`,
        'Revisá la consola del navegador para ver el detalle.');
      continue;
    }

    // Base recién creada: el admin siembra el cronograma inicial.
    if (mod.estaVacio()) {
      if (esAdmin()) {
        console.info(`Sembrando el cronograma inicial de ${mod.nombre}…`);
        await mod.regenerar();
      } else {
        avisoEnPanel(mod, `${esc(local(mod.id, mod.nombre))} todavía no tiene turnos cargados.`,
          'Pedile al administrador que los genere.');
        continue;
      }
    }
    mod.suscribir();
    alCambiarModulo(mod);
  }

  await revisarHorizonte();
  await refrescarPedidos();
  suscribirPedidos(refrescarPedidos);
}

// ------------------------------------------------------------
//  EXTENSIÓN AUTOMÁTICA
// ------------------------------------------------------------
// Cuando el cronograma se está por terminar, se continúa solo hasta fin del
// año que viene. Sin esto, un día de enero los vendedores abren la app y no
// tienen turnos: nadie se acuerda de generar el año nuevo con anticipación.

async function revisarHorizonte() {
  if (!esAdmin()) return;
  const objetivo = objetivoDeCobertura();
  const hechos = [];

  for (const mod of listaModulos()) {
    if (!mod.hasta || mod.hasta >= objetivo) continue;
    const restan = diasRestantes(mod.hasta);
    if (restan >= HORIZONTE_MINIMO_DIAS) continue;

    console.info(`${mod.nombre}: quedan ${restan} días de cronograma, extendiendo hasta ${objetivo}…`);
    const r = await mod.extenderHasta(objetivo);
    if (r.ok) hechos.push({ nombre: local(mod.id, mod.nombre), restan, ...r });
    else console.warn(`No se extendió ${mod.nombre}: ${r.motivo}`);
  }

  if (hechos.length) mostrarAvisoExtension(hechos);
}

function mostrarAvisoExtension(hechos) {
  $('modal-ia-titulo').textContent = 'Cronograma extendido';
  $('modal-ia-body').innerHTML = `
    <div class="info-box">Quedaba menos de medio año de cronograma cargado, así que
    se continuó automáticamente siguiendo la rotación vigente.</div>
    ${hechos.map((h) => `
      <div class="stat-row">
        <span class="lbl">${esc(h.nombre)}</span>
        <span class="val">+${h.turnos} turnos <span class="val-detalle">hasta ${h.hasta}</span></span>
      </div>`).join('')}
    <div class="warn-box mt-10">Los feriados nuevos son los inamovibles, Carnaval y Semana Santa.
    Faltan los <b>no laborables con fines turísticos</b> y los traslados, que el Gobierno fija por
    decreto: agregalos desde el panel de feriados cuando se publiquen.</div>
    <div class="muted small mt-12">Revisá las semanas nuevas antes de comunicarlas.</div>`;
  $('modal-ia').classList.add('open');
}

async function hacerExtender(btn) {
  const objetivo = objetivoDeCobertura();
  if (!confirm(`Se va a continuar el cronograma de ambos puntos de venta hasta el ${objetivo}.\n\n`
    + 'Lo ya cargado no se toca. ¿Continuar?')) return;
  btn.disabled = true;
  btn.textContent = 'Extendiendo…';
  const hechos = [];
  for (const mod of listaModulos()) {
    const r = await mod.extenderHasta(objetivo);
    if (r.ok) hechos.push({ nombre: local(mod.id, mod.nombre), ...r });
    else console.info(`${mod.nombre}: ${r.motivo}`);
  }
  btn.disabled = false;
  btn.textContent = 'Extender hasta fin del año que viene';
  $('modal-config').classList.remove('open');
  if (!hechos.length) {
    alert('No hubo nada que extender: ambos cronogramas ya llegan hasta ' + objetivo + '.');
    return;
  }
  mostrarAvisoExtension(hechos);

  // El tramo nuevo entra en un año que probablemente no tenga feriados
  // cargados, y sin ellos la rotación queda mal desde el principio. Se
  // consultan solos, pero siguen necesitando confirmación: cargarlos de una
  // borraría turnos recién generados sin que nadie lo viera.
  await ofrecerFeriadosDelAnioNuevo(objetivo);
}

/**
 * Después de extender, ofrece los feriados del año al que se llegó.
 *
 * Va de a un punto de venta: los dos comparten las fechas pero no la tabla,
 * y cada uno tiene que confirmarse por separado.
 */
async function ofrecerFeriadosDelAnioNuevo(objetivo) {
  const anio = Number(objetivo.slice(0, 4));
  for (const mod of listaModulos()) {
    const { fuente, feriados } = await traerFeriados(anio);
    const nuevos = nuevosPara(mod, feriados);
    if (!nuevos.length) continue;
    mostrarPrevioFeriados(mod, nuevos, fuente, `${anio}`);
    return;   // uno por vez: dos modales encimados no se pueden responder
  }
}


// ------------------------------------------------------------
//  INTERCAMBIOS DE TURNO
// ------------------------------------------------------------
// Un vendedor propone cambiar un turno suyo por el de un compañero; el admin
// aprueba o rechaza. Al aprobar se intercambian las dos filas y nada más: el
// cambio no toca las semanas siguientes.

let pedidoEnCurso = null;   // el turno propio sobre el que se está pidiendo

async function refrescarPedidos() {
  const sess = getSession();
  if (!sess) return;
  try {
    if (esAdmin()) {
      const n = await contarPendientes();
      const btn = $('btn-pedidos');
      // El botón se muestra siempre, aunque no haya nada pendiente. Antes se
      // escondía con cero, y eso dejaba al admin sin forma de entrar a la
      // bandeja: no podía revisar lo que ya había aprobado o rechazado, ni
      // enterarse de que la función existía. El número sí desaparece.
      btn.style.display = estaInstalado() ? '' : 'none';
      const badge = $('pedidos-badge');
      badge.textContent = n;
      badge.style.display = n > 0 ? '' : 'none';
    } else {
      const mios = await listarPedidos({ limite: 30 });
      // El vendedor ve el botón para consultar el estado de lo que pidió, pero
      // sólo si la función está instalada.
      $('btn-pedidos').style.display = estaInstalado() ? '' : 'none';
      const abiertos = mios.filter((p) => p.estado === 'pendiente');
      $('pedidos-badge').textContent = abiertos.length;
      $('pedidos-badge').style.display = abiertos.length ? '' : 'none';
      setPedidosPropios(
        estaInstalado()
          ? new Map(abiertos.map((p) => [`${p.pide.fecha}|${p.pide.turno}`, 'pendiente']))
          : null,
        estaInstalado());
      if (tabActual === 'mio') renderMiHorario();
    }
  } catch (e) {
    console.warn('Pedidos:', e);
  }
}

function abrirPedirCambio(iso, turno) {
  const sess = getSession();
  const mod = getModulo(sess.puntoVenta);
  if (!mod) return;
  pedidoEnCurso = { fecha: iso, turno, nombre: sess.vendedor };

  const hoy = hoyISO();
  const companeros = mod.vendedores.filter((v) => v !== sess.vendedor);

  $('cambio-body').innerHTML = `
    <div class="info-box">Vas a proponer que otra persona tome tu turno del
      <b>${esc(formatLargo(fromISO(iso)))}</b> a la <b>${turno === 'manana' ? 'mañana' : 'tarde'}</b>,
      y vos tomes uno suyo. El cambio se aplica sólo a esos dos turnos, y necesita la
      aprobación del administrador.</div>

    <div class="cambio-campo">
      <label for="cb-comp">Con quién</label>
      <select class="txt" id="cb-comp" data-accion="cambio-companero">
        <option value="">— elegí un compañero —</option>
        ${companeros.map((v) => `<option value="${esc(v)}">${esc(nom(v))}</option>`).join('')}
      </select>
    </div>

    <div class="cambio-campo">
      <label for="cb-turno">Qué turno suyo tomás</label>
      <select class="txt" id="cb-turno" disabled>
        <option value="">— elegí primero un compañero —</option>
      </select>
    </div>

    <div class="cambio-campo">
      <label for="cb-motivo">Motivo (opcional)</label>
      <textarea class="txt" id="cb-motivo" maxlength="300"
        placeholder="Por ejemplo: tengo turno médico"></textarea>
    </div>
    <div id="cb-msg" class="form-msg"></div>`;
  $('modal-cambio').classList.add('open');
}

/** Carga los turnos futuros del compañero elegido. */
function cargarTurnosCompanero(nombre) {
  const sess = getSession();
  const mod = getModulo(sess.puntoVenta);
  const sel = $('cb-turno');
  if (!nombre) { sel.disabled = true; sel.innerHTML = '<option value="">— elegí primero un compañero —</option>'; return; }

  const hoy = hoyISO();
  const suyos = [];
  for (const iso of Object.keys(mod.cronograma).sort()) {
    if (iso < hoy) continue;
    const c = mod.cronograma[iso];
    if (!c || c.holiday || c.closed) continue;
    for (const t of ['manana', 'tarde']) {
      if (c[t] === nombre) suyos.push({ fecha: iso, turno: t });
    }
  }
  sel.disabled = false;
  sel.innerHTML = suyos.length
    ? '<option value="">— elegí un turno —</option>' + suyos.slice(0, 60).map((t) =>
        `<option value="${t.fecha}|${t.turno}">${esc(describirTurno(t))}</option>`).join('')
    : `<option value="">${esc(nombre)} no tiene turnos futuros</option>`;
}

async function enviarCambio(btn) {
  const msg = $('cb-msg');
  msg.className = 'form-msg err';
  const nombre = $('cb-comp').value;
  const valor = $('cb-turno').value;
  if (!nombre) { msg.textContent = 'Elegí con quién querés cambiar.'; return; }
  if (!valor) { msg.textContent = 'Elegí qué turno suyo tomás.'; return; }

  const sess = getSession();
  const mod = getModulo(sess.puntoVenta);
  const [fecha, turno] = valor.split('|');

  btn.disabled = true;
  try {
    await crearPedido({
      puntoVenta: mod.id,
      mio: pedidoEnCurso,
      suyo: { fecha, turno },
      vendedorSuyoId: mod._idPorNombre.get(nombre),
      motivo: $('cb-motivo').value.trim(),
    });
    $('modal-cambio').classList.remove('open');
    await refrescarPedidos();
    alert('Pedido enviado. Te avisamos cuando el administrador lo resuelva.');
  } catch (e) {
    msg.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

async function abrirPedidos() {
  $('modal-pedidos').classList.add('open');
  $('pedidos-body').innerHTML = '<div class="muted small">Cargando…</div>';
  try {
    const pedidos = await listarPedidos({ limite: 40 });
    if (!estaInstalado()) {
      $('pedidos-body').innerHTML = `<div class="warn-box">La función de intercambios
        todavía no está habilitada en la base. Falta correr
        <code>supabase/intercambios.sql</code> en el SQL Editor de Supabase.</div>`;
      return;
    }
    $('pedidos-body').innerHTML = pedidos.length
      ? pedidos.map((p) => htmlPedido(p)).join('')
      : '<div class="empty-state">No hay pedidos de cambio.</div>';
  } catch (e) {
    $('pedidos-body').innerHTML = `<div class="warn-box">No se pudieron leer los pedidos: ${esc(e.message)}</div>`;
  }
}

function htmlPedido(p) {
  const mod = getModulo(p.puntoVenta);
  const impacto = p.estado === 'pendiente' && mod ? revisarImpacto(mod, p) : [];
  const sess = getSession();
  const esMio = p.solicitante === sess.uid;

  const acciones = p.estado !== 'pendiente' ? ''
    : esAdmin()
      ? `<div class="actions">
           <button class="btn-primary" data-accion="pedido-aprobar" data-id="${p.id}">Aprobar</button>
           <button class="btn-secondary" data-accion="pedido-rechazar" data-id="${p.id}">Rechazar</button>
         </div>`
      : (esMio ? `<div class="actions">
           <button class="btn-secondary" data-accion="pedido-cancelar" data-id="${p.id}">Cancelar pedido</button>
         </div>` : '');

  return `<div class="pedido ${esc(p.estado)}" id="pedido-${p.id}">
    <div>
      <span class="quien">${esc(nom(p.pide.nombre))}</span> quiere cambiar con
      <span class="quien">${esc(nom(p.recibe.nombre))}</span>
      <span class="muted small">· ${esc(local(p.puntoVenta, mod?.nombre || p.puntoVenta))}
      · ${new Date(p.creado).toLocaleDateString('es-AR')}</span>
    </div>
    <div class="trueque">
      <div class="lado"><b>${esc(nom(p.pide.nombre))}</b> deja<br />${esc(describirTurno(p.pide))}</div>
      <div class="flecha">⇄</div>
      <div class="lado"><b>${esc(nom(p.recibe.nombre))}</b> deja<br />${esc(describirTurno(p.recibe))}</div>
    </div>
    ${p.motivo ? `<div class="motivo">“${esc(p.motivo)}”</div>` : ''}
    ${impacto.length ? `<div class="warn-box mt-8">Si se aprueba, esto queda mal:
      <ul style="margin:4px 0 0 16px">${impacto.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>` : ''}
    ${p.estado !== 'pendiente' ? `<div class="muted small mt-4">Estado: <b>${esc(p.estado)}</b>${
      p.notaAdmin ? ` — ${esc(p.notaAdmin)}` : ''}</div>` : ''}
    ${acciones}
  </div>`;
}

async function resolverPedido(id, aprobar) {
  const pedidos = await listarPedidos({ limite: 40 });
  const p = pedidos.find((x) => String(x.id) === String(id));
  if (!p) return;

  const mod = getModulo(p.puntoVenta);
  if (aprobar) {
    const impacto = revisarImpacto(mod, p);
    const aviso = impacto.length
      ? `\n\nATENCIÓN, esto queda mal:\n  · ${impacto.join('\n  · ')}\n\n¿Aprobar igual?`
      : '\n\n¿Confirmás?';
    if (!confirm(`${nom(p.pide.nombre)} ⇄ ${nom(p.recibe.nombre)}${aviso}`)) return;
  } else if (!confirm(`¿Rechazar el pedido de ${nom(p.pide.nombre)}?`)) {
    return;
  }

  const nota = prompt(aprobar ? 'Nota para el vendedor (opcional):' : 'Motivo del rechazo (opcional):', '');
  if (nota === null) return;

  try {
    if (aprobar) await aprobarPedido(p, nota || null);
    else await rechazarPedido(p, nota || null);
    await abrirPedidos();
    await refrescarPedidos();
  } catch (e) {
    alert('No se pudo resolver el pedido:\n\n' + e.message);
  }
}

async function hacerCancelarPedido(id) {
  if (!confirm('¿Cancelar tu pedido de cambio?')) return;
  try {
    await cancelarPedido(id);
    await abrirPedidos();
    await refrescarPedidos();
  } catch (e) {
    alert('No se pudo cancelar:\n\n' + e.message);
  }
}


// ------------------------------------------------------------
//  EDICIÓN DE UNA CELDA DEL CRONOGRAMA
// ------------------------------------------------------------
// Al hacer clic en un turno se abre un desplegable con todo el padrón. Antes
// cada clic rotaba al siguiente de la lista: con doce vendedores en Laprida,
// poner a la última persona costaba once clics y pasarse obligaba a dar toda
// la vuelta otra vez.
//
// Se usa un <select> nativo a propósito: en el celular abre el selector del
// sistema —cómodo con el pulgar— y trae gratis el teclado y el lector de
// pantalla, que una lista hecha a mano habría que reimplementar.

let celdaEnEdicion = null;   // { cerrar } del desplegable abierto, si hay uno

function abrirSelectorCelda(td, mod, iso, turno) {
  if (!esAdmin()) return;
  if (celdaEnEdicion?.td === td) return;   // ya está abierto acá
  celdaEnEdicion?.cerrar();                // sólo uno a la vez

  const actual = mod.cronograma[iso]?.[turno] || '';
  // Quien está de vacaciones o dado de baja no se ofrece. El que ya estaba
  // asignado sí aparece aunque no esté disponible: si no, la celda mostraría
  // un nombre que el desplegable niega, y no habría cómo sacarlo salvo
  // eligiendo a otro.
  const ofrecidos = mod.vendedores.filter((v) => v === actual || mod.disponible(v, iso));
  const opciones = ['<option value="">— sin asignar —</option>'].concat(
    ofrecidos.map((v) => {
      const a = !mod.disponible(v, iso) ? mod.ausenciaDe(v, iso) : null;
      const marca = a ? ` — ${a.tipo}` : '';
      return `<option value="${esc(v)}"${v === actual ? ' selected' : ''}>`
        + `${esc(nom(v))}${esc(marca)}</option>`;
    }),
  ).join('');

  const previo = td.innerHTML;
  td.innerHTML = `<select class="celda-sel" aria-label="Vendedor del turno">${opciones}</select>`;
  const sel = td.querySelector('select');

  let resuelto = false;
  const cerrar = (restaurar = true) => {
    if (resuelto) return;
    resuelto = true;
    celdaEnEdicion = null;
    document.removeEventListener('pointerdown', afuera, true);
    if (restaurar) td.innerHTML = previo;
  };
  // Cerrar por clic afuera y no sólo por blur: el <select> puede no llegar a
  // tomar el foco —pasa en algunos móviles—, y entonces el blur nunca llega y
  // el desplegable se queda abierto para siempre.
  function afuera(ev) { if (!td.contains(ev.target)) cerrar(); }
  document.addEventListener('pointerdown', afuera, true);

  celdaEnEdicion = { td, cerrar };

  sel.addEventListener('change', () => {
    const elegido = sel.value || null;
    // Si eligió el mismo que ya estaba, asignarCelda no cambia nada y no hay
    // re-render que repinte la celda: hay que restaurarla acá.
    const mismo = (mod.cronograma[iso]?.[turno] || null) === elegido;
    cerrar(mismo);
    if (!mismo) mod.asignarCelda(iso, turno, elegido);
  });
  sel.addEventListener('blur', () => cerrar());
  sel.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') cerrar(); });

  sel.focus();
  // Abre la lista sin un segundo clic donde el navegador lo permite. Exige un
  // gesto del usuario, así que lanza si se llega acá por código; el foco ya
  // está puesto, se despliega con un clic o con las flechas.
  try { sel.showPicker?.(); } catch (e) { /* sin gesto de usuario */ }
}

/** Mensaje a pantalla completa dentro de la pestaña de un cronograma. */
function avisoEnPanel(mod, titulo, detalle = '') {
  const panel = $(`tab-${mod.id}`);
  if (!panel) return;
  panel.innerHTML = `<div class="empty-state">
    <div>${titulo}</div>
    ${detalle ? `<div class="small mt-8">${esc(detalle)}</div>` : ''}
  </div>`;
}

function alCambiarModulo(mod) {
  renderCronograma(mod);
  const sess = getSession();
  if (tabActual === 'mio') renderMiHorario();
}

function armarTabs(sess) {
  const todos = listaModulos().map((m) => ({ id: m.id, label: local(m.id, m.nombre) }));
  const propio = getModulo(sess.puntoVenta);
  let tabs;
  let inicial;

  if (propio) {
    // Vendedor: su punto de venta y sus propios turnos.
    tabs = [{ id: propio.id, label: local(propio.id, propio.nombre) }, { id: 'mio', label: 'Mi horario' }];
    inicial = 'mio';
  } else {
    // Admin o lector sin vendedor asociado: ve todo y puede consultar el
    // horario de cualquiera desde el desplegable de "Mi horario".
    tabs = [...todos, { id: 'mio', label: 'Horario por vendedor' }];
    inicial = 'cc';
  }

  $('tabs').innerHTML = tabs
    .map((t) => `<button data-accion="tab" data-tab="${t.id}">${esc(t.label)}</button>`)
    .join('');
  cambiarTab(inicial);
}

function cambiarTab(tabId) {
  tabActual = tabId;
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.remove('active'));
  $(`tab-${tabId}`)?.classList.add('active');
  document.querySelector(`#tabs button[data-tab="${tabId}"]`)?.classList.add('active');
  if (tabId === 'mio') renderMiHorario();
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------
//  CAMBIO DE CONTRASEÑA OBLIGATORIO
// ------------------------------------------------------------
async function hacerCambioObligatorio() {
  const actual = $('pg-actual').value;
  const p1 = $('pg-nueva').value;
  const p2 = $('pg-nueva2').value;
  const msg = $('pg-msg');
  msg.className = 'form-msg err';

  if (p1.length < MIN_PASS) { msg.textContent = `Mínimo ${MIN_PASS} caracteres.`; return; }
  if (p1 !== p2) { msg.textContent = 'Las contraseñas no coinciden.'; return; }
  if (p1 === actual) { msg.textContent = 'La nueva contraseña debe ser distinta.'; return; }

  const btn = $('pg-btn');
  btn.disabled = true;
  try {
    await cambiarPassword(actual, p1);
    msg.className = 'form-msg ok';
    msg.textContent = '✓ Listo, entrando…';
    setTimeout(() => iniciarApp(getSession()), 600);
  } catch (e) {
    msg.textContent = traducirError(e);
  } finally {
    btn.disabled = false;
  }
}

// ------------------------------------------------------------
//  CONFIGURACIÓN
// ------------------------------------------------------------
function abrirConfig() {
  if (!getSession()) return;

  let html = `
    <div class="stat-heading">Apariencia</div>
    <div class="tema-sw" role="group" aria-label="Tema">
      ${[['claro', 'Claro'], ['oscuro', 'Oscuro'], ['sistema', 'Sistema']].map(([v, t]) =>
        `<button class="${temaElegido() === v ? 'on' : ''}" data-accion="tema" data-tema="${v}">${t}</button>`).join('')}
    </div>
    <div class="muted small mt-4 mb-8">Con <b>Sistema</b> sigue lo que tengas configurado en
      el teléfono o la computadora.</div>

    <hr><div class="stat-heading">Cambiar mi contraseña</div>
    <input class="txt mb-6" id="cfg-actual" type="password" placeholder="Contraseña actual" autocomplete="current-password" />
    <input class="txt mb-6" id="cfg-nueva" type="password" placeholder="Nueva contraseña" autocomplete="new-password" />
    <input class="txt mb-8" id="cfg-nueva2" type="password" placeholder="Repetir nueva contraseña" autocomplete="new-password" />
    <button class="btn-primary" data-accion="cfg-pass">Actualizar</button>
    <div id="cfg-msg" class="form-msg"></div>`;

  if (esAdmin()) {
    html += `<hr><div class="stat-heading">Crear usuario</div>
      <div class="alta-form">
        <input class="txt" id="nu-user" placeholder="Usuario (o correo completo)"
               autocapitalize="none" spellcheck="false" />
        <input class="txt" id="nu-pass" type="password" placeholder="Contraseña (mín. ${MIN_PASS})"
               autocomplete="new-password" />
        <select class="txt" id="nu-rol">
          <option value="vendedor">Solo lectura</option>
          <option value="admin">Administrador (puede editar)</option>
        </select>
        <select class="txt" id="nu-vend"><option value="">Sin vendedor asociado</option></select>
      </div>
      <label class="check"><input type="checkbox" id="nu-forzar" checked />
        Pedirle que cambie la contraseña al entrar</label>
      <button class="btn-primary mt-8" data-accion="crear-usuario">Crear usuario</button>
      <div id="nu-msg" class="form-msg"></div>
      <div class="muted small mt-4">Asociá un vendedor para que además vea la pestaña
        <b>Mi horario</b> con sus propios turnos. Sin asociar, ve los dos cronogramas
        completos, siempre en modo lectura.</div>

      <hr><div class="stat-heading">Cronograma</div>
      <div class="muted small mb-8">${listaModulos().map((m) =>
        `${esc(local(m.id, m.nombre))}: hasta ${m.hasta || '—'} (${diasRestantes(m.hasta)} días)`).join(' · ')}</div>
      <button class="btn-secondary" data-accion="extender">Extender hasta fin del año que viene</button>
      <div class="muted small mt-4">Continúa la rotación vigente sin tocar lo ya cargado.
      La app lo hace sola cuando quedan menos de ${HORIZONTE_MINIMO_DIAS} días.</div>

      <hr><div class="stat-heading">Vendedores y ausencias</div>
      <div id="cfg-vendedores" class="muted small">Cargando…</div>

      <hr><div class="stat-heading">Usuarios</div>
      <div id="cfg-usuarios" class="muted small">Cargando…</div>`;
  }

  if (esSuperadmin()) {
    html += `<hr><div class="stat-heading">Historial de cambios</div>
      <div class="muted small mb-8">Todo lo que se escribe en la base queda acá, con autor y
        valores. Lo registran triggers, así que no se puede saltear desde la app.</div>
      <div class="hist-filtros">
        <input type="date" class="txt" id="hi-desde" aria-label="Desde" />
        <input type="date" class="txt" id="hi-hasta" aria-label="Hasta" />
        <select class="txt" id="hi-usuario"><option value="">Cualquier usuario</option></select>
        <select class="txt" id="hi-pv">
          <option value="">Los dos puntos de venta</option>
          ${listaModulos().map((m) => `<option value="${m.id}">${esc(local(m.id, m.nombre))}</option>`).join('')}
        </select>
        <select class="txt" id="hi-entidad">
          <option value="">Cualquier cosa</option>
          ${ENTIDADES_POSIBLES.map((e) => `<option value="${e}">${esc(ETIQUETA_ENTIDAD(e))}</option>`).join('')}
        </select>
        <select class="txt" id="hi-accion">
          <option value="">Cualquier acción</option>
          ${ACCIONES_POSIBLES.map((a) => `<option value="${a}">${a}</option>`).join('')}
        </select>
      </div>
      <button class="btn-secondary mt-8" data-accion="hist-filtrar">Filtrar</button>
      <div id="cfg-historial" class="muted small mt-8">Cargando…</div>`;
  }

  $('config-body').innerHTML = html;
  $('modal-config').classList.add('open');
  if (esSuperadmin()) cargarHistorial();
  if (esAdmin()) {
    cargarUsuarios();
    cargarVendedores();
    cargarDesplegableVendedores();
  }
}

async function cargarDesplegableVendedores() {
  const sel = $('nu-vend');
  if (!sel) return;
  try {
    const vends = await listarVendedores();
    const ocupados = new Set((await listarUsuarios()).map((u) => u.vendedor).filter(Boolean));
    const porPv = { cc: 'ContacCenter', lp: 'Laprida 235' };
    let html = '<option value="">Sin vendedor asociado</option>';
    for (const [pv, etiqueta] of Object.entries(porPv)) {
      const propios = vends.filter((v) => v.punto_venta === pv);
      if (!propios.length) continue;
      html += `<optgroup label="${etiqueta}">`;
      for (const v of propios) {
        const usado = ocupados.has(v.nombre) ? ' — ya tiene cuenta' : '';
        html += `<option value="${v.id}">${esc(nom(v.nombre))}${usado}</option>`;
      }
      html += '</optgroup>';
    }
    sel.innerHTML = html;
  } catch (e) {
    console.error('Cargando vendedores:', e);
  }
}

async function hacerCrearUsuario(btn) {
  const msg = $('nu-msg');
  msg.className = 'form-msg err';
  const user = $('nu-user').value.trim();
  const pass = $('nu-pass').value;
  const rol = $('nu-rol').value;
  const vendedorId = $('nu-vend').value ? Number($('nu-vend').value) : null;
  const forzar = $('nu-forzar').checked;

  if (!user) { msg.textContent = 'Poné un nombre de usuario.'; return; }
  if (pass.length < MIN_PASS) { msg.textContent = `La contraseña necesita al menos ${MIN_PASS} caracteres.`; return; }

  btn.disabled = true;
  btn.textContent = 'Creando…';
  try {
    await crearUsuario({ user, rol, vendedorId, passCambiada: !forzar }, pass);
    msg.className = 'form-msg ok';
    msg.textContent = `✓ Usuario "${user.toLowerCase()}" creado.`;
    $('nu-user').value = '';
    $('nu-pass').value = '';
    cargarUsuarios();
    cargarDesplegableVendedores();
  } catch (e) {
    msg.textContent = traducirError(e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crear usuario';
  }
}

async function cargarUsuarios() {
  const cont = $('cfg-usuarios');
  if (!cont) return;
  try {
    const usuarios = await listarUsuarios();
    const faltantes = faltantesDelPadron(usuarios);

    let html = '';
    if (faltantes.length > 0 && !DEMO) {
      html += `<div class="info-box">Faltan dar de alta <b>${faltantes.length}</b> usuario(s):
        ${esc(faltantes.map((f) => f.user).join(', '))}</div>
        <button class="btn-primary mb-8" data-accion="crear-padron">Crear los ${faltantes.length} usuarios faltantes</button>`;
    }

    const vendedores = await listarVendedores();
    html += `<div class="user-list">${usuarios.map((u) => filaUsuario(u, vendedores)).join('')}</div>`;

    cont.className = '';
    cont.innerHTML = html;
  } catch (e) {
    cont.innerHTML = `<div class="warn-box">No se pudieron leer los usuarios: ${esc(traducirError(e))}</div>`;
  }
}

async function cargarHistorial() {
  const cont = $('cfg-historial');
  if (!cont) return;

  // Los ids de vendedor del registro no le dicen nada a nadie; el nombre sí.
  const mapa = new Map();
  for (const m of listaModulos()) {
    for (const v of m.vendedores) { const id = m.idDe(v); if (id) mapa.set(Number(id), v); }
  }
  definirVendedores(mapa);

  try {
    const filas = await listarAuditoria({
      desde: $('hi-desde')?.value || null,
      hasta: $('hi-hasta')?.value || null,
      usuario: $('hi-usuario')?.value || null,
      puntoVenta: $('hi-pv')?.value || null,
      entidad: $('hi-entidad')?.value || null,
      accion: $('hi-accion')?.value || null,
    });

    const sel = $('hi-usuario');
    if (sel && sel.options.length === 1) {
      for (const u of await autoresDelHistorial()) {
        sel.insertAdjacentHTML('beforeend', `<option value="${esc(u)}">${esc(u)}</option>`);
      }
    }

    cont.className = '';
    cont.innerHTML = filas.length
      ? `<div class="hist-list">${filas.map((f) => `
          <div class="hist-row ${esc(f.accion)}">
            <div class="hist-meta">
              <span class="ts">${new Date(f.ts).toLocaleString('es-AR',
                { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              <span class="quien">${esc(f.actor_usuario || '—')}</span>
              <span class="role-tag">${esc(f.accion)} · ${esc(ETIQUETA_ENTIDAD(f.entidad))}</span>
              ${f.punto_venta ? `<span class="muted">${esc(f.punto_venta.toUpperCase())}</span>` : ''}
            </div>
            <div class="hist-desc">${esc(describirCambio(f))}</div>
          </div>`).join('')}</div>
        <div class="muted small mt-4">${filas.length} cambio(s). Se muestran los 200 más recientes.</div>`
      : '<div class="muted small">No hay cambios registrados con esos filtros.</div>';
  } catch (e) {
    cont.innerHTML = `<div class="warn-box">No se pudo leer el historial: ${esc(traducirError(e))}</div>`;
  }
}

function cargarVendedores() {
  const cont = $('cfg-vendedores');
  if (!cont) return;

  cont.className = '';
  cont.innerHTML = listaModulos().map((mod) => {
    const filas = mod.vendedores.map((v) => {
      const meta = mod.metaDe(v);
      const id = mod.idDe(v);
      const baja = meta?.baja_desde || null;
      const renombrado = meta?.nombre_visible || null;
      return `<div class="vend-row${baja ? ' baja' : ''}">
        <div><span class="pill ${mod.pillClass(v)}">${esc(nom(v))}</span>
          ${renombrado ? `<span class="muted small">antes ${esc(v)}</span>` : ''}
          ${baja ? `<span class="muted small">baja desde ${esc(baja)}</span>` : ''}</div>
        <div class="user-acciones">
          ${id === null ? '<span class="muted small">sin fila en la base</span>' : `
            <button class="mini" data-accion="vend-renombrar" data-id="${id}" data-v="${esc(v)}">Renombrar</button>
            ${baja
              ? `<button class="mini" data-accion="vend-reactivar" data-id="${id}" data-v="${esc(v)}">Reactivar</button>`
              : `<button class="mini" data-accion="vend-baja" data-id="${id}" data-v="${esc(v)}">Dar de baja</button>`}`}
        </div>
      </div>`;
    }).join('');

    const ausencias = mod.ausencias.length
      ? mod.ausencias.map((a) => `<div class="vend-row">
          <div><span class="pill ${mod.pillClass(a.vendedor)}">${esc(nom(a.vendedor))}</span>
            <span class="muted small">${esc(a.tipo)} · ${esc(a.desde)} → ${esc(a.hasta)}</span>
            ${a.nota ? `<span class="muted small">${esc(texto(a.nota))}</span>` : ''}</div>
          <div class="user-acciones">
            <button class="mini peligro" data-accion="ausencia-borrar" data-id="${a.id}"
                    data-mod="${mod.id}">Quitar</button>
          </div>
        </div>`).join('')
      : '<div class="muted small">Sin ausencias cargadas</div>';

    const opcionesVend = mod.vendedores
      .map((v) => `<option value="${esc(v)}">${esc(nom(v))}</option>`).join('');
    const opcionesTipo = TIPOS
      .map((t) => `<option value="${t}">${t}</option>`).join('');

    return `<div class="vend-bloque">
      <div class="stat-heading">${esc(local(mod.id, mod.nombre))}</div>
      ${filas}
      <div class="muted small mt-8">Ausencias</div>
      ${ausencias}
      <div class="ausencia-form mt-8">
        <select class="txt" id="au-vend-${mod.id}">${opcionesVend}</select>
        <select class="txt" id="au-tipo-${mod.id}">${opcionesTipo}</select>
        <input type="date" class="txt" id="au-desde-${mod.id}" />
        <input type="date" class="txt" id="au-hasta-${mod.id}" />
      </div>
      <button class="btn-secondary mt-8" data-accion="ausencia-crear" data-mod="${mod.id}">
        Cargar ausencia</button>
    </div>`;
  }).join('');
}

async function hacerCrearAusencia(mod) {
  const vendedor = $(`au-vend-${mod.id}`).value;
  const tipo = $(`au-tipo-${mod.id}`).value;
  const desde = $(`au-desde-${mod.id}`).value;
  const hasta = $(`au-hasta-${mod.id}`).value;

  if (!desde || !hasta) { alert('Faltan las fechas.'); return; }
  if (hasta < desde) { alert('La fecha de fin es anterior a la de inicio.'); return; }

  try {
    await crearAusencia({ vendedorId: mod.idDe(vendedor), tipo, desde, hasta });
    await mod.cargarAusencias();
  } catch (e) {
    alert(traducirError(e));
    return;
  }
  cargarVendedores();

  // La ausencia queda cargada, pero el cronograma no se toca solo: se le
  // muestran al admin los turnos que quedan descubiertos y él decide.
  //
  // Configuración se cierra primero: los dos modales comparten capa y el de
  // reemplazos quedaba detrás, invisible.
  $('modal-config').classList.remove('open');
  const ausencia = { vendedor, desde, hasta, tipo };
  mostrarReemplazos(mod, ausencia, proponerReemplazos(mod, ausencia));
}

async function hacerBorrarAusencia(mod, id) {
  if (!confirm('¿Quitar esta ausencia?\n\nLos turnos ya reemplazados quedan como están.')) return;
  try {
    await borrarAusencia(Number(id));
    await mod.cargarAusencias();
  } catch (e) { alert(traducirError(e)); }
  cargarVendedores();
}

async function hacerRenombrarVendedor(id, vendedor) {
  const actual = nom(vendedor);
  const nuevo = prompt('¿Con qué nombre se muestra esta persona?\n\n'
    + 'Cambia sólo lo que se ve: el cronograma, las estadísticas y los avisos. '
    + 'Dejalo vacío para volver al original.', actual);
  if (nuevo === null) return;

  const limpio = nuevo.trim();
  try {
    // Volver al original es borrar el renombre, no guardar el nombre viejo:
    // así la fila deja de figurar como renombrada.
    await renombrarVendedor(Number(id), limpio && limpio !== vendedor ? limpio : null);
    for (const m of listaModulos()) await m.cargar();
  } catch (e) { alert(traducirError(e)); }
  cargarVendedores();
  for (const m of listaModulos()) renderCronograma(m);
}

async function hacerBajaVendedor(id, vendedor, dar) {
  let desde = null;
  if (dar) {
    desde = prompt(`¿Desde qué fecha sale ${vendedor} de la rotación?\n\n`
      + 'Formato AAAA-MM-DD. Lo ya cargado antes de esa fecha no se toca.', hoyISO());
    if (!desde) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) { alert('Fecha inválida. Usá AAAA-MM-DD.'); return; }
  }
  try {
    await bajaVendedor(Number(id), desde);
    for (const m of listaModulos()) await m.cargar();
  } catch (e) { alert(traducirError(e)); }
  cargarVendedores();
}

// Qué fila está abierta en modo edición. Una sola por vez: dos formularios
// abiertos invitan a guardar el equivocado.
let editandoUid = null;

function filaUsuario(u, vendedores) {
  const esYo = u.uid === getSession()?.uid;
  const baja = u.activo === false;

  if (editandoUid === u.uid) {
    const opciones = vendedores.map((v) =>
      `<option value="${v.id}"${v.nombre === u.vendedor ? ' selected' : ''}>${esc(nom(v.nombre))} (${esc(v.punto_venta.toUpperCase())})</option>`
    ).join('');
    return `<div class="user-row editando">
      <b>${esc(u.user)}</b>
      <select class="txt" id="ed-rol">
        <option value="vendedor"${u.rol === 'vendedor' ? ' selected' : ''}>Solo lectura</option>
        <option value="admin"${u.rol === 'admin' ? ' selected' : ''}>Administrador (puede editar)</option>
      </select>
      <select class="txt" id="ed-vend">
        <option value="">Sin vendedor asociado</option>${opciones}
      </select>
      <div class="user-acciones">
        <button class="mini principal" data-accion="usuario-guardar" data-uid="${u.uid}">Guardar</button>
        <button class="mini" data-accion="usuario-cancelar">Cancelar</button>
      </div>
    </div>`;
  }

  return `<div class="user-row${baja ? ' baja' : ''}">
    <div>${esc(u.user)} ${u.vendedor ? `<span class="muted">(${esc(nom(u.vendedor))})</span>` : ''}
      <span class="role-tag ${u.rol === 'admin' ? 'admin' : 'vend'}">${esc(u.rol)}</span>
      ${baja ? '<span class="role-tag inactiva">desactivada</span>' : ''}</div>
    <div class="muted small">${u.puntoVenta ? esc(u.puntoVenta.toUpperCase()) : '—'}</div>
    <div class="small ${u.passCambiada ? 'ok-txt' : 'warn-txt'}">${u.passCambiada ? 'Propia' : 'Por defecto'}</div>
    <div class="user-acciones">
      <button class="mini" data-accion="usuario-editar" data-uid="${u.uid}">Editar</button>
      <button class="mini" data-accion="usuario-reset" data-uid="${u.uid}" data-user="${esc(u.user)}">Resetear</button>
      ${esYo ? '<span class="muted small">tu cuenta</span>' : `
        <button class="mini" data-accion="usuario-activo" data-uid="${u.uid}"
                data-activo="${baja ? '1' : '0'}">${baja ? 'Activar' : 'Desactivar'}</button>
        <button class="mini peligro" data-accion="usuario-eliminar" data-uid="${u.uid}"
                data-user="${esc(u.user)}">Eliminar</button>`}
    </div>
  </div>`;
}

/** Corre una operación, avisa cómo salió y vuelve a dibujar la lista. */
async function conAviso(fn, exito) {
  try {
    const r = await fn();
    if (exito) alert(typeof exito === 'function' ? exito(r) : exito);
  } catch (e) {
    alert(traducirError(e));
  }
  editandoUid = null;
  cargarUsuarios();
}

function hacerGuardarUsuario(uid) {
  const rol = $('ed-rol').value;
  // El desplegable devuelve texto y vendedor_id es un entero. Postgres lo
  // coerciona, pero guardar "1" donde va 1 rompe cualquier comparación
  // estricta contra el padrón de vendedores.
  const elegido = $('ed-vend').value;
  conAviso(() => actualizarPerfil(uid, { rol, vendedorId: elegido ? Number(elegido) : null }));
}

function hacerActivarUsuario(uid, activar) {
  const aviso = activar
    ? '¿Reactivar esta cuenta? Va a poder volver a entrar.'
    : '¿Desactivar esta cuenta?\n\nNo se borra nada: la persona deja de poder entrar '
      + 'y sus turnos quedan como están.';
  if (!confirm(aviso)) return;
  conAviso(() => setActivo(uid, activar));
}

function hacerResetearUsuario(uid, user) {
  if (!confirm(`Se le va a generar una contraseña temporal a "${user}", `
    + 'y la app le va a pedir que la cambie al entrar.\n\n¿Continuar?')) return;
  conAviso(() => resetearPass(uid),
    (pass) => `Contraseña temporal de ${user}:\n\n    ${pass}\n\n`
      + 'Pasásela por un medio seguro. La tiene que cambiar en el primer ingreso.');
}

function hacerEliminarUsuario(uid, user) {
  // Escribir el nombre es la traba: un confirm suelto se acepta de memoria.
  const escrito = prompt(`Esto elimina la cuenta "${user}" y no se puede deshacer.\n\n`
    + 'Escribí el nombre de usuario para confirmar:');
  if (escrito === null) return;
  if (escrito.trim() !== user) { alert('El nombre no coincide. No se eliminó nada.'); return; }
  conAviso(() => eliminarUsuario(uid), `Cuenta "${user}" eliminada.`);
}

async function hacerCambioPassConfig() {
  const msg = $('cfg-msg');
  const actual = $('cfg-actual').value;
  const p1 = $('cfg-nueva').value;
  const p2 = $('cfg-nueva2').value;
  msg.className = 'form-msg err';

  if (p1.length < MIN_PASS) { msg.textContent = `Mínimo ${MIN_PASS} caracteres.`; return; }
  if (p1 !== p2) { msg.textContent = 'Las contraseñas no coinciden.'; return; }

  try {
    await cambiarPassword(actual, p1);
    msg.className = 'form-msg ok';
    msg.textContent = '✓ Contraseña actualizada.';
    ['cfg-actual', 'cfg-nueva', 'cfg-nueva2'].forEach((id) => { $(id).value = ''; });
  } catch (e) {
    msg.textContent = traducirError(e);
  }
}

async function hacerCrearPadron(btn) {
  // Se bloquea antes del confirm: si no, dos clics rápidos abren dos diálogos
  // y el alta masiva corre dos veces.
  if (btn.disabled) return;
  btn.disabled = true;
  if (!confirm('Se van a crear las cuentas faltantes con su contraseña inicial.\n\n¿Continuar?')) {
    btn.disabled = false;
    return;
  }
  try {
    const { creados, asociados, omitidos, errores } = await crearPadronFaltante((user, estado) => {
      btn.textContent = `${estado}: ${user}…`;
    });
    let resumen = `Usuarios creados: ${creados.length}\nYa existían: ${omitidos.length}`;
    if (asociados.length) {
      resumen += `\n\nCuentas que ya existían y se volvieron a asociar a su vendedor:\n`
        + asociados.map((a) => `  ${a.user} → ${a.vendedor}`).join('\n');
    }
    if (creados.length) {
      resumen += '\n\nContraseñas iniciales (cada uno debe cambiarla al entrar):\n'
        + creados.map((c) => `  ${c.user} → ${c.pass}`).join('\n');
    }
    if (errores.length) {
      resumen += '\n\nCon problemas:\n' + errores.map((e) => `  ${e.user}: ${e.error}`).join('\n');
    }
    alert(resumen);
  } catch (e) {
    alert('Error creando usuarios: ' + traducirError(e));
  } finally {
    btn.disabled = false;
    cargarUsuarios();
  }
}

// ------------------------------------------------------------
//  DELEGACIÓN DE EVENTOS
// ------------------------------------------------------------
// Un solo listener para toda la app: el HTML se regenera constantemente y
// enganchar handlers uno por uno se desincroniza.

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-accion]');
  if (!el) return;
  const { accion, mod: modId, iso, turno, tab, i } = el.dataset;
  const mod = modId ? getModulo(modId) : null;

  switch (accion) {
    case 'login': hacerLogin(); break;
    case 'demo-entrar':
      $('li-user').value = el.dataset.usuario;
      $('li-pass').value = el.dataset.pass;
      hacerLogin();
      break;
    case 'logout': logout(); break;
    case 'tab': cambiarTab(tab); break;

    case 'abrir-config': abrirConfig(); break;
    case 'cerrar-config': $('modal-config').classList.remove('open'); break;
    case 'cfg-pass': hacerCambioPassConfig(); break;
    case 'crear-padron': hacerCrearPadron(el); break;
    case 'crear-usuario': hacerCrearUsuario(el); break;
    case 'extender': hacerExtender(el); break;
    case 'pedir-cambio': abrirPedirCambio(iso, turno); break;
    case 'cerrar-cambio': $('modal-cambio').classList.remove('open'); break;
    case 'enviar-cambio': enviarCambio(el); break;
    case 'abrir-pedidos': abrirPedidos(); break;
    case 'cerrar-pedidos': $('modal-pedidos').classList.remove('open'); break;
    case 'pedido-aprobar': resolverPedido(el.dataset.id, true); break;
    case 'pedido-rechazar': resolverPedido(el.dataset.id, false); break;
    case 'pedido-cancelar': hacerCancelarPedido(el.dataset.id); break;
    case 'tema':
      elegirTema(el.dataset.tema);
      // Se vuelve a dibujar para que el botón activo quede marcado.
      abrirConfig();
      break;
    case 'hist-filtrar': cargarHistorial(); break;
    case 'usuario-editar': editandoUid = el.dataset.uid; cargarUsuarios(); break;
    case 'usuario-cancelar': editandoUid = null; cargarUsuarios(); break;
    case 'usuario-guardar': hacerGuardarUsuario(el.dataset.uid); break;
    case 'usuario-activo': hacerActivarUsuario(el.dataset.uid, el.dataset.activo === '1'); break;
    case 'usuario-reset': hacerResetearUsuario(el.dataset.uid, el.dataset.user); break;
    case 'usuario-eliminar': hacerEliminarUsuario(el.dataset.uid, el.dataset.user); break;
    case 'ausencia-crear': if (mod) hacerCrearAusencia(mod); break;
    case 'ausencia-borrar': if (mod) hacerBorrarAusencia(mod, el.dataset.id); break;
    case 'vend-renombrar': hacerRenombrarVendedor(el.dataset.id, el.dataset.v); break;
    case 'vend-baja': hacerBajaVendedor(el.dataset.id, el.dataset.v, true); break;
    case 'vend-reactivar': hacerBajaVendedor(el.dataset.id, el.dataset.v, false); break;
    case 'reemplazo-aplicar': aplicarReemplazo(el.dataset.i); break;
    case 'reemplazo-rechazar': rechazarReemplazo(el.dataset.i); break;
    case 'reemplazo-aplicar-todos': aplicarTodosLosReemplazos(); break;
    case 'reemplazo-rechazar-todos': rechazarTodosLosReemplazos(); break;
    case 'pass-gate-submit': hacerCambioObligatorio(); break;
    case 'pass-gate-salir': logout(); break;

    case 'editar-celda': if (mod) abrirSelectorCelda(el, mod, iso, turno); break;
    case 'ir-a-hoy': if (mod) irAHoy(mod); break;
    case 'vista':
      if (mod) { elegirVista(mod.id, el.dataset.vista); renderCronograma(mod); }
      break;
    case 'semana-prev': if (mod) moverSemana(mod, -1); break;
    case 'semana-next': if (mod) moverSemana(mod, 1); break;
    case 'agregar-feriado': agregarFeriado(mod); break;
    case 'feriados-cargar':
      if (mod) hacerCargarFeriados(mod, $(`fer-anio-${mod.id}`).value);
      break;
    case 'feriados-actualizar': if (mod) hacerActualizarFeriados(mod); break;
    case 'feriados-confirmar': confirmarFeriados(); break;
    case 'quitar-feriado':
      if (confirm(`¿Quitar el feriado del ${formatShort(fromISO(iso))}?`)) mod.quitarFeriado(iso);
      break;
    case 'limpiar-historial':
      if (confirm('¿Borrar todo el historial de correcciones?')) mod.limpiarHistorial();
      break;
    case 'exportar': mod?.exportarCSV(); break;

    case 'revisar': revisar(mod, false); break;
    case 'revisar-todo': revisar(mod, true); break;
    case 'corregir-auto': corregirAutomatico(mod); break;
    case 'fix-aplicar': aplicarFix(Number(i)); break;
    case 'fix-rechazar': rechazarFix(Number(i)); break;
    case 'fix-aplicar-todas': aplicarTodas(); break;
    case 'fix-rechazar-todas': rechazarTodas(); break;
    case 'cerrar-fixes': $('modal-fixes').classList.remove('open'); break;
    case 'cerrar-ia': $('modal-ia').classList.remove('open'); break;
    default: break;
  }
});

// ------------------------------------------------------------
//  FERIADOS AUTOMÁTICOS
// ------------------------------------------------------------
// Nada se carga sin vista previa: un feriado borra los turnos de ese día, y
// meter veinte de golpe sin que el admin los vea sería destruir trabajo a
// ciegas.

let feriadosPendientes = null;   // { mod, nuevos, fuente }

async function hacerCargarFeriados(mod, anio) {
  const { fuente, feriados } = await traerFeriados(anio);
  mostrarPrevioFeriados(mod, nuevosPara(mod, feriados), fuente, `${anio}`);
}

async function hacerActualizarFeriados(mod) {
  // Se repasan todos los años que toca el cronograma: un decreto de mitad de
  // año puede agregar puentes en cualquiera de ellos.
  const anios = aniosOfrecidos(mod);
  const nuevos = [];
  let fuente = 'api';
  for (const a of anios) {
    const r = await traerFeriados(a);
    if (r.fuente === 'calculo') fuente = 'calculo';
    nuevos.push(...nuevosPara(mod, r.feriados));
  }
  mostrarPrevioFeriados(mod, nuevos, fuente, anios.length > 1
    ? `${anios[0]}–${anios[anios.length - 1]}` : `${anios[0]}`);
}

function mostrarPrevioFeriados(mod, nuevos, fuente, etiqueta) {
  feriadosPendientes = { mod, nuevos, fuente };

  $('modal-ia-titulo').textContent = `Feriados de ${etiqueta} — ${local(mod.id, mod.nombre)}`;

  const aviso = fuente === 'calculo'
    ? `<div class="warn-box">La consulta a ArgentinaDatos falló, así que esto sale del cálculo
       propio de la app: están los inamovibles, Carnaval y Semana Santa, pero
       <b>faltan los puentes turísticos y los traslados por decreto</b>. Probá
       "Actualizar feriados" más tarde.</div>`
    : '';

  if (!nuevos.length) {
    $('modal-ia-body').innerHTML = `${aviso}<div class="info-box">No hay feriados nuevos para cargar:
      los que devuelve la fuente ya están en el panel, o caen fuera del cronograma.</div>`;
    $('modal-ia').classList.add('open');
    return;
  }

  const pisados = nuevos.map((f) => turnosQuePisa(mod, f.iso).length).reduce((a, b) => a + b, 0);

  $('modal-ia-body').innerHTML = `
    ${aviso}
    <div class="info-box">${nuevos.length} feriado(s) nuevo(s). Se cargan sólo si confirmás.</div>
    ${pisados ? `<div class="warn-box">Van a vaciar <b>${pisados}</b> turno(s) ya asignado(s),
      que están marcados abajo. Después conviene pasar el corrector.</div>` : ''}
    <div class="fix-list">
      ${nuevos.map((f) => {
        const pisa = turnosQuePisa(mod, f.iso);
        return `<div class="fix-item">
          <div class="regla">${esc(formatShort(fromISO(f.iso)))} · ${esc(f.tipo)}</div>
          <div class="desc">${esc(f.motivo)}</div>
          ${pisa.length ? `<div class="diff"><span class="before">borra ${pisa
            .map((p) => `${p.turno === 'manana' ? 'mañana' : 'tarde'}: ${esc(nom(p.vendedor))}`)
            .join(' · ')}</span></div>` : ''}
        </div>`;
      }).join('')}
    </div>
    <div class="btn-row mt-8">
      <button class="btn-primary" data-accion="feriados-confirmar">Cargar los ${nuevos.length}</button>
      <button class="btn-secondary" data-accion="cerrar-ia">Cancelar</button>
    </div>`;

  $('modal-ia').classList.add('open');
}

async function confirmarFeriados() {
  if (!feriadosPendientes) return;
  const { mod, nuevos } = feriadosPendientes;
  feriadosPendientes = null;

  for (const f of nuevos) await mod.agregarFeriado(f.iso, f.motivo);
  $('modal-ia').classList.remove('open');
  renderCronograma(mod);
  alert(`${nuevos.length} feriado(s) cargado(s).`);
}

function agregarFeriado(mod) {
  const fecha = $(`fer-fecha-${mod.id}`).value;
  const motivo = $(`fer-nombre-${mod.id}`).value.trim() || 'Feriado';
  if (!fecha) { alert('Elegí una fecha.'); return; }
  if (!mod.cronograma[fecha]) { alert('Esa fecha está fuera del período del cronograma.'); return; }
  mod.agregarFeriado(fecha, motivo);
}

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    if (ev.target.closest('#login-screen')) hacerLogin();
    else if (ev.target.closest('#pass-gate')) hacerCambioObligatorio();
  } else if (ev.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop.open').forEach((m) => m.classList.remove('open'));
  }
});

// El selector de período no es un clic: necesita su propio listener.
document.addEventListener('change', (ev) => {
  const el = ev.target.closest('[data-accion="periodo"]');
  if (!el) return;
  elegirPeriodo(el.dataset.mod, el.value);
  renderCronograma(getModulo(el.dataset.mod));
});

document.addEventListener('change', (ev) => {
  const comp = ev.target.closest('[data-accion="cambio-companero"]');
  if (comp) { cargarTurnosCompanero(comp.value); return; }
  const el = ev.target.closest('[data-accion="elegir-vendedor"]');
  if (!el) return;
  const [modId, nombre] = el.value.split('|');
  elegirVendedor(modId, nombre || null);
  renderMiHorario();
});

document.querySelectorAll('.modal-backdrop').forEach((bd) => {
  bd.addEventListener('click', (ev) => {
    if (ev.target === bd) bd.classList.remove('open');
  });
});

vigilarConexion();
iniciarTema();
registrarServiceWorker(DEMO);

if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  console.info('Contraseñas iniciales del padrón:',
    Object.fromEntries(PADRON.map((p) => [p.user, passInicial(p.user)])));
}

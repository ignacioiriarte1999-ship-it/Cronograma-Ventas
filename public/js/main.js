// ============================================================
//  ARRANQUE Y CABLEADO DE LA INTERFAZ
// ============================================================
import { vigilarConexion } from './db.js';
import {
  observarSesion, login, logout, getSession, esAdmin, traducirError,
  cambiarPassword, listarUsuarios, crearPadronFaltante, crearUsuario, listarVendedores,
} from './auth.js';
import { MIN_PASS, passInicial, PADRON } from './config.js';
import { esc, fromISO, formatShort, formatLargo, hoyISO } from './utils.js';
import { getModulo, listaModulos } from './modules.js';
import { HORIZONTE_MINIMO_DIAS, objetivoDeCobertura, diasRestantes } from './schedule.js';
import { renderCronograma, renderMiHorario, elegirPeriodo, elegirVendedor, setPedidosPropios } from './render.js';
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
  $('user-info').textContent = sess.user + (sess.vendedor ? ` (${sess.vendedor})` : '') + ` — ${sess.rol}`;

  if (cargado) return;
  cargado = true;

  armarTabs(sess);
  for (const mod of listaModulos()) {
    mod.onCambio = alCambiarModulo;
    avisoEnPanel(mod, `Cargando ${esc(mod.nombre)}…`);

    let ok = false;
    try {
      ok = await mod.cargar();
    } catch (e) {
      console.error(`Cargando ${mod.id}:`, e);
      avisoEnPanel(mod, `No se pudo cargar ${esc(mod.nombre)}.`, e.message);
      continue;
    }
    if (!ok) {
      avisoEnPanel(mod, `No se pudo cargar ${esc(mod.nombre)}.`,
        'Revisá la consola del navegador para ver el detalle.');
      continue;
    }

    // Base recién creada: el admin siembra el cronograma inicial.
    if (mod.estaVacio()) {
      if (esAdmin()) {
        console.info(`Sembrando el cronograma inicial de ${mod.nombre}…`);
        await mod.regenerar();
      } else {
        avisoEnPanel(mod, `${esc(mod.nombre)} todavía no tiene turnos cargados.`,
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
    if (r.ok) hechos.push({ nombre: mod.nombre, restan, ...r });
    else console.warn(`No se extendió ${mod.nombre}: ${r.motivo}`);
  }

  if (hechos.length) mostrarAvisoExtension(hechos);
}

function mostrarAvisoExtension(hechos) {
  $('modal-ia-titulo').textContent = '📅 Cronograma extendido';
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
    if (r.ok) hechos.push({ nombre: mod.nombre, ...r });
    else console.info(`${mod.nombre}: ${r.motivo}`);
  }
  btn.disabled = false;
  btn.textContent = 'Extender hasta fin del año que viene';
  $('modal-config').classList.remove('open');
  if (hechos.length) mostrarAvisoExtension(hechos);
  else alert('No hubo nada que extender: ambos cronogramas ya llegan hasta ' + objetivo + '.');
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
      btn.style.display = estaInstalado() && n > 0 ? '' : 'none';
      $('pedidos-badge').textContent = n;
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
        ${companeros.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}
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
      <span class="quien">${esc(p.pide.nombre)}</span> quiere cambiar con
      <span class="quien">${esc(p.recibe.nombre)}</span>
      <span class="muted small">· ${esc(mod?.nombre || p.puntoVenta)}
      · ${new Date(p.creado).toLocaleDateString('es-AR')}</span>
    </div>
    <div class="trueque">
      <div class="lado"><b>${esc(p.pide.nombre)}</b> deja<br />${esc(describirTurno(p.pide))}</div>
      <div class="flecha">⇄</div>
      <div class="lado"><b>${esc(p.recibe.nombre)}</b> deja<br />${esc(describirTurno(p.recibe))}</div>
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
    if (!confirm(`${p.pide.nombre} ⇄ ${p.recibe.nombre}${aviso}`)) return;
  } else if (!confirm(`¿Rechazar el pedido de ${p.pide.nombre}?`)) {
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
  const todos = listaModulos().map((m) => ({ id: m.id, label: m.nombre }));
  const propio = getModulo(sess.puntoVenta);
  let tabs;
  let inicial;

  if (propio) {
    // Vendedor: su punto de venta y sus propios turnos.
    tabs = [{ id: propio.id, label: propio.nombre }, { id: 'mio', label: 'Mi horario' }];
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
    <div class="stat-heading">Cambiar mi contraseña</div>
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
        `${esc(m.nombre)}: hasta ${m.hasta || '—'} (${diasRestantes(m.hasta)} días)`).join(' · ')}</div>
      <button class="btn-secondary" data-accion="extender">Extender hasta fin del año que viene</button>
      <div class="muted small mt-4">Continúa la rotación vigente sin tocar lo ya cargado.
      La app lo hace sola cuando quedan menos de ${HORIZONTE_MINIMO_DIAS} días.</div>

      <hr><div class="stat-heading">Usuarios</div>
      <div id="cfg-usuarios" class="muted small">Cargando…</div>`;
  }

  $('config-body').innerHTML = html;
  $('modal-config').classList.add('open');
  if (esAdmin()) {
    cargarUsuarios();
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
        html += `<option value="${v.id}">${esc(v.nombre)}${usado}</option>`;
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
    const faltantes = PADRON.filter((p) => !usuarios.some((u) => u.user === p.user));

    let html = '';
    if (faltantes.length > 0) {
      html += `<div class="info-box">Faltan dar de alta <b>${faltantes.length}</b> usuario(s):
        ${esc(faltantes.map((f) => f.user).join(', '))}</div>
        <button class="btn-primary mb-8" data-accion="crear-padron">Crear los ${faltantes.length} usuarios faltantes</button>`;
    }

    html += `<div class="user-list">${usuarios.map((u) => `
      <div class="user-row">
        <div>${esc(u.user)} ${u.vendedor ? `<span class="muted">(${esc(u.vendedor)})</span>` : ''}
          <span class="role-tag ${u.rol === 'admin' ? 'admin' : 'vend'}">${esc(u.rol)}</span></div>
        <div class="muted small">${u.puntoVenta ? esc(u.puntoVenta.toUpperCase()) : '—'}</div>
        <div class="muted small">${u.passCambiada ? '🔒 propia' : '🔓 inicial'}</div>
      </div>`).join('')}</div>
      <div class="muted small mt-8">Para <b>resetear la contraseña</b> de alguien o <b>dar de baja</b> una cuenta,
      entrá al panel de Supabase → Authentication → Users. Por seguridad, esas acciones no se pueden hacer desde el navegador.</div>`;

    cont.className = '';
    cont.innerHTML = html;
  } catch (e) {
    cont.innerHTML = `<div class="warn-box">No se pudieron leer los usuarios: ${esc(traducirError(e))}</div>`;
  }
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
  if (!confirm('Se van a crear las cuentas faltantes con su contraseña inicial.\n\n¿Continuar?')) return;
  btn.disabled = true;
  try {
    const { creados, omitidos, errores } = await crearPadronFaltante((user, estado) => {
      btn.textContent = `${estado}: ${user}…`;
    });
    let resumen = `Usuarios creados: ${creados.length}\nYa existían: ${omitidos.length}`;
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
    case 'pass-gate-submit': hacerCambioObligatorio(); break;
    case 'pass-gate-salir': logout(); break;

    case 'rotar': mod?.rotarCelda(iso, turno); break;
    case 'agregar-feriado': agregarFeriado(mod); break;
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

if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  console.info('Contraseñas iniciales del padrón:',
    Object.fromEntries(PADRON.map((p) => [p.user, passInicial(p.user)])));
}

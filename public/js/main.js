// ============================================================
//  ARRANQUE Y CABLEADO DE LA INTERFAZ
// ============================================================
import { vigilarConexion } from './db.js';
import {
  observarSesion, login, logout, getSession, esAdmin, traducirError,
  cambiarPassword, listarUsuarios, crearPadronFaltante,
} from './auth.js';
import { MIN_PASS, passInicial, PADRON } from './config.js';
import { esc, fromISO, formatShort } from './utils.js';
import { getModulo, listaModulos } from './modules.js';
import { renderCronograma, renderMiHorario } from './render.js';
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
    const ok = await mod.cargar();
    if (!ok) continue;

    // Base recién creada: el admin siembra el cronograma inicial.
    if (mod.estaVacio() && esAdmin()) {
      console.info(`Sembrando el cronograma inicial de ${mod.nombre}…`);
      await mod.regenerar();
    }
    mod.suscribir();
    alCambiarModulo(mod);
  }
}

function alCambiarModulo(mod) {
  renderCronograma(mod);
  const sess = getSession();
  if (sess && sess.puntoVenta === mod.id && tabActual === 'mio') renderMiHorario(mod);
}

function armarTabs(sess) {
  const tabs = [];
  if (esAdmin()) {
    tabs.push({ id: 'cc', label: 'ContacCenter' }, { id: 'lp', label: 'Laprida 235' });
  } else {
    const mod = getModulo(sess.puntoVenta);
    if (mod) tabs.push({ id: mod.id, label: mod.nombre });
    tabs.push({ id: 'mio', label: 'Mi horario' });
  }
  $('tabs').innerHTML = tabs
    .map((t) => `<button data-accion="tab" data-tab="${t.id}">${esc(t.label)}</button>`)
    .join('');
  cambiarTab(esAdmin() ? 'cc' : 'mio');
}

function cambiarTab(tabId) {
  tabActual = tabId;
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.remove('active'));
  $(`tab-${tabId}`)?.classList.add('active');
  document.querySelector(`#tabs button[data-tab="${tabId}"]`)?.classList.add('active');
  if (tabId === 'mio') renderMiHorario(getModulo(getSession()?.puntoVenta));
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
    html += `<hr><div class="stat-heading">Usuarios</div>
      <div id="cfg-usuarios" class="muted small">Cargando…</div>
      <hr>
      <div class="stat-heading">Zona de riesgo</div>
      <button class="btn-secondary peligro" data-accion="regenerar">Regenerar ambos cronogramas desde cero</button>
      <div class="muted small mt-4">Descarta todas las ediciones manuales y vuelve a aplicar las reglas por defecto. Los feriados y el historial se conservan.</div>`;
  }

  $('config-body').innerHTML = html;
  $('modal-config').classList.add('open');
  if (esAdmin()) cargarUsuarios();
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

async function hacerRegenerar() {
  if (!confirm('Vas a REGENERAR ambos cronogramas desde cero.\n\nSe pierden todas las ediciones manuales. ¿Seguro?')) return;
  $('modal-config').classList.remove('open');
  for (const mod of listaModulos()) await mod.regenerar();
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
    case 'regenerar': hacerRegenerar(); break;
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

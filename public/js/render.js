// ============================================================
//  RENDERIZADO
// ============================================================
import { getSession, esAdmin } from './auth.js';
import { getModulo, listaModulos } from './modules.js';
import { INICIO_SEMESTRE, FIN_SEMESTRE } from './config.js';
import {
  toISO, fromISO, addDays, formatShort, formatLargo, hoyISO, esc,
  DIAS_LARGOS, MESES_LARGOS, agruparPorSemanaDesde,
} from './utils.js';

const pad2 = (n) => String(n).padStart(2, '0');

// ------------------------------------------------------------
//  VISTA CRONOGRAMA
// ------------------------------------------------------------
// Período elegido por cronograma. Con un año y medio cargado, mostrar las
// ~78 semanas juntas vuelve la página inusable.
const periodoElegido = {};
export const elegirPeriodo = (modId, clave) => { periodoElegido[modId] = clave; };

const MESES_SEM = ['ene–jun', 'jul–dic'];
const claveDe = (iso) => {
  const d = fromISO(iso);
  return `${d.getFullYear()}-${d.getMonth() < 6 ? 0 : 1}`;
};
const etiquetaDe = (clave) => {
  const [anio, sem] = clave.split('-');
  return `${anio} · ${MESES_SEM[Number(sem)]}`;
};

function periodosDe(semanas) {
  const cuenta = new Map();
  for (const s of semanas) {
    const c = claveDe(s.lunes);
    cuenta.set(c, (cuenta.get(c) || 0) + 1);
  }
  return [...cuenta.entries()].map(([clave, n]) => ({ clave, n })).sort((a, b) => a.clave.localeCompare(b.clave));
}

export function renderCronograma(mod) {
  const container = document.getElementById(`tab-${mod.id}`);
  if (!container) return;
  const editable = esAdmin();

  const todas = agruparPorSemanaDesde(Object.keys(mod.cronograma).sort());
  const periodos = periodosDe(todas);

  // Por defecto, el período donde cae hoy; si no hay, el primero.
  let clave = periodoElegido[mod.id];
  if (!clave || !periodos.some((p) => p.clave === clave)) {
    const hoyClave = claveDe(hoyISO());
    clave = periodos.some((p) => p.clave === hoyClave) ? hoyClave : periodos[0]?.clave;
    periodoElegido[mod.id] = clave;
  }
  const semanas = todas
    .map((s, i) => ({ ...s, n: i + 1 }))
    .filter((s) => claveDe(s.lunes) === clave);

  const totales = {};
  for (const v of mod.vendedores) totales[v] = { M: 0, T: 0, S: 0, total: 0 };
  for (const sem of semanas) {
    const s = mod.statsSemana(sem);
    for (const v of mod.vendedores) {
      totales[v].M += s[v].M;
      totales[v].T += s[v].T;
      totales[v].S += s[v].S;
      totales[v].total += s[v].total;
    }
  }

  container.innerHTML = `<div class="cron-wrap">
    <main class="cron-main">${htmlSemanas(mod, semanas, editable, periodos, clave, todas.length)}</main>
    <aside class="cron-side">${htmlSidebar(mod, totales, editable, clave)}</aside>
  </div>`;
}

function htmlSidebar(mod, totales, editable, clave) {
  let html = `<div class="panel">
    <h2>Estadísticas de ${esc(etiquetaDe(clave))}</h2>
    ${mod.vendedores.map((v) => `
      <div class="stat-row">
        <span class="lbl"><span class="pill ${mod.pillClass(v)}">${esc(v)}</span></span>
        <span class="val">${totales[v].total}
          <span class="val-detalle">(M:${totales[v].M} T:${totales[v].T} S:${totales[v].S})</span>
        </span>
      </div>`).join('')}
  </div>`;

  if (!editable) {
    return html + `<div class="panel">
      <div class="info-box">Estás viendo el cronograma en modo <b>solo lectura</b>.
      Para ver únicamente tus turnos andá a <b>Mi horario</b>.</div>
    </div>`;
  }

  const feriados = Object.keys(mod.feriados).sort();
  html += `<div class="panel">
    <h2>Feriados (${feriados.length})</h2>
    <div class="scroll-200">
      ${feriados.map((iso) => `
        <div class="feriado-item">
          <span>${formatShort(fromISO(iso))} <span class="muted">${esc(mod.feriados[iso])}</span></span>
          <button class="rm" data-accion="quitar-feriado" data-mod="${mod.id}" data-iso="${iso}"
                  title="Quitar feriado">✕</button>
        </div>`).join('') || '<div class="muted small">Sin feriados</div>'}
    </div>
    <div class="feriado-form">
      <input type="date" class="txt" id="fer-fecha-${mod.id}"
             min="${mod.desde || INICIO_SEMESTRE}" max="${mod.hasta || FIN_SEMESTRE}" />
      <input type="text" class="txt" id="fer-nombre-${mod.id}" placeholder="Motivo" maxlength="120" />
      <button class="btn-secondary" data-accion="agregar-feriado" data-mod="${mod.id}">＋</button>
    </div>
  </div>`;

  html += `<div class="panel">
    <h2>Corrector automatizado</h2>
    <div class="btn-col">
      <button class="btn-secondary" data-accion="revisar" data-mod="${mod.id}">Revisar cambios recientes</button>
      <button class="btn-secondary" data-accion="revisar-todo" data-mod="${mod.id}">Revisar todo el semestre</button>
      <button class="btn-ai" data-accion="corregir-auto" data-mod="${mod.id}">⚡ Corregir automáticamente</button>
    </div>
    <div class="muted small">Aplica en cadena las correcciones seguras y se detiene cuando no quedan más cambios posibles.</div>
  </div>`;

  const hist = mod.historial.slice(-8).reverse();
  html += `<div class="panel">
    <h2>Historial <span class="muted normal">(${mod.historial.length})</span></h2>
    <div class="scroll-280">
      ${hist.length === 0 ? '<div class="muted small">Sin historial aún</div>' : hist.map((h) => `
        <div class="historial-item ${esc(h.estado)}">
          <div class="ts">${new Date(h.ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            — <span class="regla-txt">${esc(h.regla)}</span></div>
          <div class="desc">${esc(h.descripcion)}</div>
          ${h.diff ? `<div class="diff"><span class="before">${esc(h.diff.antes)}</span> → <span class="after">${esc(h.diff.despues)}</span></div>` : ''}
        </div>`).join('')}
    </div>
    ${mod.historial.length ? `<button class="btn-secondary full mt-8" data-accion="limpiar-historial" data-mod="${mod.id}">Limpiar historial</button>` : ''}
  </div>`;

  html += `<div class="panel">
    <button class="btn-secondary full" data-accion="exportar" data-mod="${mod.id}">📥 Exportar CSV</button>
  </div>`;

  return html;
}

/** Quién abre: la mañana del primer día laborable de la semana. */
function primerTurnoDe(mod, sem) {
  for (const iso of sem.dias) {
    const c = mod.cronograma[iso];
    if (c && !c.holiday && !c.closed && c.manana) return c.manana;
  }
  return null;
}

function htmlSemanas(mod, semanas, editable, periodos, clave, totalSemanas) {
  const hoy = hoyISO();
  const opciones = periodos.map((p) =>
    `<option value="${p.clave}"${p.clave === clave ? ' selected' : ''}>${esc(etiquetaDe(p.clave))} (${p.n} sem.)</option>`
  ).join('');
  let html = `<div class="cron-title">
    <div>
      <h1>${esc(mod.nombre)}</h1>
      <div class="sub">${esc(mod.subtitulo)}</div>
    </div>
    <div class="periodo-sel">
      ${periodos.length > 1 ? `<select class="txt" data-accion="periodo" data-mod="${mod.id}">${opciones}</select>` : ''}
      <div class="muted small">${semanas.length} de ${totalSemanas} semanas · ${mod.desde || INICIO_SEMESTRE} → ${mod.hasta || FIN_SEMESTRE}</div>
    </div>
  </div>`;

  for (let si = 0; si < semanas.length; si++) {
    const sem = semanas[si];
    const lunes = fromISO(sem.lunes);
    const domingo = addDays(lunes, 6);
    const rango = `${pad2(lunes.getDate())}/${pad2(lunes.getMonth() + 1)} al ${pad2(domingo.getDate())}/${pad2(domingo.getMonth() + 1)}`;
    const problemas = mod.detectarProblemas(sem, si);
    const esSemanaActual = hoy >= sem.lunes && hoy <= toISO(domingo);

    let badges = '';
    if (esSemanaActual) badges += '<span class="badge info">semana actual</span>';
    if (mod.tieneFeriado(sem)) badges += '<span class="badge info">feriado</span>';
    if (problemas.length === 0) {
      badges += '<span class="badge ok">✓ OK</span>';
    } else {
      const errs = problemas.filter((p) => p.severidad === 'err').length;
      const warns = problemas.filter((p) => p.severidad === 'warn').length;
      if (errs) badges += `<span class="badge err">${errs} error(es)</span>`;
      if (warns) badges += `<span class="badge warn">${warns} advertencia(s)</span>`;
    }

    let ciclo = '';
    if (mod.id === 'cc') {
      const abre = primerTurnoDe(mod, sem);
      const sabIso = sem.dias.find((iso) => fromISO(iso).getDay() === 6);
      const cierra = sabIso && !mod.cronograma[sabIso]?.holiday
        ? mod.cronograma[sabIso]?.manana : null;
      if (abre || cierra) {
        ciclo = `<span class="badge">Abre ${esc(abre || '—')} → Cierra ${esc(cierra || '—')}</span>`;
      }
    }

    html += `<div class="semana${esSemanaActual ? ' actual' : ''}" id="sem-${mod.id}-${sem.lunes}">
      <div class="sem-header">
        <div><span class="titulo">Semana ${sem.n} — ${rango}</span> ${ciclo} ${badges}</div>
      </div>
      <table class="grid">
        <thead><tr>
          <th class="col-dia">Día</th>
          <th>Mañana (${esc(mod.reglas.horarioManana)})</th>
          <th>Tarde (${esc(mod.reglas.horarioTarde)})</th>
        </tr></thead>
        <tbody>${htmlDias(mod, lunes, editable, hoy)}</tbody>
      </table>`;

    if (problemas.length > 0) {
      html += '<div class="problemas">';
      for (const p of problemas) {
        html += `<div class="${p.severidad === 'err' ? 'p-err' : 'p-warn'}"><b>[${esc(p.regla)}]</b> ${esc(p.descripcion)}</div>`;
      }
      html += '</div>';
    }
    html += '</div>';
  }
  return html;
}

function htmlDias(mod, lunes, editable, hoy) {
  let html = '';
  for (let di = 0; di < 7; di++) {
    const d = addDays(lunes, di);
    const iso = toISO(d);
    const c = mod.cronograma[iso];
    const esHoy = iso === hoy;
    const diaLbl = `<span class="d-nombre">${DIAS_LARGOS[d.getDay()].slice(0, 3)}</span>
      <span class="d-fecha">${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}</span>`;
    const trCls = esHoy ? ' class="fila-hoy"' : '';

    if (!c) {
      html += `<tr${trCls}><td class="dia">${diaLbl}</td><td colspan="2" class="cerrado">—</td></tr>`;
      continue;
    }
    if (c.closed) {
      html += `<tr${trCls}><td class="dia">${diaLbl}</td><td colspan="2" class="cerrado">Cerrado (domingo)</td></tr>`;
      continue;
    }
    if (c.holiday) {
      html += `<tr${trCls}><td class="dia">${diaLbl}</td><td colspan="2" class="feriado">🎉 FERIADO: ${esc(mod.feriados[iso] || 'feriado')}</td></tr>`;
      continue;
    }

    const esSabado = d.getDay() === 6;
    const cellM = c.manana
      ? `<span class="pill ${mod.pillClass(c.manana)}">${esc(c.manana)}</span>`
      : '<span class="muted">—</span>';
    const cellT = c.tarde
      ? `<span class="pill ${mod.pillClass(c.tarde)}">${esc(c.tarde)}</span>`
      : (esSabado ? '<span class="muted italic">solo mañana</span>' : '<span class="muted">—</span>');

    const attrM = editable ? `data-accion="rotar" data-mod="${mod.id}" data-iso="${iso}" data-turno="manana"` : '';
    const attrT = editable && !esSabado ? `data-accion="rotar" data-mod="${mod.id}" data-iso="${iso}" data-turno="tarde"` : '';
    const cls = editable ? 'cell' : 'cell ro';

    html += `<tr${trCls}>
      <td class="dia">${diaLbl}</td>
      <td class="${attrM ? cls : 'cell ro'}" ${attrM}>${cellM}</td>
      <td class="${attrT ? cls : 'cell ro'}" ${attrT}>${cellT}</td>
    </tr>`;
  }
  return html;
}

// ------------------------------------------------------------
//  VISTA "MI HORARIO"
// ------------------------------------------------------------
// Vendedor elegido a mano en "Mi horario" (admin o usuario sin vendedor propio).
let vendedorElegido = null;
/** "fecha|turno" → estado del pedido, para no pedir dos veces lo mismo. */
let pedidosPropios = new Map();
export const setPedidosPropios = (mapa) => { pedidosPropios = mapa || new Map(); };

export const elegirVendedor = (modId, nombre) => {
  vendedorElegido = nombre ? { modId, nombre } : null;
};

/** Qué horario mostrar: el propio, o el elegido en el desplegable. */
function objetivoMiHorario(sess) {
  if (sess.vendedor && sess.puntoVenta) {
    return { mod: getModulo(sess.puntoVenta), vendedor: sess.vendedor, propio: true };
  }
  if (vendedorElegido) {
    return { mod: getModulo(vendedorElegido.modId), vendedor: vendedorElegido.nombre, propio: false };
  }
  return { mod: null, vendedor: null, propio: false };
}

function selectorVendedor(elegido) {
  const grupos = listaModulos().map((m) => `
    <optgroup label="${esc(m.nombre)}">
      ${m.vendedores.map((v) => `
        <option value="${m.id}|${esc(v)}"${elegido === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}
    </optgroup>`).join('');
  return `<div class="mio-selector">
    <label for="mio-vend">Ver el horario de</label>
    <select class="txt" id="mio-vend" data-accion="elegir-vendedor">
      <option value="">— elegí un vendedor —</option>${grupos}
    </select>
  </div>`;
}

export function renderMiHorario() {
  const sess = getSession();
  const container = document.getElementById('tab-mio');
  if (!container) return;
  if (!sess) { container.innerHTML = ''; return; }

  const { mod, vendedor, propio } = objetivoMiHorario(sess);

  if (!mod || !vendedor) {
    container.innerHTML = `<div class="mio-header">
        <h2>Horario por vendedor</h2>
        <p>Elegí de quién querés ver los turnos.</p>
      </div>
      <div class="mio-body">${selectorVendedor(null)}</div>`;
    return;
  }

  const turnos = [];
  for (const iso of Object.keys(mod.cronograma).sort()) {
    const c = mod.cronograma[iso];
    if (!c || c.holiday || c.closed) continue;
    if (c.manana === vendedor) turnos.push({ iso, turno: 'manana' });
    if (c.tarde === vendedor) turnos.push({ iso, turno: 'tarde' });
  }

  const hoy = hoyISO();
  const futuros = turnos.filter((t) => t.iso >= hoy);
  const proximo = futuros[0];
  const totM = turnos.filter((t) => t.turno === 'manana' && fromISO(t.iso).getDay() !== 6).length;
  const totT = turnos.filter((t) => t.turno === 'tarde').length;
  const totS = turnos.filter((t) => t.turno === 'manana' && fromISO(t.iso).getDay() === 6).length;

  let html = `<div class="mio-header">
    <h2>${propio ? `Hola, ${esc(vendedor)}` : esc(vendedor)}</h2>
    <p>${propio ? 'Tu horario' : 'Horario'} en ${esc(mod.nombre)} · ${mod.desde || INICIO_SEMESTRE} → ${mod.hasta || FIN_SEMESTRE}</p>
  </div>
  <div class="mio-body">${propio ? '' : selectorVendedor(vendedor)}`;

  if (proximo) {
    const d = fromISO(proximo.iso);
    const hor = proximo.turno === 'manana' ? mod.reglas.horarioManana : mod.reglas.horarioTarde;
    const esHoy = proximo.iso === hoy;
    html += `<div class="mio-next">
      <div class="lbl">${esHoy ? 'Hoy trabajás' : 'Próximo turno'}</div>
      <div class="fecha">${formatLargo(d)}</div>
      <div class="turno">${proximo.turno === 'manana' ? 'Mañana' : 'Tarde'} · ${esc(hor)}</div>
    </div>`;
  } else {
    html += '<div class="empty-state">No tenés turnos futuros programados en este período.</div>';
  }

  html += `<div class="mio-summary">
    <div class="box"><div class="lbl">Total turnos</div><div class="val">${turnos.length}</div></div>
    <div class="box"><div class="lbl">Mañanas L-V</div><div class="val">${totM}</div></div>
    <div class="box"><div class="lbl">Tardes L-V</div><div class="val">${totT}</div></div>
    <div class="box"><div class="lbl">Sábados</div><div class="val">${totS}</div></div>
    <div class="box"><div class="lbl">Próximos</div><div class="val">${futuros.length}</div></div>
  </div>`;

  const porMes = {};
  for (const t of turnos) {
    const d = fromISO(t.iso);
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    (porMes[key] = porMes[key] || []).push(t);
  }

  for (const mesKey of Object.keys(porMes).sort()) {
    const [y, m] = mesKey.split('-').map(Number);
    html += `<div class="mio-mes"><h3>${MESES_LARGOS[m - 1]} ${y}</h3>`;
    for (const t of porMes[mesKey]) {
      const d = fromISO(t.iso);
      const cls = t.iso === hoy ? 'hoy' : (t.iso < hoy ? 'pasado' : '');
      const esM = t.turno === 'manana';
      const hor = esM ? mod.reglas.horarioManana : mod.reglas.horarioTarde;
      // Sólo tiene sentido pedir cambio sobre un turno propio que no pasó.
      const futuro = t.iso >= hoy;
      const pedido = pedidosPropios.get(`${t.iso}|${t.turno}`);
      let accion = '';
      if (propio && futuro) {
        accion = pedido
          ? `<div class="estado-pedido">${pedido === 'pendiente' ? '⏳ cambio pedido' : esc(pedido)}</div>`
          : `<div><button class="pedir" data-accion="pedir-cambio"
               data-iso="${t.iso}" data-turno="${t.turno}">Pedir cambio</button></div>`;
      }
      html += `<div class="mio-turno-row ${cls}${accion ? ' con-accion' : ''}">
        <div class="dia">${formatLargo(d)}</div>
        <div><span class="turno-badge ${esM ? 'M' : 'T'}">${esM ? 'Mañana' : 'Tarde'}</span></div>
        <div class="horario">${esc(hor)}</div>
        ${accion}
      </div>`;
    }
    html += '</div>';
  }

  container.innerHTML = html + '</div>';
}

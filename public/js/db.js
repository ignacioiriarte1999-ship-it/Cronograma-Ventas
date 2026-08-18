// ============================================================
//  CLIENTE DE SUPABASE
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { esDemo, crearClienteDemo } from './demo.js';

export const DEMO = esDemo();

if (!DEMO && SUPABASE_URL.startsWith('PEGAR')) {
  document.body.innerHTML = `<div style="padding:40px;font-family:system-ui;color:#e6e9f2;background:#0d1017;min-height:100vh">
    <h2>Falta configurar Supabase</h2>
    <p style="color:#7d8399;margin-top:8px">Completá <code>SUPABASE_URL</code> y <code>SUPABASE_ANON_KEY</code>
    en <code>public/js/config.js</code>. Los encontrás en el panel del proyecto,
    en Settings → API.</p></div>`;
  throw new Error('Supabase sin configurar');
}

// En demo, un backend en memoria con la misma superficie: la app no distingue.
export const sb = DEMO
  ? crearClienteDemo()
  : createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

/**
 * Cliente descartable para dar de alta cuentas.
 *
 * signUp() deja la sesión iniciada como el usuario recién creado. Con un
 * cliente que no persiste sesión ni comparte almacenamiento, el admin no
 * pierde la suya.
 */
export function clienteAislado() {
  if (DEMO) return sb;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: 'alta-temporal' },
  });
}

/** Indicador de conexión en el header. */
export function vigilarConexion(elId = 'conn-status') {
  const pintar = (estado) => {
    const el = document.getElementById(elId);
    if (!el) return;
    const colores = { ok: 'var(--ok)', off: 'var(--warn)' };
    el.style.background = colores[estado] || 'var(--muted)';
    el.title = estado === 'ok' ? 'Sincronizado' : 'Sin conexión — mostrando la última copia local';
  };
  pintar(navigator.onLine ? 'ok' : 'off');
  if (DEMO) {
    const el = document.getElementById(elId);
    if (el) el.title = 'Modo demo — los datos son de ejemplo y no se guardan';
  }
  window.addEventListener('online', () => pintar('ok'));
  window.addEventListener('offline', () => pintar('off'));
}

/** Traduce un error de PostgREST/Supabase a algo legible. */
export function traducirDb(error) {
  if (!error) return '';
  const msg = String(error.message || error);
  if (error.code === '42501' || /row-level security/i.test(msg)) {
    return 'No tenés permiso para hacer ese cambio.';
  }
  if (/Failed to fetch|NetworkError/i.test(msg)) {
    return 'Sin conexión con el servidor.';
  }
  return msg;
}

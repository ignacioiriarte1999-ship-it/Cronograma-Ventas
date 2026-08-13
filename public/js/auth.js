// ============================================================
//  AUTENTICACIÓN Y ROLES
// ============================================================
// La identidad la maneja Supabase Auth; el rol vive en la tabla perfiles y
// las policies RLS lo verifican en cada consulta. El navegador no decide
// quién es admin: lo decide Postgres.

import { sb, clienteAislado, traducirDb } from './db.js';
import { userToEmail, emailToUser, MIN_PASS, PADRON, passInicial } from './config.js';

/** Sesión activa: { uid, user, rol, vendedor, puntoVenta, passCambiada } */
let sesion = null;
export const getSession = () => sesion;
export const esAdmin = () => sesion?.rol === 'admin';

const SELECT_PERFIL = 'usuario, rol, pass_cambiada, vendedores ( nombre, punto_venta )';

function armarSesion(uid, email, perfil) {
  return {
    uid,
    user: perfil.usuario || emailToUser(email),
    rol: perfil.rol,
    vendedor: perfil.vendedores?.nombre || null,
    puntoVenta: perfil.vendedores?.punto_venta || null,
    passCambiada: perfil.pass_cambiada === true,
  };
}

/**
 * Registra el callback que corre con cada cambio de sesión.
 * Recibe la sesión con el rol ya resuelto, o null si no hay nadie.
 */
export function observarSesion(callback) {
  const resolver = async (session) => {
    if (!session?.user) {
      sesion = null;
      callback(null);
      return;
    }
    const { data: perfil, error } = await sb
      .from('perfiles').select(SELECT_PERFIL).eq('id', session.user.id).maybeSingle();

    if (error) {
      console.error('Leyendo perfil:', error);
      sesion = null;
      callback(null, traducirDb(error));
      return;
    }
    if (!perfil) {
      // La cuenta existe en Auth pero nadie la dio de alta en la app. Sin
      // perfil las policies no la dejan leer nada, así que se cierra sesión.
      await sb.auth.signOut();
      sesion = null;
      callback(null, 'Tu cuenta existe pero no tiene un perfil asignado. Pedile al administrador que te dé de alta.');
      return;
    }
    sesion = armarSesion(session.user.id, session.user.email, perfil);
    callback(sesion);
  };

  sb.auth.getSession().then(({ data }) => resolver(data.session));
  sb.auth.onAuthStateChange((evento, session) => {
    // TOKEN_REFRESHED no cambia quién sos; volver a resolver dispararía un
    // re-render completo cada hora sin motivo.
    if (evento === 'TOKEN_REFRESHED') return;
    resolver(session);
  });
}

const MENSAJES = {
  invalid_credentials: 'Usuario o contraseña incorrectos.',
  email_not_confirmed: 'Falta desactivar "Confirm email" en Authentication → Providers → Email.',
  email_provider_disabled: 'El proveedor Email está apagado. Encendé "Enable Email provider" en Authentication → Providers → Email (y dejá "Confirm email" desactivado).',
  user_already_exists: 'Ese usuario ya existe.',
  weak_password: `La contraseña debe tener al menos ${MIN_PASS} caracteres.`,
  over_request_rate_limit: 'Demasiados intentos. Esperá unos minutos.',
  signup_disabled: 'El alta de usuarios está deshabilitada en el proyecto de Supabase.',
  email_address_invalid: 'Supabase rechazó el email sintético. Revisá EMAIL_DOMAIN en config.js.',
};

export function traducirError(e) {
  if (!e) return 'Ocurrió un error inesperado.';
  if (e.code && MENSAJES[e.code]) return MENSAJES[e.code];
  const msg = String(e.message || e);
  if (/Invalid login credentials/i.test(msg)) return MENSAJES.invalid_credentials;
  if (/Email not confirmed/i.test(msg)) return MENSAJES.email_not_confirmed;
  if (/already registered/i.test(msg)) return MENSAJES.user_already_exists;
  if (/Failed to fetch/i.test(msg)) return 'Sin conexión con el servidor.';
  return msg;
}

export async function login(user, password) {
  const { error } = await sb.auth.signInWithPassword({
    email: userToEmail(user),
    password,
  });
  if (error) throw error;
}

export async function logout() {
  await sb.auth.signOut();
}

/** Cambia la contraseña del usuario logueado. */
export async function cambiarPassword(passActual, passNueva) {
  if (!passNueva || passNueva.length < MIN_PASS) {
    throw new Error(`La contraseña debe tener al menos ${MIN_PASS} caracteres.`);
  }
  if (!sesion) throw new Error('No hay sesión activa.');

  // Supabase no pide la contraseña actual para cambiarla, pero verificarla
  // evita que alguien con la sesión abierta en un equipo ajeno la secuestre.
  const { error: errLogin } = await sb.auth.signInWithPassword({
    email: userToEmail(sesion.user),
    password: passActual,
  });
  if (errLogin) throw new Error('La contraseña actual no es correcta.');

  const { error } = await sb.auth.updateUser({ password: passNueva });
  if (error) throw error;

  const { error: errPerfil } = await sb
    .from('perfiles').update({ pass_cambiada: true }).eq('id', sesion.uid);
  if (errPerfil) throw errPerfil;

  sesion.passCambiada = true;
}

// ============================================================
//  ADMINISTRACIÓN DE USUARIOS
// ============================================================

export async function listarUsuarios() {
  const { data, error } = await sb
    .from('perfiles')
    .select('id, usuario, rol, pass_cambiada, vendedores ( nombre, punto_venta )')
    .order('usuario');
  if (error) throw error;
  return (data || []).map((p) => ({
    uid: p.id,
    user: p.usuario,
    rol: p.rol,
    passCambiada: p.pass_cambiada,
    vendedor: p.vendedores?.nombre || null,
    puntoVenta: p.vendedores?.punto_venta || null,
  }));
}

/** Busca el id del vendedor por nombre y punto de venta. */
async function buscarVendedorId(puntoVenta, nombre) {
  if (!puntoVenta || !nombre) return null;
  const { data, error } = await sb
    .from('vendedores').select('id')
    .eq('punto_venta', puntoVenta).eq('nombre', nombre).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`El vendedor "${nombre}" no existe en ${puntoVenta}. ¿Corriste schema.sql?`);
  return data.id;
}

/** Todos los vendedores, para el desplegable del alta. */
export async function listarVendedores() {
  const { data, error } = await sb
    .from('vendedores').select('id, nombre, punto_venta').order('punto_venta').order('orden');
  if (error) throw error;
  return data || [];
}

/**
 * Alta de una cuenta: la crea en Auth y le inserta el perfil.
 * Requiere estar logueado como admin — lo exigen las policies.
 *
 * `vendedorId` es opcional: sin él queda un usuario de sólo lectura que ve los
 * dos cronogramas pero no tiene vista "Mi horario", porque no representa a
 * nadie del padrón. Útil para encargados o supervisores.
 */
export async function crearUsuario({ user, rol, vendedorId = null, passCambiada = false }, password) {
  const usuario = String(user).trim().toLowerCase();
  if (!usuario) throw new Error('Falta el nombre de usuario.');
  if (!password || password.length < MIN_PASS) {
    throw new Error(`La contraseña debe tener al menos ${MIN_PASS} caracteres.`);
  }

  const temp = clienteAislado();
  const { data, error } = await temp.auth.signUp({ email: userToEmail(usuario), password });
  if (error) throw error;
  const uid = data.user?.id;
  if (!uid) throw new Error('Supabase no devolvió el id del usuario creado.');
  await temp.auth.signOut();

  const { error: errPerfil } = await sb.from('perfiles').insert({
    id: uid, usuario, rol, vendedor_id: vendedorId, pass_cambiada: passCambiada,
  });
  if (errPerfil) {
    // La cuenta quedó en Auth sin perfil; sin él no puede leer nada, pero hay
    // que decirlo para que se limpie desde el panel de Supabase.
    throw new Error(`${traducirError(errPerfil)}\n\nLa cuenta "${usuario}" quedó creada en `
      + 'Authentication pero sin perfil. Borrala desde el panel de Supabase y volvé a intentar.');
  }
  return uid;
}

/**
 * Alta masiva del padrón. Saltea los que ya existen, así que se puede volver
 * a correr para incorporar a alguien que faltaba.
 */
export async function crearPadronFaltante(onProgreso = () => {}) {
  const existentes = new Set((await listarUsuarios()).map((u) => u.user));
  const creados = [];
  const omitidos = [];
  const errores = [];

  for (const p of PADRON) {
    if (existentes.has(p.user)) { omitidos.push(p.user); onProgreso(p.user, 'omitido'); continue; }
    try {
      const vendedorId = await buscarVendedorId(p.puntoVenta, p.vendedor);
      await crearUsuario({ user: p.user, rol: p.rol, vendedorId }, passInicial(p.user));
      creados.push({ user: p.user, pass: passInicial(p.user) });
      onProgreso(p.user, 'creado');
    } catch (e) {
      errores.push({ user: p.user, error: traducirError(e) });
      onProgreso(p.user, 'error');
    }
  }
  return { creados, omitidos, errores };
}

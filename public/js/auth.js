// ============================================================
//  AUTENTICACIÓN Y ROLES
// ============================================================
// La identidad la maneja Firebase Authentication; el rol vive en /roles/$uid
// y sólo un admin puede escribirlo (ver database.rules.json). El navegador ya
// no decide quién es admin: lo decide el servidor en cada lectura y escritura.

import {
  auth, db, ref, get, set, update,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
  crearCuentaAislada,
} from './firebase.js';
import { userToEmail, emailToUser, MIN_PASS, PADRON, passInicial } from './config.js';

/** Sesión activa: { uid, user, role, vendedor, cronograma, passChanged } */
let sesion = null;
export const getSession = () => sesion;
export const esAdmin = () => sesion?.role === 'admin';

/**
 * Registra el callback que se dispara con cada cambio de sesión.
 * Recibe la sesión completa (con rol ya resuelto) o null si no hay nadie.
 */
export function observarSesion(callback) {
  onAuthStateChanged(auth, async (usuario) => {
    if (!usuario) {
      sesion = null;
      callback(null);
      return;
    }
    let perfil = null;
    try {
      perfil = (await get(ref(db, `roles/${usuario.uid}`))).val();
    } catch (e) {
      console.warn('No se pudo leer el rol:', e);
    }
    if (!perfil) {
      // Cuenta sin rol asignado: existe en Auth pero nadie la dio de alta en la
      // app. Sin rol no puede leer nada, así que se cierra la sesión.
      await signOut(auth);
      sesion = null;
      callback(null, 'Tu cuenta existe pero no tiene un perfil asignado. Pedile al administrador que te dé de alta.');
      return;
    }
    sesion = {
      uid: usuario.uid,
      user: perfil.user || emailToUser(usuario.email),
      role: perfil.role,
      vendedor: perfil.vendedor || null,
      cronograma: perfil.cronograma || null,
      passChanged: perfil.passChanged === true,
    };
    callback(sesion);
  });
}

const MENSAJES = {
  'auth/invalid-credential': 'Usuario o contraseña incorrectos.',
  'auth/invalid-login-credentials': 'Usuario o contraseña incorrectos.',
  'auth/wrong-password': 'Usuario o contraseña incorrectos.',
  'auth/user-not-found': 'Usuario o contraseña incorrectos.',
  'auth/invalid-email': 'El nombre de usuario no es válido.',
  'auth/user-disabled': 'Esta cuenta está deshabilitada. Hablá con el administrador.',
  'auth/too-many-requests': 'Demasiados intentos fallidos. Esperá unos minutos.',
  'auth/network-request-failed': 'Sin conexión. Revisá tu internet.',
  'auth/weak-password': `La contraseña debe tener al menos ${MIN_PASS} caracteres.`,
  'auth/email-already-in-use': 'Ese usuario ya existe.',
  'auth/operation-not-allowed': 'Falta habilitar el proveedor Email/Contraseña en la consola de Firebase.',
};
export const traducirError = (e) => MENSAJES[e?.code] || e?.message || 'Ocurrió un error inesperado.';

export async function login(user, password) {
  await signInWithEmailAndPassword(auth, userToEmail(user), password);
}

export async function logout() {
  await signOut(auth);
}

/**
 * Cambia la contraseña del usuario logueado.
 * Firebase pide reautenticar antes de una operación sensible si la sesión
 * tiene rato, así que se revalida con la contraseña actual.
 */
export async function cambiarPassword(passActual, passNueva) {
  if (!passNueva || passNueva.length < MIN_PASS) {
    throw new Error(`La contraseña debe tener al menos ${MIN_PASS} caracteres.`);
  }
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('No hay sesión activa.');

  const cred = EmailAuthProvider.credential(usuario.email, passActual);
  await reauthenticateWithCredential(usuario, cred);
  await updatePassword(usuario, passNueva);

  // Las reglas permiten a cada usuario escribir sólo este campo de su perfil.
  await set(ref(db, `roles/${usuario.uid}/passChanged`), true);
  if (sesion) sesion.passChanged = true;
}

// ============================================================
//  ADMINISTRACIÓN DE USUARIOS
// ============================================================

export async function listarUsuarios() {
  const snap = await get(ref(db, 'roles'));
  const data = snap.val() || {};
  return Object.entries(data)
    .map(([uid, p]) => ({ uid, ...p }))
    .sort((a, b) => String(a.user).localeCompare(String(b.user)));
}

/**
 * Alta de una cuenta: la crea en Firebase Auth y le escribe el perfil en /roles.
 * Devuelve el uid. Requiere estar logueado como admin (lo exigen las reglas).
 */
export async function crearUsuario({ user, role, vendedor, cronograma }, password) {
  const uid = await crearCuentaAislada(userToEmail(user), password);
  const perfil = { user, role, passChanged: false };
  if (vendedor) perfil.vendedor = vendedor;
  if (cronograma) perfil.cronograma = cronograma;
  await set(ref(db, `roles/${uid}`), perfil);
  return uid;
}

/**
 * Alta masiva del padrón inicial. Saltea los usuarios que ya existen, así que
 * es seguro volver a correrla para incorporar a alguien que faltaba.
 */
export async function crearPadronFaltante(onProgreso = () => {}) {
  const existentes = new Set((await listarUsuarios()).map((u) => u.user));
  const creados = [];
  const omitidos = [];
  const errores = [];

  for (const p of PADRON) {
    if (existentes.has(p.user)) { omitidos.push(p.user); onProgreso(p.user, 'omitido'); continue; }
    try {
      await crearUsuario(p, passInicial(p.user));
      creados.push({ user: p.user, pass: passInicial(p.user) });
      onProgreso(p.user, 'creado');
    } catch (e) {
      // El usuario puede existir en Auth pero no en /roles (alta a medias).
      const msg = traducirError(e);
      errores.push({ user: p.user, error: msg });
      onProgreso(p.user, 'error');
    }
  }
  return { creados, omitidos, errores };
}

export async function actualizarPerfil(uid, cambios) {
  await update(ref(db, `roles/${uid}`), cambios);
}

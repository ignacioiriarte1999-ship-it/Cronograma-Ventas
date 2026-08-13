// ============================================================
//  INICIALIZACIÓN DE FIREBASE
// ============================================================
import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
  createUserWithEmailAndPassword, setPersistence, browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  getDatabase, ref, get, set, update, onValue,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

import { FIREBASE_CONFIG } from './config.js';

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = getDatabase(app);

// La sesión sobrevive al cierre de pestaña: los vendedores consultan el
// horario desde el celular y volver a loguearse cada vez es fricción inútil.
await setPersistence(auth, browserLocalPersistence);

export {
  ref, get, set, update, onValue,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
};

/**
 * Indicador de conexión con la nube en el header.
 */
export function vigilarConexion(elId = 'fb-status') {
  onValue(ref(db, '.info/connected'), (snap) => {
    const el = document.getElementById(elId);
    if (!el) return;
    if (snap.val()) {
      el.style.background = 'var(--ok)';
      el.title = 'Sincronizado con la nube';
    } else {
      el.style.background = 'var(--warn)';
      el.title = 'Sin conexión — mostrando la última copia local';
    }
  });
}

/**
 * Crea una cuenta sin desloguear al admin.
 *
 * createUserWithEmailAndPassword deja sesión iniciada como el usuario recién
 * creado. Para evitar que el admin pierda la suya, el alta se hace sobre una
 * instancia secundaria y descartable de la app.
 */
export async function crearCuentaAislada(email, password) {
  const secundaria = initializeApp(FIREBASE_CONFIG, `alta-${Date.now()}`);
  try {
    const authSec = getAuth(secundaria);
    const cred = await createUserWithEmailAndPassword(authSec, email, password);
    const uid = cred.user.uid;
    await signOut(authSec);
    return uid;
  } finally {
    await deleteApp(secundaria);
  }
}

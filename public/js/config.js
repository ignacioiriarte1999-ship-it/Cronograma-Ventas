// ============================================================
//  CONFIGURACIÓN GLOBAL
// ============================================================
// Estos valores son públicos por diseño: la config de Firebase para web
// identifica al proyecto, no autoriza nada. Quién puede leer y escribir lo
// deciden las reglas de la Realtime Database (ver database.rules.json) junto
// con Firebase Authentication.

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD7raX21KVNolz7vZwo-14LysHz09sZkPk',
  authDomain: 'cronograma-ventas.firebaseapp.com',
  databaseURL: 'https://cronograma-ventas-default-rtdb.firebaseio.com',
  projectId: 'cronograma-ventas',
  storageBucket: 'cronograma-ventas.firebasestorage.app',
  messagingSenderId: '421656156342',
  appId: '1:421656156342:web:7d1104354fbeb541616e17',
};

// Firebase Auth necesita un email. Los vendedores no tienen casilla corporativa,
// así que se construye una sintética a partir del usuario: ortiz@cronograma.local
export const EMAIL_DOMAIN = 'cronograma.local';
export const userToEmail = (user) => `${String(user).trim().toLowerCase()}@${EMAIL_DOMAIN}`;
export const emailToUser = (email) => String(email || '').split('@')[0];

// Firebase exige contraseñas de 6 caracteres como mínimo.
export const MIN_PASS = 6;

// ============================================================
//  PERÍODO
// ============================================================
export const INICIO_SEMESTRE = '2026-07-06';
export const FIN_SEMESTRE = '2027-01-03';

export const FERIADOS_DEFAULT = {
  '2026-07-09': 'Día de la Independencia',
  '2026-07-10': 'No laborable c/ fines turísticos',
  '2026-08-17': 'Paso a la Inmortalidad Gral. San Martín',
  '2026-09-24': 'Día de la Batalla de Tucumán',
  '2026-10-12': 'Día del Respeto a la Diversidad Cultural',
  '2026-11-23': 'Día de la Soberanía Nacional',
  '2026-12-07': 'No laborable c/ fines turísticos',
  '2026-12-08': 'Inmaculada Concepción de María',
  '2026-12-25': 'Navidad',
};

// ============================================================
//  PADRÓN INICIAL
// ============================================================
// Sólo se usa para el alta masiva desde el panel de admin (⚙️ → Usuarios).
// Una vez creadas las cuentas, la fuente de verdad es Firebase Auth + /roles.
// La contraseña inicial es <apellido sin guiones>2026 y la app obliga a
// cambiarla en el primer ingreso.

export const PADRON = [
  { user: 'admin',       role: 'admin',    vendedor: null,          cronograma: null },
  { user: 'imbaud',      role: 'vendedor', vendedor: 'Imbaud',      cronograma: 'cc' },
  { user: 'ortiz',       role: 'vendedor', vendedor: 'Ortiz',       cronograma: 'cc' },
  { user: 'de_santis',   role: 'vendedor', vendedor: 'De Santis',   cronograma: 'cc' },
  { user: 'arevalo',     role: 'vendedor', vendedor: 'Arevalo',     cronograma: 'lp' },
  { user: 'de_la_rosa',  role: 'vendedor', vendedor: 'De la Rosa',  cronograma: 'lp' },
  { user: 'diaz',        role: 'vendedor', vendedor: 'Diaz',        cronograma: 'lp' },
  { user: 'erazo',       role: 'vendedor', vendedor: 'Erazo',       cronograma: 'lp' },
  { user: 'juarez',      role: 'vendedor', vendedor: 'Juarez',      cronograma: 'lp' },
  { user: 'orellana',    role: 'vendedor', vendedor: 'Orellana',    cronograma: 'lp' },
  { user: 'quiroga',     role: 'vendedor', vendedor: 'Quiroga',     cronograma: 'lp' },
  { user: 'rios',        role: 'vendedor', vendedor: 'Rios',        cronograma: 'lp' },
  { user: 'santillan',   role: 'vendedor', vendedor: 'Santillan',   cronograma: 'lp' },
  { user: 'soria',       role: 'vendedor', vendedor: 'Soria',       cronograma: 'lp' },
  { user: 'valdez',      role: 'vendedor', vendedor: 'Valdez',      cronograma: 'lp' },
  { user: 'varas',       role: 'vendedor', vendedor: 'Varas',       cronograma: 'lp' },
];

export const passInicial = (user) => `${String(user).replace(/_/g, '').toLowerCase()}2026`;

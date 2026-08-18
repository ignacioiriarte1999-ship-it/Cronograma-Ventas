// ============================================================
//  CONFIGURACIÓN GLOBAL
// ============================================================

// La URL y la clave publishable son públicas por diseño: identifican al
// proyecto y no autorizan nada por sí solas. Quién puede leer y escribir cada
// tabla lo deciden las policies RLS (ver supabase/schema.sql).
//
// Acá va SIEMPRE la clave `sb_publishable_...`, nunca la `service_role`:
// esa última saltea todas las policies y no debe salir del panel de Supabase.
export const SUPABASE_URL = 'https://thgecpbmvjhtnfoosllz.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_7v-ndT65JyD3n0vh-4LBEw_IvLfyAOC';

// Supabase Auth necesita un email. Los vendedores no tienen casilla
// corporativa, así que se construye una sintética: ortiz@cronograma.local
export const EMAIL_DOMAIN = 'cronograma.local';

/**
 * Convierte lo tipeado en el login al email con el que autentica Supabase.
 *
 * Se acepta un email completo tal cual para que las cuentas creadas a mano en
 * el panel de Supabase —típicamente la del admin, con su casilla real— puedan
 * entrar sin recrearlas. Esas además son las únicas que pueden recuperar la
 * contraseña por mail: a las sintéticas no les llega nada.
 */
export const userToEmail = (entrada) => {
  const v = String(entrada).trim().toLowerCase();
  return v.includes('@') ? v : `${v}@${EMAIL_DOMAIN}`;
};

export const emailToUser = (email) => String(email || '').split('@')[0];

// Mínimo que exige Supabase Auth por defecto.
export const MIN_PASS = 6;

// ============================================================
//  PERÍODO
// ============================================================
export const INICIO_SEMESTRE = '2026-07-06';
export const FIN_SEMESTRE = '2027-01-03';

// ============================================================
//  PADRÓN INICIAL
// ============================================================
// Sólo se usa para el alta masiva desde el panel de admin (Configuración → Usuarios).
// Después de eso, la fuente de verdad es Supabase Auth + la tabla perfiles.
// La contraseña inicial es <apellido sin guiones>2026 y la app obliga a
// cambiarla en el primer ingreso.
//
// Los administradores no van acá: se crean a mano en el panel de Supabase,
// con su casilla real, para que puedan recuperar la contraseña por mail.

export const PADRON = [
  { user: 'imbaud',      rol: 'vendedor', vendedor: 'Imbaud',     puntoVenta: 'cc' },
  { user: 'ortiz',       rol: 'vendedor', vendedor: 'Ortiz',      puntoVenta: 'cc' },
  { user: 'de_santis',   rol: 'vendedor', vendedor: 'De Santis',  puntoVenta: 'cc' },
  { user: 'arevalo',     rol: 'vendedor', vendedor: 'Arevalo',    puntoVenta: 'lp' },
  { user: 'de_la_rosa',  rol: 'vendedor', vendedor: 'De la Rosa', puntoVenta: 'lp' },
  { user: 'diaz',        rol: 'vendedor', vendedor: 'Diaz',       puntoVenta: 'lp' },
  { user: 'erazo',       rol: 'vendedor', vendedor: 'Erazo',      puntoVenta: 'lp' },
  { user: 'juarez',      rol: 'vendedor', vendedor: 'Juarez',     puntoVenta: 'lp' },
  { user: 'orellana',    rol: 'vendedor', vendedor: 'Orellana',   puntoVenta: 'lp' },
  { user: 'quiroga',     rol: 'vendedor', vendedor: 'Quiroga',    puntoVenta: 'lp' },
  { user: 'rios',        rol: 'vendedor', vendedor: 'Rios',       puntoVenta: 'lp' },
  { user: 'santillan',   rol: 'vendedor', vendedor: 'Santillan',  puntoVenta: 'lp' },
  { user: 'soria',       rol: 'vendedor', vendedor: 'Soria',      puntoVenta: 'lp' },
  { user: 'valdez',      rol: 'vendedor', vendedor: 'Valdez',     puntoVenta: 'lp' },
  { user: 'varas',       rol: 'vendedor', vendedor: 'Varas',      puntoVenta: 'lp' },
];

export const passInicial = (user) => `${String(user).replace(/_/g, '').toLowerCase()}2026`;

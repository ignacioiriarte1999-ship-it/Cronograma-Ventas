// ============================================================
//  ALIAS DE VISUALIZACIÓN
// ============================================================
// La demo muestra nombres genéricos, pero las reglas de ContacCenter están
// escritas sobre nombres concretos ("Imbaud debe tener 2 mañanas"). En vez de
// reescribir esa lógica —que está verificada y no conviene tocar— se traduce
// sólo al mostrar. Internamente todo sigue igual.
//
// En producción el diccionario está vacío y estas funciones son la identidad.

let alias = {};
let etiquetaLocal = {};

export function definirAlias(nombres = {}, locales = {}) {
  alias = nombres;
  etiquetaLocal = locales;
}

/** Nombre de persona a mostrar. */
export const nom = (n) => (n == null ? n : (alias[n] ?? n));

/** Nombre de punto de venta a mostrar. */
export const local = (id, porDefecto) => etiquetaLocal[id] ?? porDefecto;

/**
 * Traduce los nombres que aparecen dentro de un texto libre.
 * Hace falta porque las descripciones del corrector los llevan embebidos
 * ("Ortiz tiene 5 turnos; debería tener 4").
 */
export function texto(s) {
  if (!s || !Object.keys(alias).length) return s;
  let out = String(s);
  // De más largo a más corto: así "De Santis" no se rompe por "De la Rosa".
  for (const real of Object.keys(alias).sort((a, b) => b.length - a.length)) {
    out = out.split(real).join(alias[real]);
  }
  return out;
}

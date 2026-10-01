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
let visibles = {};

export function definirAlias(nombres = {}, locales = {}) {
  alias = nombres;
  etiquetaLocal = locales;
}

/**
 * Renombres guardados en la base (`vendedores.nombre_visible`).
 *
 * Van por separado del alias de la demo y le ganan: si el admin renombró a
 * alguien, lo que se muestra es el nombre que eligió. El real no se filtra
 * igual, porque el renombre lo tipeó él.
 *
 * Renombrar es exactamente esto y nada más: el identificador que usan las
 * reglas sigue siendo el de siempre. ContacCenter tiene los nombres escritos
 * dentro de su lógica —`generarSemana` pone 'Imbaud' literal— así que cambiar
 * el nombre de verdad rompería la generación.
 */
export function definirVisibles(nombres = {}) {
  visibles = nombres;
}

const todos = () => ({ ...alias, ...visibles });

/** Nombre de persona a mostrar. */
export const nom = (n) => (n == null ? n : (visibles[n] ?? alias[n] ?? n));

/** Nombre de punto de venta a mostrar. */
export const local = (id, porDefecto) => etiquetaLocal[id] ?? porDefecto;

/**
 * Traduce los nombres que aparecen dentro de un texto libre.
 * Hace falta porque las descripciones del corrector los llevan embebidos
 * ("Ortiz tiene 5 turnos; debería tener 4").
 */
export function texto(s) {
  const dic = todos();
  if (!s || !Object.keys(dic).length) return s;
  let out = String(s);
  // De más largo a más corto: así "De Santis" no se rompe por "De la Rosa".
  for (const real of Object.keys(dic).sort((a, b) => b.length - a.length)) {
    out = out.split(real).join(dic[real]);
  }
  return out;
}

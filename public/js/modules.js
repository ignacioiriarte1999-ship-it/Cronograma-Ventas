// ============================================================
//  REGISTRO DE CRONOGRAMAS
// ============================================================
// Acá se juntan las dos mitades: reglas-*.js describe cómo se arma cada
// cronograma (lógica pura, sin base de datos) y schedule.js aporta la
// persistencia. Separadas, las reglas se pueden ejecutar y verificar sin
// conexión ni sesión.

import { crearModulo } from './schedule.js';
import { CONFIG_CC } from './reglas-cc.js';
import { CONFIG_LP } from './reglas-lp.js';

export const CC = crearModulo(CONFIG_CC);
export const LP = crearModulo(CONFIG_LP);

export const MODULOS = { cc: CC, lp: LP };
export const getModulo = (id) => MODULOS[id];
export const listaModulos = () => Object.values(MODULOS);

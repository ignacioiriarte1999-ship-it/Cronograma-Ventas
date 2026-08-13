// Registro de cronogramas disponibles.
import { CC } from './schedule-cc.js';
import { LP } from './schedule-lp.js';

export const MODULOS = { cc: CC, lp: LP };
export const getModulo = (id) => MODULOS[id];
export const listaModulos = () => Object.values(MODULOS);

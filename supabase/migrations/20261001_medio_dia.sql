-- ============================================================
--  MEDIOS DÍAS (error 4 del plan)
-- ============================================================
-- Se puede volver a correr entero.
--
-- El 24/12 y el 31/12 se trabaja sólo hasta las 14: no son feriados, pero la
-- tarde no se cubre. Hasta ahora la app no tenía cómo saberlo, así que esas
-- tardes quedaban vacías y el detector las marcaba como "slot vacío". La
-- advertencia era un falso positivo.
--
-- Se modela sobre `feriados` en vez de una tabla nueva porque es el mismo
-- concepto —un día con horario distinto— y así hereda todo lo que ya existe:
-- la carga, el panel del admin, el realtime y la auditoría.

alter table feriados add column if not exists medio_dia boolean not null default false;

comment on column feriados.medio_dia is
  'Si es verdadero, el día se trabaja sólo a la mañana y la tarde no se cubre. '
  'El día NO cuenta como feriado: la mañana se asigna normalmente.';

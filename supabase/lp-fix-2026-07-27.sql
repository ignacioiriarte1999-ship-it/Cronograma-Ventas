-- ============================================================
--  Laprida 235 — restaurar la rotación de la semana del 27/07
-- ============================================================
-- Esa semana tenía un intercambio de cinco personas respecto de la cola
-- cíclica. Es la única desalineada del cronograma: el 20/07 y el 03/08 ya
-- encadenan entre sí con la rotación +1, así que al corregirla la secuencia
-- queda continua.
--
-- Verificado antes de generar: los 12 vendedores aparecen una sola vez y la
-- semana resultante rota exactamente al 03/08 tal como está cargado hoy.

begin;

-- L-T: Arevalo → Erazo
update turnos set vendedor_id = (select id from vendedores where punto_venta='lp' and nombre='Erazo')
  where punto_venta='lp' and fecha='2026-07-27' and turno='tarde';

-- Ma-T: Rios → Diaz
update turnos set vendedor_id = (select id from vendedores where punto_venta='lp' and nombre='Diaz')
  where punto_venta='lp' and fecha='2026-07-28' and turno='tarde';

-- V-M: Erazo → Orellana
update turnos set vendedor_id = (select id from vendedores where punto_venta='lp' and nombre='Orellana')
  where punto_venta='lp' and fecha='2026-07-31' and turno='manana';

-- V-T: Diaz → Rios
update turnos set vendedor_id = (select id from vendedores where punto_venta='lp' and nombre='Rios')
  where punto_venta='lp' and fecha='2026-07-31' and turno='tarde';

-- S-M: Orellana → Arevalo
update turnos set vendedor_id = (select id from vendedores where punto_venta='lp' and nombre='Arevalo')
  where punto_venta='lp' and fecha='2026-08-01' and turno='manana';

-- Verificación: 11 turnos y 11 vendedores distintos en la semana.
select count(*) as turnos, count(distinct vendedor_id) as personas
from turnos where punto_venta='lp' and fecha between '2026-07-27' and '2026-08-01';

commit;

-- ============================================================
--  VENDEDORES Y AUSENCIAS (tarea 3.4)
-- ============================================================
-- Se puede volver a correr entero.

-- ------------------------------------------------------------
--  BAJA CON FECHA
-- ------------------------------------------------------------
-- `activo` ya existía pero es un sí/no sin memoria: al apagarlo, el vendedor
-- desaparecía también del pasado. Con una fecha, sale de la rotación desde
-- ese día y lo ya cargado antes queda intacto, que es lo que hace falta para
-- que el historial siga teniendo sentido.

alter table vendedores add column if not exists baja_desde date;

-- ------------------------------------------------------------
--  AUSENCIAS
-- ------------------------------------------------------------
-- Un tramo en el que el vendedor no puede tomar turnos. No borra lo que ya
-- estaba asignado: la app muestra los turnos afectados y propone reemplazos
-- que el admin aprueba uno por uno.

create table if not exists ausencias (
  id           bigint generated always as identity primary key,
  vendedor_id  bigint not null references vendedores(id) on delete cascade,
  tipo         text not null check (tipo in ('vacaciones', 'licencia', 'franco')),
  desde        date not null,
  hasta        date not null,
  nota         text,
  creado       timestamptz not null default now(),
  constraint ausencias_rango check (hasta >= desde)
);

create index if not exists ausencias_vendedor_idx on ausencias (vendedor_id, desde, hasta);

alter table ausencias enable row level security;

-- Mismo criterio que el resto: lee cualquier cuenta activa, escribe el admin.
drop policy if exists "ausencias_lectura" on ausencias;
create policy "ausencias_lectura" on ausencias
  for select to authenticated using (esta_activo());

drop policy if exists "ausencias_escritura" on ausencias;
create policy "ausencias_escritura" on ausencias
  for all to authenticated using (es_admin()) with check (es_admin());

-- Que un cambio de ausencias llegue solo a la pantalla de todos, como el
-- resto de las tablas.
do $$
begin
  alter publication supabase_realtime add table ausencias;
exception when duplicate_object then null;
end $$;

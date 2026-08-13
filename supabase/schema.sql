-- ============================================================
--  CRONOGRAMAS — ESQUEMA COMPLETO
-- ============================================================
-- Correr entero en el SQL Editor de Supabase. Es idempotente: se puede
-- volver a ejecutar sin romper nada.
--
-- Modelo: una fila por turno asignado. Un clic en una celda actualiza una
-- fila, no el semestre entero. Los domingos no se guardan: se derivan por
-- código (día 0 = cerrado). Los feriados sí, porque el admin los edita.

-- ------------------------------------------------------------
--  TABLAS
-- ------------------------------------------------------------

create table if not exists puntos_venta (
  id              text primary key,
  nombre          text not null,
  subtitulo       text,
  horario_manana  text not null default '8 a 14',
  horario_tarde   text not null default '14 a 20'
);

create table if not exists vendedores (
  id            bigint generated always as identity primary key,
  punto_venta   text not null references puntos_venta(id) on delete cascade,
  nombre        text not null,
  orden         int  not null,
  activo        boolean not null default true,
  unique (punto_venta, nombre)
);
create index if not exists vendedores_pv_idx on vendedores (punto_venta, orden);

create table if not exists perfiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  usuario        text not null unique,
  rol            text not null check (rol in ('admin', 'vendedor')),
  vendedor_id    bigint references vendedores(id) on delete set null,
  pass_cambiada  boolean not null default false,
  creado         timestamptz not null default now()
);

-- Un turno asignado. Si no hay fila, el slot está vacío.
create table if not exists turnos (
  punto_venta   text not null references puntos_venta(id) on delete cascade,
  fecha         date not null,
  turno         text not null check (turno in ('manana', 'tarde')),
  vendedor_id   bigint not null references vendedores(id) on delete cascade,
  actualizado   timestamptz not null default now(),
  primary key (punto_venta, fecha, turno)
);
create index if not exists turnos_vendedor_idx on turnos (vendedor_id, fecha);

create table if not exists feriados (
  punto_venta   text not null references puntos_venta(id) on delete cascade,
  fecha         date not null,
  motivo        text not null,
  primary key (punto_venta, fecha)
);

create table if not exists historial (
  id             bigint generated always as identity primary key,
  punto_venta    text not null references puntos_venta(id) on delete cascade,
  ts             timestamptz not null default now(),
  regla          text not null,
  estado         text not null check (estado in ('aplicada', 'rechazada')),
  descripcion    text,
  diff_antes     text,
  diff_despues   text,
  autor          uuid references auth.users(id) on delete set null
);
create index if not exists historial_pv_ts_idx on historial (punto_venta, ts desc);

-- Huella de la última revisión de cada semana, para saltear las que no
-- cambiaron cuando se corre "Revisar cambios recientes".
create table if not exists revisiones (
  punto_venta   text not null references puntos_venta(id) on delete cascade,
  lunes         date not null,
  firma         text not null,
  primary key (punto_venta, lunes)
);

-- ------------------------------------------------------------
--  ¿QUIÉN ES ADMIN?
-- ------------------------------------------------------------
-- SECURITY DEFINER a propósito: si esta función consultara perfiles bajo RLS,
-- las policies de perfiles se llamarían a sí mismas y Postgres cortaría por
-- recursión infinita.

create or replace function es_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from perfiles where id = auth.uid() and rol = 'admin'
  );
$$;

revoke all on function es_admin() from public;
grant execute on function es_admin() to authenticated;

-- ------------------------------------------------------------
--  ROW LEVEL SECURITY
-- ------------------------------------------------------------
-- Regla general: cualquier usuario autenticado LEE; sólo el admin ESCRIBE.
-- Sin sesión no se ve absolutamente nada.

alter table puntos_venta enable row level security;
alter table vendedores   enable row level security;
alter table perfiles     enable row level security;
alter table turnos       enable row level security;
alter table feriados     enable row level security;
alter table historial    enable row level security;
alter table revisiones   enable row level security;

do $$
declare t text;
begin
  -- Tablas con el patrón "leen todos los logueados, escribe el admin".
  foreach t in array array['puntos_venta', 'vendedores', 'turnos', 'feriados', 'historial', 'revisiones']
  loop
    execute format('drop policy if exists "%s_lectura" on %I', t, t);
    execute format(
      'create policy "%s_lectura" on %I for select to authenticated using (true)', t, t);

    execute format('drop policy if exists "%s_escritura" on %I', t, t);
    execute format(
      'create policy "%s_escritura" on %I for all to authenticated using (es_admin()) with check (es_admin())', t, t);
  end loop;
end $$;

-- Perfiles: cada uno ve el suyo, el admin ve todos.
drop policy if exists "perfiles_lectura" on perfiles;
create policy "perfiles_lectura" on perfiles
  for select to authenticated
  using (id = auth.uid() or es_admin());

-- Sólo el admin da de alta, modifica o borra perfiles.
drop policy if exists "perfiles_alta" on perfiles;
create policy "perfiles_alta" on perfiles
  for insert to authenticated with check (es_admin());

drop policy if exists "perfiles_baja" on perfiles;
create policy "perfiles_baja" on perfiles
  for delete to authenticated using (es_admin());

-- Update: el admin toca cualquier perfil; el resto sólo el propio.
-- La columna se protege con el trigger de abajo, porque una policy no puede
-- comparar campo por campo entre la fila vieja y la nueva.
drop policy if exists "perfiles_update" on perfiles;
create policy "perfiles_update" on perfiles
  for update to authenticated
  using (es_admin() or id = auth.uid())
  with check (es_admin() or id = auth.uid());

-- Un vendedor sólo puede cambiar su propio pass_cambiada. Sin esto podría
-- ascenderse a admin con un update a su propia fila.
create or replace function proteger_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if es_admin() then
    return new;
  end if;
  if new.usuario     is distinct from old.usuario
     or new.rol         is distinct from old.rol
     or new.vendedor_id is distinct from old.vendedor_id
     or new.id          is distinct from old.id then
    raise exception 'Sólo un administrador puede modificar esos campos del perfil.';
  end if;
  return new;
end $$;

drop trigger if exists proteger_perfil_trg on perfiles;
create trigger proteger_perfil_trg
  before update on perfiles
  for each row execute function proteger_perfil();

-- ------------------------------------------------------------
--  ARRANQUE EN FRÍO: EL PRIMER USUARIO ES EL ADMIN
-- ------------------------------------------------------------
-- Sin esto habría un huevo y la gallina: las policies sólo dejan crear
-- perfiles a un admin, pero al principio no existe ninguno. En vez de pedir
-- que se inserte a mano copiando el UID, el primer usuario que se dé de alta
-- en Authentication se convierte en admin automáticamente.
--
-- Sólo actúa mientras perfiles está vacía: en cuanto hay un admin, las altas
-- siguientes pasan por la app y este trigger no hace nada.

create or replace function perfil_del_primer_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from perfiles) then
    insert into perfiles (id, usuario, rol, pass_cambiada)
    values (new.id, split_part(new.email, '@', 1), 'admin', true);
  end if;
  return new;
end $$;

drop trigger if exists perfil_del_primer_usuario_trg on auth.users;
create trigger perfil_del_primer_usuario_trg
  after insert on auth.users
  for each row execute function perfil_del_primer_usuario();

-- ------------------------------------------------------------
--  REALTIME
-- ------------------------------------------------------------
-- Para que un cambio del admin aparezca solo en la pantalla de todos.

-- Se ignora el error si la tabla ya está publicada, para que el script se
-- pueda volver a correr entero.
do $$
declare t text;
begin
  foreach t in array array['turnos', 'feriados']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then
      null;
    end;
  end loop;
end $$;

-- ------------------------------------------------------------
--  DATOS INICIALES
-- ------------------------------------------------------------

insert into puntos_venta (id, nombre, subtitulo) values
  ('cc', 'ContacCenter',
   '3 vendedores · ciclo de 3 semanas que rota el sábado · Imbaud 3 turnos (2M+1T) · Ortiz y De Santis 4 turnos · regla del cierre activa'),
  ('lp', 'Laprida 235',
   '12 vendedores en cola cíclica · rotación +1 por semana · 1 descansa cada semana')
on conflict (id) do update
  set nombre = excluded.nombre, subtitulo = excluded.subtitulo;

insert into vendedores (punto_venta, nombre, orden) values
  ('cc', 'Imbaud', 0), ('cc', 'Ortiz', 1), ('cc', 'De Santis', 2),
  ('lp', 'Arevalo', 0), ('lp', 'De la Rosa', 1), ('lp', 'Diaz', 2),
  ('lp', 'Erazo', 3), ('lp', 'Juarez', 4), ('lp', 'Orellana', 5),
  ('lp', 'Quiroga', 6), ('lp', 'Rios', 7), ('lp', 'Santillan', 8),
  ('lp', 'Soria', 9), ('lp', 'Valdez', 10), ('lp', 'Varas', 11)
on conflict (punto_venta, nombre) do update set orden = excluded.orden;

-- Feriados 2026 para ambos puntos de venta.
insert into feriados (punto_venta, fecha, motivo)
select pv.id, f.fecha, f.motivo
from (values
  ('2026-07-09'::date, 'Día de la Independencia'),
  ('2026-07-10', 'No laborable c/ fines turísticos'),
  ('2026-08-17', 'Paso a la Inmortalidad Gral. San Martín'),
  ('2026-09-24', 'Día de la Batalla de Tucumán'),
  ('2026-10-12', 'Día del Respeto a la Diversidad Cultural'),
  ('2026-11-23', 'Día de la Soberanía Nacional'),
  ('2026-12-07', 'No laborable c/ fines turísticos'),
  ('2026-12-08', 'Inmaculada Concepción de María'),
  ('2026-12-25', 'Navidad')
) as f(fecha, motivo)
cross join (select id from puntos_venta) as pv
on conflict (punto_venta, fecha) do nothing;

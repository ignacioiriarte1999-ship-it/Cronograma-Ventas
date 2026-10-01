-- ============================================================
--  HISTORIAL DE CAMBIOS CON AUTOR (tarea 3.7)
-- ============================================================
-- Se puede volver a correr entero.
--
-- El registro lo hacen triggers, no la app: un insert desde el navegador se
-- puede saltear —basta con llamar a la API directo— y entonces el historial
-- deja de ser una garantía y pasa a ser una sugerencia. En la base, en
-- cambio, no hay forma de escribir sin quedar registrado.

-- ------------------------------------------------------------
--  ROL SUPERADMIN
-- ------------------------------------------------------------
alter table perfiles drop constraint if exists perfiles_rol_check;
alter table perfiles add constraint perfiles_rol_check
  check (rol in ('admin', 'vendedor', 'superadmin'));

create or replace function es_superadmin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from perfiles where id = auth.uid() and rol = 'superadmin' and activo
  );
$$;

revoke all on function es_superadmin() from public;
grant execute on function es_superadmin() to authenticated;

-- Un superadmin es también admin a todos los efectos: si no, perdería la
-- escritura sobre turnos y feriados al ascender.
create or replace function es_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from perfiles
    where id = auth.uid() and rol in ('admin', 'superadmin') and activo
  );
$$;

-- ------------------------------------------------------------
--  SÓLO UN SUPERADMIN REPARTE EL ROL SUPERADMIN
-- ------------------------------------------------------------
-- Sin esto, cualquier admin se asciende a sí mismo con un update a su fila y
-- se lee el historial entero. El rol tiene que ser un techo, no una puerta.

create or replace function proteger_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Sin sesión el cambio viene del SQL Editor o de una clave de servicio.
  -- Quien tiene eso ya puede apagar cualquier trigger, así que exigirle
  -- permisos acá no protege nada: sólo rompería las migraciones, empezando
  -- por la que reparte el primer rol superadmin más abajo.
  if auth.uid() is null then
    return new;
  end if;

  if (new.rol = 'superadmin') is distinct from (old.rol = 'superadmin')
     and not es_superadmin() then
    raise exception 'Sólo un superadministrador puede otorgar o quitar el rol superadmin.';
  end if;

  if es_admin() then
    if new.id = auth.uid()
       and (new.activo is distinct from old.activo or new.rol is distinct from old.rol) then
      raise exception 'Un administrador no puede desactivarse ni cambiarse el rol a sí mismo.';
    end if;
    return new;
  end if;

  if new.usuario is distinct from old.usuario
     or new.rol         is distinct from old.rol
     or new.vendedor_id is distinct from old.vendedor_id
     or new.activo      is distinct from old.activo
     or new.id          is distinct from old.id then
    raise exception 'Sólo un administrador puede modificar esos campos del perfil.';
  end if;
  return new;
end $$;

-- ------------------------------------------------------------
--  LA TABLA
-- ------------------------------------------------------------
create table if not exists auditoria (
  id             bigint generated always as identity primary key,
  ts             timestamptz not null default now(),
  actor          uuid,
  actor_usuario  text,
  punto_venta    text,
  accion         text not null check (accion in ('alta', 'cambio', 'baja')),
  entidad        text not null,
  clave          text,
  antes          jsonb,
  despues        jsonb
);

-- Los filtros del panel son por fecha, usuario, punto de venta y acción.
create index if not exists auditoria_ts_idx      on auditoria (ts desc);
create index if not exists auditoria_actor_idx   on auditoria (actor_usuario, ts desc);
create index if not exists auditoria_pv_idx      on auditoria (punto_venta, ts desc);
create index if not exists auditoria_entidad_idx on auditoria (entidad, ts desc);

alter table auditoria enable row level security;

-- Sólo el superadmin lee. Nadie escribe desde fuera: las filas las pone el
-- trigger, que corre con security definer y por eso no necesita policy.
drop policy if exists "auditoria_lectura" on auditoria;
create policy "auditoria_lectura" on auditoria
  for select to authenticated using (es_superadmin());

-- ------------------------------------------------------------
--  EL REGISTRADOR
-- ------------------------------------------------------------
create or replace function auditar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes   jsonb;
  v_despues jsonb;
  v_actor   uuid := auth.uid();
  v_usuario text;
  v_accion  text;
begin
  -- OLD y NEW no están asignados en todas las operaciones: referenciar el
  -- que no corresponde aborta el trigger.
  if TG_OP = 'INSERT' then
    v_despues := to_jsonb(NEW); v_accion := 'alta';
  elsif TG_OP = 'UPDATE' then
    v_antes := to_jsonb(OLD); v_despues := to_jsonb(NEW); v_accion := 'cambio';
  else
    v_antes := to_jsonb(OLD); v_accion := 'baja';
  end if;

  -- Un update que no cambia nada no es un cambio.
  if TG_OP = 'UPDATE' and v_antes = v_despues then
    return NEW;
  end if;

  select usuario into v_usuario from perfiles where id = v_actor;

  insert into auditoria (actor, actor_usuario, punto_venta, accion, entidad, clave, antes, despues)
  values (
    v_actor,
    -- Sin sesión el cambio vino del SQL Editor o de una Edge Function.
    coalesce(v_usuario, case when v_actor is null then '(sistema)' else '(desconocido)' end),
    coalesce(v_despues->>'punto_venta', v_antes->>'punto_venta'),
    v_accion,
    TG_TABLE_NAME,
    coalesce(
      v_despues->>'fecha',   v_antes->>'fecha',
      v_despues->>'usuario', v_antes->>'usuario',
      v_despues->>'nombre',  v_antes->>'nombre',
      v_despues->>'id',      v_antes->>'id'),
    v_antes, v_despues
  );

  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end $$;

-- ------------------------------------------------------------
--  DÓNDE SE APLICA
-- ------------------------------------------------------------
-- turnos y feriados cubren "editar celda", "feriado" y "corrección": las tres
-- terminan escribiendo en esas dos tablas. perfiles cubre "usuario",
-- ausencias cubre "ausencia" e intercambios cubre "pedido".

do $$
declare t text;
begin
  foreach t in array array['turnos', 'feriados', 'perfiles', 'vendedores', 'ausencias', 'intercambios']
  loop
    if to_regclass(t) is null then continue; end if;
    execute format('drop trigger if exists auditar_%s_trg on %I', t, t);
    execute format(
      'create trigger auditar_%s_trg after insert or update or delete on %I
         for each row execute function auditar()', t, t);
  end loop;
end $$;

-- ------------------------------------------------------------
--  EL PRIMER SUPERADMIN
-- ------------------------------------------------------------
-- Confirmado con el responsable el 26/09/2026.
update perfiles set rol = 'superadmin' where usuario = 'ignacioiriarte1999';

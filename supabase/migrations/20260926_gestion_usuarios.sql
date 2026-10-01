-- ============================================================
--  GESTIÓN DE USUARIOS (tarea 3.3)
-- ============================================================
-- Agrega la baja lógica de cuentas. Se puede volver a correr entero.
--
-- Lo que NO está acá: resetear la contraseña y eliminar la cuenta de Auth.
-- Eso necesita auth.admin.*, que no se puede llamar con la clave publishable
-- desde el navegador, y vive en la Edge Function supabase/functions/admin-usuarios.

-- ------------------------------------------------------------
--  BAJA LÓGICA
-- ------------------------------------------------------------
-- Desactivar en vez de borrar: el historial de turnos sigue teniendo sentido
-- y la persona puede volver sin rehacerle la cuenta.

alter table perfiles add column if not exists activo boolean not null default true;

-- ------------------------------------------------------------
--  QUIÉN PUEDE QUÉ
-- ------------------------------------------------------------
-- Un usuario desactivado sigue pudiendo autenticarse en Auth —eso lo maneja
-- Supabase—, pero no ve absolutamente ningún dato. La app lo detecta al leer
-- su propio perfil y lo saca con un mensaje.

create or replace function esta_activo()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from perfiles where id = auth.uid() and activo
  );
$$;

revoke all on function esta_activo() from public;
grant execute on function esta_activo() to authenticated;

-- Un admin desactivado deja de ser admin a todos los efectos.
create or replace function es_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from perfiles where id = auth.uid() and rol = 'admin' and activo
  );
$$;

-- Las tablas de datos pasan a exigir cuenta activa para leer.
do $$
declare t text;
begin
  foreach t in array array['puntos_venta', 'vendedores', 'turnos', 'feriados', 'historial', 'revisiones']
  loop
    execute format('drop policy if exists "%s_lectura" on %I', t, t);
    execute format(
      'create policy "%s_lectura" on %I for select to authenticated using (esta_activo())', t, t);
  end loop;
end $$;

-- perfiles es la excepción: cada uno sigue viendo el suyo aunque esté
-- desactivado. Sin eso la app no podría decirle por qué no entra.
drop policy if exists "perfiles_lectura" on perfiles;
create policy "perfiles_lectura" on perfiles
  for select to authenticated
  using (id = auth.uid() or es_admin());

-- ------------------------------------------------------------
--  PROTECCIONES
-- ------------------------------------------------------------
-- `activo` se suma a los campos que sólo toca un admin: sin esto un vendedor
-- podría reactivarse solo con un update a su propia fila.
--
-- Y un admin no puede desactivarse ni cambiarse el rol a sí mismo. La app ya
-- no le ofrece el botón, pero la regla vive acá para que valga también si
-- alguien llama a la API a mano.

create or replace function proteger_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if es_admin() then
    if new.id = auth.uid()
       and (new.activo is distinct from old.activo or new.rol is distinct from old.rol) then
      raise exception 'Un administrador no puede desactivarse ni cambiarse el rol a sí mismo.';
    end if;
    return new;
  end if;
  if new.usuario     is distinct from old.usuario
     or new.rol         is distinct from old.rol
     or new.vendedor_id is distinct from old.vendedor_id
     or new.activo      is distinct from old.activo
     or new.id          is distinct from old.id then
    raise exception 'Sólo un administrador puede modificar esos campos del perfil.';
  end if;
  return new;
end $$;

-- Mismo criterio para la baja: el perfil se borra en cascada cuando se
-- elimina la cuenta de Auth, y nadie puede eliminarse a sí mismo.
create or replace function proteger_baja_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.id = auth.uid() then
    raise exception 'Un administrador no puede eliminar su propia cuenta.';
  end if;
  return old;
end $$;

drop trigger if exists proteger_baja_perfil_trg on perfiles;
create trigger proteger_baja_perfil_trg
  before delete on perfiles
  for each row execute function proteger_baja_perfil();

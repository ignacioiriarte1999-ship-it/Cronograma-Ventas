-- ============================================================
--  INTERCAMBIOS DE TURNO ENTRE VENDEDORES
-- ============================================================
-- Correr en el SQL Editor. Idempotente.
--
-- Un vendedor propone cambiar uno de sus turnos por el de un compañero. El
-- pedido queda pendiente hasta que un admin lo aprueba o lo rechaza. Recién
-- al aprobarlo se tocan los turnos, y sólo esos dos: como cada turno es una
-- fila propia, el cambio no se propaga a las semanas siguientes.
--
-- Es el primer lugar donde un no-admin escribe en la base, así que las
-- policies son más finas que en el resto: puede crear su propio pedido y
-- cancelarlo mientras esté pendiente, nada más. Aprobar es sólo del admin.

create table if not exists intercambios (
  id                bigint generated always as identity primary key,
  punto_venta       text   not null references puntos_venta(id) on delete cascade,

  solicitante       uuid   not null references auth.users(id) on delete cascade,
  vendedor_pide     bigint not null references vendedores(id) on delete cascade,
  fecha_pide        date   not null,
  turno_pide        text   not null check (turno_pide in ('manana', 'tarde')),

  vendedor_recibe   bigint not null references vendedores(id) on delete cascade,
  fecha_recibe      date   not null,
  turno_recibe      text   not null check (turno_recibe in ('manana', 'tarde')),

  motivo            text,
  estado            text   not null default 'pendiente'
                      check (estado in ('pendiente', 'aprobado', 'rechazado', 'cancelado')),
  nota_admin        text,
  creado            timestamptz not null default now(),
  resuelto          timestamptz,
  resuelto_por      uuid references auth.users(id) on delete set null,

  -- Cambiar un turno por sí mismo no tiene sentido.
  constraint distintos check (
    vendedor_pide <> vendedor_recibe
    or fecha_pide <> fecha_recibe
    or turno_pide <> turno_recibe
  )
);

create index if not exists intercambios_pendientes_idx
  on intercambios (punto_venta, estado, creado desc);
create index if not exists intercambios_solicitante_idx
  on intercambios (solicitante, creado desc);

-- Un mismo turno no puede estar comprometido en dos pedidos abiertos a la vez.
create unique index if not exists intercambios_turno_pide_unico
  on intercambios (punto_venta, fecha_pide, turno_pide) where estado = 'pendiente';
create unique index if not exists intercambios_turno_recibe_unico
  on intercambios (punto_venta, fecha_recibe, turno_recibe) where estado = 'pendiente';

-- ------------------------------------------------------------
--  ¿CUÁL ES MI VENDEDOR?
-- ------------------------------------------------------------
-- SECURITY DEFINER por el mismo motivo que es_admin(): consultar perfiles
-- bajo RLS desde una policy de otra tabla vuelve a disparar sus policies.

create or replace function mi_vendedor_id()
returns bigint
language sql
security definer
stable
set search_path = public
as $$
  select vendedor_id from perfiles where id = auth.uid();
$$;

revoke all on function mi_vendedor_id() from public;
grant execute on function mi_vendedor_id() to authenticated;

-- ------------------------------------------------------------
--  ROW LEVEL SECURITY
-- ------------------------------------------------------------
alter table intercambios enable row level security;

-- Ve sus pedidos, los que lo involucran, y el admin ve todos.
drop policy if exists "intercambios_lectura" on intercambios;
create policy "intercambios_lectura" on intercambios
  for select to authenticated
  using (
    es_admin()
    or solicitante = auth.uid()
    or vendedor_recibe = mi_vendedor_id()
    or vendedor_pide = mi_vendedor_id()
  );

-- Sólo puede pedir por un turno propio, a nombre propio y como pendiente.
drop policy if exists "intercambios_alta" on intercambios;
create policy "intercambios_alta" on intercambios
  for insert to authenticated
  with check (
    solicitante = auth.uid()
    and vendedor_pide = mi_vendedor_id()
    and estado = 'pendiente'
  );

-- Resolver es potestad del admin.
drop policy if exists "intercambios_resolver" on intercambios;
create policy "intercambios_resolver" on intercambios
  for update to authenticated
  using (es_admin())
  with check (es_admin());

-- El solicitante puede dar marcha atrás mientras nadie lo resolvió.
drop policy if exists "intercambios_cancelar" on intercambios;
create policy "intercambios_cancelar" on intercambios
  for delete to authenticated
  using (es_admin() or (solicitante = auth.uid() and estado = 'pendiente'));

-- ------------------------------------------------------------
--  SELLO DE RESOLUCIÓN
-- ------------------------------------------------------------
-- Quién resolvió y cuándo lo pone la base, no el cliente: es el registro que
-- respalda un cambio de turno si después alguien lo discute.

create or replace function sellar_intercambio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado is distinct from old.estado and new.estado <> 'pendiente' then
    new.resuelto := now();
    new.resuelto_por := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists sellar_intercambio_trg on intercambios;
create trigger sellar_intercambio_trg
  before update on intercambios
  for each row execute function sellar_intercambio();

-- ------------------------------------------------------------
--  REALTIME
-- ------------------------------------------------------------
-- Para que al admin le aparezca el pedido sin recargar, y al vendedor la
-- respuesta.
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table intercambios';
  exception when duplicate_object then
    null;
  end;
end $$;

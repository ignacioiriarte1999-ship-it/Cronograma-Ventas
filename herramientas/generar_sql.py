"""Genera el SQL de carga a partir de los datos extraídos del Excel."""
import json

datos = json.load(open('datos.json'))
esc = lambda s: s.replace("'", "''")
out = []

out.append("""-- ============================================================
--  CARGA DE LOS CRONOGRAMAS REALES (Excel Jul 2026 – Ene 2027)
-- ============================================================
-- Generado desde:
--   Cronogramas_ContacCenter_Jul-Dic2026.xlsx
--   Cronogramas_Laprida235_Jul-Dic2026 nuevo.xlsx
--
-- Reemplaza por completo los turnos y feriados de ambos puntos de venta.
-- Es idempotente: se puede volver a correr.
--
-- Requiere que supabase/schema.sql ya haya sembrado la tabla vendedores.

begin;
""")

for pv in ('cc', 'lp'):
    dias = datos[pv]['dias']
    feriados = datos[pv]['feriados']
    nombre = 'CONTAC-CENTER' if pv == 'cc' else 'LAPRIDA 235'

    filas = []
    for iso in sorted(dias):
        c = dias[iso]
        for turno in ('manana', 'tarde'):
            if c[turno]:
                filas.append(f"  ('{iso}','{turno}','{esc(c[turno])}')")

    out.append(f"-- ---------- {nombre} — {len(filas)} turnos ----------")
    out.append(f"delete from turnos   where punto_venta = '{pv}';")
    out.append(f"delete from feriados where punto_venta = '{pv}';")
    out.append('')

    ferfilas = [f"  ('{iso}','{esc(m)}')" for iso, m in sorted(feriados.items())]
    out.append(f"insert into feriados (punto_venta, fecha, motivo)")
    out.append(f"select '{pv}', f.fecha::date, f.motivo from (values")
    out.append(',\n'.join(ferfilas))
    out.append(") as f(fecha, motivo);")
    out.append('')

    out.append("insert into turnos (punto_venta, fecha, turno, vendedor_id)")
    out.append(f"select '{pv}', t.fecha::date, t.turno, v.id from (values")
    out.append(',\n'.join(filas))
    out.append(") as t(fecha, turno, nombre)")
    out.append(f"join vendedores v on v.punto_venta = '{pv}' and v.nombre = t.nombre;")
    out.append('')

out.append("""-- Verificación: debe dar 268 y 268.
select punto_venta, count(*) as turnos from turnos group by punto_venta order by 1;

commit;
""")

sql = '\n'.join(out)
open('/Users/ignacio/desarollo/supabase/datos-iniciales.sql', 'w').write(sql)
print(f'SQL generado: {len(sql):,} caracteres')
for pv in ('cc', 'lp'):
    n = sum(bool(c['manana']) + bool(c['tarde']) for c in datos[pv]['dias'].values())
    print(f'  {pv}: {n} turnos, {len(datos[pv]["feriados"])} feriados')

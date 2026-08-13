"""Contrasta los turnos reales del Excel contra las reglas del cronograma."""
import json, datetime
from collections import defaultdict

datos = json.load(open('datos.json'))
CC_V = ['Imbaud', 'Ortiz', 'De Santis']
LP_V = ['Arevalo', 'De la Rosa', 'Diaz', 'Erazo', 'Juarez', 'Orellana',
        'Quiroga', 'Rios', 'Santillan', 'Soria', 'Valdez', 'Varas']


def semanas(dias):
    """Agrupa por semana desde el lunes."""
    out, actual = [], None
    for iso in sorted(dias):
        d = datetime.date.fromisoformat(iso)
        if d.weekday() == 0:
            if actual:
                out.append(actual)
            actual = {'lunes': iso, 'dias': [iso]}
        elif actual:
            actual['dias'].append(iso)
    if actual:
        out.append(actual)
    return out


def stats(dias, sem, vends):
    st = {v: {'M': 0, 'T': 0, 'S': 0, 'total': 0} for v in vends}
    for iso in sem['dias']:
        c = dias.get(iso)
        if not c or c['holiday'] or c['closed']:
            continue
        sabado = datetime.date.fromisoformat(iso).weekday() == 5
        if c['manana'] and c['manana'] in st:
            st[c['manana']]['S' if sabado else 'M'] += 1
            st[c['manana']]['total'] += 1
        if c['tarde'] and c['tarde'] in st:
            st[c['tarde']]['T'] += 1
            st[c['tarde']]['total'] += 1
    return st


def con_feriado(dias, sem):
    return any(dias.get(i, {}).get('holiday') for i in sem['dias'])


print('=' * 72)
print('CONTAC-CENTER')
print('=' * 72)
d = datos['cc']['dias']
sems = semanas(d)
problemas = defaultdict(list)

for i, sem in enumerate(sems):
    et = f"sem {i+1} ({sem['lunes']})"
    st = stats(d, sem, CC_V)
    fer = con_feriado(d, sem)

    if not fer:
        if st['Imbaud']['total'] != 3:
            problemas['Imbaud ≠ 3 turnos'].append(f"{et}: {st['Imbaud']['total']}")
        if st['Imbaud']['T'] != 1:
            problemas['Imbaud ≠ 1 tarde'].append(f"{et}: {st['Imbaud']['T']}")
        if st['Imbaud']['M'] + st['Imbaud']['S'] != 2:
            problemas['Imbaud ≠ 2 mañanas'].append(f"{et}: {st['Imbaud']['M']}+{st['Imbaud']['S']}")
        for v in ('Ortiz', 'De Santis'):
            if st[v]['total'] != 4:
                problemas[f'{v} ≠ 4 turnos'].append(f"{et}: {st[v]['total']}")

    # Nadie cubre mañana y tarde el mismo día.
    for iso in sem['dias']:
        c = d.get(iso, {})
        if c.get('manana') and c.get('manana') == c.get('tarde'):
            problemas['mismo vendedor M y T el mismo día'].append(f'{iso}: {c["manana"]}')

    # Regla del cierre: quien cierra el sábado abre el lunes siguiente.
    sab = [x for x in sem['dias'] if datetime.date.fromisoformat(x).weekday() == 5]
    if sab and i + 1 < len(sems):
        cs = d.get(sab[0], {})
        if not cs.get('holiday') and cs.get('manana'):
            prox = sems[i + 1]
            primero = next((x for x in prox['dias']
                            if not d.get(x, {}).get('holiday') and not d.get(x, {}).get('closed')), None)
            if primero and d[primero].get('manana') and d[primero]['manana'] != cs['manana']:
                problemas['regla del cierre'].append(
                    f"{sab[0]} cierra {cs['manana']} pero {primero} abre {d[primero]['manana']}")

for k, v in problemas.items():
    print(f'  ⚠ {k}  ({len(v)})')
    for x in v[:6]:
        print(f'      {x}')
    if len(v) > 6:
        print(f'      … y {len(v)-6} más')
if not problemas:
    print('  ✓ sin desvíos')

tot = defaultdict(lambda: defaultdict(int))
for sem in sems:
    for v, s in stats(d, sem, CC_V).items():
        for k in ('M', 'T', 'S', 'total'):
            tot[v][k] += s[k]
print('\n  Totales del semestre:')
for v in CC_V:
    print(f"    {v:<11} {tot[v]['total']:>3} turnos   (M:{tot[v]['M']:>3} T:{tot[v]['T']:>3} Sáb:{tot[v]['S']:>2})")

print()
print('=' * 72)
print('LAPRIDA 235')
print('=' * 72)
d = datos['lp']['dias']
sems = semanas(d)
problemas = defaultdict(list)

for i, sem in enumerate(sems):
    et = f"sem {i+1} ({sem['lunes']})"
    cuenta = defaultdict(int)
    vacios = 0
    for iso in sem['dias']:
        c = d.get(iso)
        if not c or c['holiday'] or c['closed']:
            continue
        sabado = datetime.date.fromisoformat(iso).weekday() == 5
        for turno in (['manana'] if sabado else ['manana', 'tarde']):
            if c[turno]:
                cuenta[c[turno]] += 1
            else:
                vacios += 1
    if vacios:
        problemas['slots vacíos'].append(f'{et}: {vacios}')
    for v, n in cuenta.items():
        if n > 1:
            problemas['vendedor repetido en la semana'].append(f'{et}: {v} ×{n}')

for k, v in problemas.items():
    print(f'  ⚠ {k}  ({len(v)})')
    for x in v[:8]:
        print(f'      {x}')
    if len(v) > 8:
        print(f'      … y {len(v)-8} más')
if not problemas:
    print('  ✓ sin desvíos')

tot = defaultdict(lambda: defaultdict(int))
for sem in sems:
    for v, s in stats(d, sem, LP_V).items():
        for k in ('M', 'T', 'S', 'total'):
            tot[v][k] += s[k]
print('\n  Totales del semestre:')
for v in LP_V:
    print(f"    {v:<12} {tot[v]['total']:>3} turnos   (M:{tot[v]['M']:>3} T:{tot[v]['T']:>3} Sáb:{tot[v]['S']:>2})")

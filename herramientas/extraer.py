"""Extrae los turnos reales de los Excel y los contrasta con las reglas."""
import re, json, datetime, sys
from xlsx import Libro

ARCHIVOS = {
    'cc': '/Users/ignacio/Downloads/Cronogramas_ContacCenter_Jul-Dic2026.xlsx',
    'lp': '/Users/ignacio/Downloads/Cronogramas_Laprida235_Jul-Dic2026 nuevo.xlsx',
}
VENDS = {
    'cc': ['Imbaud', 'Ortiz', 'De Santis'],
    'lp': ['Arevalo', 'De la Rosa', 'Diaz', 'Erazo', 'Juarez', 'Orellana',
           'Quiroga', 'Rios', 'Santillan', 'Soria', 'Valdez', 'Varas'],
}
INICIO, FIN = datetime.date(2026, 7, 6), datetime.date(2027, 1, 3)

NOMBRE_HOJA = re.compile(r'^(\d{2})-(\d{2})\s*al\s*(\d{2})-(\d{2})$', re.I)
TITULO = re.compile(r'SEMANA DEL\s*(\d{2})/(\d{2})\s*AL\s*(\d{2})/(\d{2})/(\d{2,4})', re.I)
VACIO = {'—', '-', '', '–'}


def normalizar(nombre, vends):
    """Tolera acentos y mayúsculas: 'DÍAZ' y 'Diaz' son la misma persona."""
    limpio = (nombre.strip().lower()
              .replace('á', 'a').replace('é', 'e').replace('í', 'i')
              .replace('ó', 'o').replace('ú', 'u'))
    for v in vends:
        if v.lower() == limpio:
            return v
    return None


def leer(pv):
    libro = Libro(ARCHIVOS[pv])
    vends = VENDS[pv]
    dias, feriados, avisos = {}, {}, []

    for nombre_hoja, destino in libro.hojas:
        filas = [f for f in libro.filas(destino) if f]
        if not filas:
            continue
        m = TITULO.search(filas[0][0] if filas[0] else '')
        if m:
            d1, m1, d2, m2, anio = m.groups()
            anio = int(anio) + (2000 if len(anio) == 2 else 0)
            # Si el rango cruza el año nuevo, el lunes cae en el año anterior.
            anio_lunes = anio - 1 if int(m1) > int(m2) else anio
        else:
            # Alguna hoja quedó sin título; el nombre "13-07 al 18-07" alcanza.
            n = NOMBRE_HOJA.match(nombre_hoja)
            if not n:
                continue  # hoja de reglas/feriados
            d1, m1, d2, m2 = n.groups()
            # El cronograma va de julio 2026 a enero 2027.
            anio_lunes = 2026 if int(m1) >= 6 else 2027
            avisos.append(f'{nombre_hoja}: sin titulo en la planilla, fecha tomada del nombre de la hoja')

        lunes = datetime.date(anio_lunes, int(m1), int(d1))

        if lunes.weekday() != 0:
            avisos.append(f'{nombre_hoja}: el {lunes} no es lunes')
            continue

        vistos = 0
        for fila in filas[3:]:
            etiqueta = (fila[0] or '').strip().upper()
            if etiqueta not in ('L', 'M', 'MI', 'J', 'V', 'S', 'D'):
                continue
            fecha = lunes + datetime.timedelta(days=vistos)
            vistos += 1
            if vistos > 7:
                break

            man = (fila[1] if len(fila) > 1 else '').strip()
            tar = (fila[2] if len(fila) > 2 else '').strip()
            iso = fecha.isoformat()

            if man.upper().startswith('FERIADO'):
                feriados[iso] = man.split(':', 1)[1].strip() if ':' in man else 'Feriado'
                dias[iso] = {'manana': None, 'tarde': None, 'holiday': True, 'closed': False}
                continue
            if man.upper().startswith('CERRADO'):
                dias[iso] = {'manana': None, 'tarde': None, 'holiday': False, 'closed': True}
                continue

            celda = {'manana': None, 'tarde': None, 'holiday': False, 'closed': False}
            for clave, txt in (('manana', man), ('tarde', tar)):
                if txt in VACIO:
                    continue
                v = normalizar(txt, vends)
                if v:
                    celda[clave] = v
                else:
                    avisos.append(f'{iso} {clave}: nombre no reconocido "{txt}"')
            dias[iso] = celda

    return dias, feriados, avisos


def dentro(iso):
    return INICIO <= datetime.date.fromisoformat(iso) <= FIN


if __name__ == '__main__':
    salida = {}
    for pv in ('cc', 'lp'):
        dias, feriados, avisos = leer(pv)
        fuera = sorted(i for i in dias if not dentro(i))
        dentro_ = {i: c for i, c in dias.items() if dentro(i)}
        turnos = sum(bool(c['manana']) + bool(c['tarde']) for c in dentro_.values())

        print(f'--- {pv.upper()} ---')
        print(f'  dias leidos       : {len(dias)}  (dentro del periodo: {len(dentro_)})')
        print(f'  turnos asignados  : {turnos}')
        print(f'  feriados          : {len(feriados)}')
        print(f'  fuera de periodo  : {len(fuera)}' + (f'  {fuera[0]} .. {fuera[-1]}' if fuera else ''))
        print(f'  avisos            : {len(avisos)}')
        for a in avisos[:10]:
            print('     !', a)

        # Cobertura: ¿falta alguna fecha del período?
        faltan, d = [], INICIO
        while d <= FIN:
            if d.isoformat() not in dentro_:
                faltan.append(d.isoformat())
            d += datetime.timedelta(days=1)
        print(f'  fechas sin datos  : {len(faltan)}' + (f'  {faltan[:5]}' if faltan else ''))

        salida[pv] = {'dias': dentro_, 'feriados': feriados}

    with open('datos.json', 'w') as f:
        json.dump(salida, f, ensure_ascii=False)
    print('\n→ datos.json escrito')

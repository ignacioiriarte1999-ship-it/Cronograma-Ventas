"""Genera y verifica public/demo/index.html a partir del de producción.

El HTML de la demo es necesariamente otro archivo —vive en otra carpeta y
apunta a ../js/— pero no debe ser una copia que se desactualice. Este script lo
deriva del original, y en modo `verificar` avisa si quedaron desalineados.

  python3 herramientas/demo-html.py generar
  python3 herramientas/demo-html.py verificar
"""
import re
import sys

ORIGEN = 'public/index.html'
DESTINO = 'public/demo/index.html'

AVISO = ('<!-- GENERADO por herramientas/demo-html.py a partir de ../index.html.\n'
         '     No editar a mano: correr `python3 herramientas/demo-html.py generar`. -->\n')


def transformar(html):
    out = html
    out = out.replace('<title>Cronogramas — ContacCenter · Laprida 235</title>',
                      '<title>Cronogramas — demostración</title>')
    out = out.replace('href="css/styles.css"', href_demo := 'href="../css/styles.css"')
    out = out.replace('src="js/main.js"', 'src="../js/main.js"')
    # Sin la marca del cliente ni la ayuda con apellidos reales: main.js las
    # reemplaza al arrancar, pero así no parpadean antes de que corra.
    out = out.replace('<p class="sub">ContacCenter · Laprida 235</p>',
                      '<p class="sub">Gestión de turnos por sucursal</p>')
    out = re.sub(r'\n    <div class="login-hint">.*?</div>\n', '\n',
                 out, count=1, flags=re.S)
    return AVISO + out


def ids_y_acciones(html):
    return (
        sorted(set(re.findall(r'id="([\w-]+)"', html))),
        sorted(set(re.findall(r'data-accion="([\w-]+)"', html))),
    )


def main():
    modo = sys.argv[1] if len(sys.argv) > 1 else 'verificar'
    origen = open(ORIGEN, encoding='utf-8').read()
    esperado = transformar(origen)

    if modo == 'generar':
        open(DESTINO, 'w', encoding='utf-8').write(esperado)
        print(f'✓ {DESTINO} generado desde {ORIGEN}')
        return 0

    try:
        actual = open(DESTINO, encoding='utf-8').read()
    except FileNotFoundError:
        print(f'✗ falta {DESTINO} — corré: python3 {sys.argv[0]} generar')
        return 1

    if actual == esperado:
        print('✓ la demo está al día con index.html')
        return 0

    ie, ae = ids_y_acciones(esperado)
    ia, aa = ids_y_acciones(actual)
    print('✗ desalineados. Corré: python3 %s generar' % sys.argv[0])
    if set(ie) - set(ia): print('   ids que faltan en la demo:', sorted(set(ie) - set(ia)))
    if set(ae) - set(aa): print('   acciones que faltan en la demo:', sorted(set(ae) - set(aa)))
    return 1


if __name__ == '__main__':
    sys.exit(main())

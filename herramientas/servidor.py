"""Servidor de desarrollo sin caché.

python3 -m http.server deja que el navegador cachee los módulos, y con ES
modules eso se vuelve una trampa: se edita un archivo, se recarga y sigue
corriendo el anterior. Estas cabeceras fuerzan a revalidar siempre.

Uso: python3 herramientas/servidor.py [puerto] [directorio]
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class SinCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def log_message(self, formato, *args):
        if '304' not in formato % args:
            super().log_message(formato, *args)


if __name__ == '__main__':
    puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    raiz = sys.argv[2] if len(sys.argv) > 2 else 'public'
    manejador = partial(SinCache, directory=raiz)
    print(f'Sirviendo {raiz}/ en http://localhost:{puerto} (sin caché)')
    ThreadingHTTPServer(('127.0.0.1', puerto), manejador).serve_forever()

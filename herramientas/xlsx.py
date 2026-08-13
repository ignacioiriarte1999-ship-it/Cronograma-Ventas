"""Lector mínimo de xlsx con la biblioteca estándar (no hay openpyxl)."""
import zipfile, re, datetime
import xml.etree.ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
NSR = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
PKG = '{http://schemas.openxmlformats.org/package/2006/relationships}'

# Formatos numéricos incorporados que representan fechas.
FECHAS_BUILTIN = set(range(14, 23)) | set(range(45, 48)) | {27, 30, 36, 50, 57}


def _texto(nodo):
    return ''.join(t.text or '' for t in nodo.iter(NS + 't'))


def col_num(ref):
    letras = re.match(r'([A-Z]+)', ref).group(1)
    n = 0
    for c in letras:
        n = n * 26 + (ord(c) - 64)
    return n


def serial_a_fecha(n):
    # Epoch 1900 con el bug del año bisiesto que arrastra Excel.
    return datetime.date(1899, 12, 30) + datetime.timedelta(days=int(n))


class Libro:
    def __init__(self, path):
        self.z = zipfile.ZipFile(path)
        self.compartidas = self._shared()
        self.estilos_fecha = self._estilos()
        self.hojas = self._hojas()

    def _shared(self):
        if 'xl/sharedStrings.xml' not in self.z.namelist():
            return []
        raiz = ET.fromstring(self.z.read('xl/sharedStrings.xml'))
        return [_texto(si) for si in raiz.findall(NS + 'si')]

    def _estilos(self):
        """Índices de xf cuyo formato numérico es una fecha."""
        if 'xl/styles.xml' not in self.z.namelist():
            return set()
        raiz = ET.fromstring(self.z.read('xl/styles.xml'))
        propios = {}
        for nf in raiz.iter(NS + 'numFmt'):
            propios[int(nf.get('numFmtId'))] = nf.get('formatCode', '')
        fechas = set()
        cellxfs = raiz.find(NS + 'cellXfs')
        if cellxfs is None:
            return fechas
        for i, xf in enumerate(cellxfs.findall(NS + 'xf')):
            fid = int(xf.get('numFmtId', 0))
            code = propios.get(fid, '')
            if fid in FECHAS_BUILTIN or re.search(r'[dmyDMY]', re.sub(r'\[[^\]]*\]|"[^"]*"', '', code)):
                fechas.add(i)
        return fechas

    def _hojas(self):
        rels = {}
        raiz = ET.fromstring(self.z.read('xl/_rels/workbook.xml.rels'))
        for r in raiz.findall(PKG + 'Relationship'):
            rels[r.get('Id')] = r.get('Target').lstrip('/')
        salida = []
        wb = ET.fromstring(self.z.read('xl/workbook.xml'))
        for s in wb.iter(NS + 'sheet'):
            destino = rels[s.get(NSR + 'id')]
            if not destino.startswith('xl/'):
                destino = 'xl/' + destino
            salida.append((s.get('name'), destino))
        return salida

    def filas(self, destino):
        """Devuelve [[celda, ...], ...] respetando columnas vacías."""
        raiz = ET.fromstring(self.z.read(destino))
        out = []
        for fila in raiz.iter(NS + 'row'):
            celdas = {}
            for c in fila.findall(NS + 'c'):
                ref = c.get('r')
                tipo = c.get('t')
                estilo = int(c.get('s', -1))
                v = c.find(NS + 'v')
                is_ = c.find(NS + 'is')
                if tipo == 's' and v is not None:
                    val = self.compartidas[int(v.text)]
                elif tipo == 'inlineStr' and is_ is not None:
                    val = _texto(is_)
                elif v is not None:
                    val = v.text
                    if estilo in self.estilos_fecha:
                        try:
                            val = serial_a_fecha(float(val)).isoformat()
                        except (ValueError, OverflowError):
                            pass
                else:
                    val = ''
                celdas[col_num(ref)] = (val or '').strip()
            if celdas:
                ancho = max(celdas)
                out.append([celdas.get(i + 1, '') for i in range(ancho)])
            else:
                out.append([])
        return out

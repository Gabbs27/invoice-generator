// Solo para pruebas: arma zips y libros .xlsx pequeños con datos inventados, como los guarda
// Excel: deflate, data descriptor y nombres en UTF-8.
import { crc32, deflateRawSync } from 'node:zlib';

export function armarZip(partes: Record<string, string>, { comprimir = true } = {}): Buffer {
  const locales: Buffer[] = [];
  const central: Buffer[] = [];
  let desplazamiento = 0;
  for (const [nombre, texto] of Object.entries(partes)) {
    const contenido = Buffer.from(texto, 'utf8');
    const datos = comprimir ? deflateRawSync(contenido) : contenido;
    const nombreEnBytes = Buffer.from(nombre, 'utf8');
    const crc = crc32(contenido);
    const metodo = comprimir ? 8 : 0;

    // Bandera 0x0808: data descriptor (bit 3), así que la cabecera local va sin CRC ni tamaños, y
    // nombre en UTF-8 (bit 11).
    const cabecera = Buffer.alloc(30);
    cabecera.writeUInt32LE(0x04034b50, 0);
    cabecera.writeUInt16LE(20, 4);
    cabecera.writeUInt16LE(0x0808, 6);
    cabecera.writeUInt16LE(metodo, 8);
    cabecera.writeUInt16LE(nombreEnBytes.length, 26);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(datos.length, 8);
    descriptor.writeUInt32LE(contenido.length, 12);
    locales.push(cabecera, nombreEnBytes, datos, descriptor);

    const entrada = Buffer.alloc(46);
    entrada.writeUInt32LE(0x02014b50, 0);
    entrada.writeUInt16LE(20, 4);
    entrada.writeUInt16LE(20, 6);
    entrada.writeUInt16LE(0x0808, 8);
    entrada.writeUInt16LE(metodo, 10);
    entrada.writeUInt32LE(crc, 16);
    entrada.writeUInt32LE(datos.length, 20);
    entrada.writeUInt32LE(contenido.length, 24);
    entrada.writeUInt16LE(nombreEnBytes.length, 28);
    entrada.writeUInt32LE(desplazamiento, 42);
    central.push(entrada, nombreEnBytes);
    desplazamiento += cabecera.length + nombreEnBytes.length + datos.length + descriptor.length;
  }
  const directorio = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(Object.keys(partes).length, 8);
  fin.writeUInt16LE(Object.keys(partes).length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...locales, directorio, fin]);
}

export type CeldaDePrueba =
  | string // texto compartido
  | number
  | null // celda vacía
  | { numero: string } // el número tal como va en el XML, como '1.30000001E8'
  | { formula: string; valor: string }
  | { enLinea: string };

export interface HojaDePrueba {
  nombre: string;
  // La celda de la primera fila y la primera columna, como 'E8' en el libro real. Sin ella, 'A1'.
  desde?: string;
  filas: CeldaDePrueba[][];
}

const DECLARACION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const PRINCIPAL = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELACIONES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PAQUETE = 'http://schemas.openxmlformats.org/package/2006/relationships';

const escapar = (texto: string) =>
  texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const columnaDe = (letras: string) =>
  [...letras].reduce((numero, letra) => numero * 26 + letra.charCodeAt(0) - 64, 0) - 1;

function letrasDe(columna: number): string {
  let letras = '';
  for (let n = columna + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letras = String.fromCharCode(65 + ((n - 1) % 26)) + letras;
  }
  return letras;
}

export function armarLibro(
  hojas: HojaDePrueba[],
  { fechas1904 = false, rutasAbsolutas = false, prefijo = '' } = {}
): Buffer {
  // Con prefijo, los elementos van como x:row, como los escriben algunos programas.
  const e = (nombre: string) => (prefijo === '' ? nombre : `${prefijo}:${nombre}`);
  const espacio = prefijo === '' ? `xmlns="${PRINCIPAL}"` : `xmlns:${prefijo}="${PRINCIPAL}"`;
  const compartidos: string[] = [];
  const compartido = (texto: string) => {
    const posicion = compartidos.indexOf(texto);
    return posicion >= 0 ? posicion : compartidos.push(texto) - 1;
  };

  const celdaXML = (celda: CeldaDePrueba, referencia: string): string => {
    if (celda === null) return '';
    const v = (valor: string | number) => `<${e('v')}>${valor}</${e('v')}>`;
    if (typeof celda === 'string') {
      return `<${e('c')} r="${referencia}" t="s">${v(compartido(celda))}</${e('c')}>`;
    }
    if (typeof celda === 'number') return `<${e('c')} r="${referencia}">${v(celda)}</${e('c')}>`;
    if ('numero' in celda) return `<${e('c')} r="${referencia}">${v(celda.numero)}</${e('c')}>`;
    if ('formula' in celda) {
      const formula = `<${e('f')}>${escapar(celda.formula)}</${e('f')}>`;
      return `<${e('c')} r="${referencia}">${formula}${v(celda.valor)}</${e('c')}>`;
    }
    const enLinea = `<${e('is')}><${e('t')}>${escapar(celda.enLinea)}</${e('t')}></${e('is')}>`;
    return `<${e('c')} r="${referencia}" t="inlineStr">${enLinea}</${e('c')}>`;
  };

  const partes: Record<string, string> = {};
  hojas.forEach((hoja, i) => {
    const [, letras, primera] = (hoja.desde ?? 'A1').match(/^([A-Z]+)(\d+)$/) ?? ['', 'A', '1'];
    const filas = hoja.filas.map((celdas, f) => {
      const numero = Number(primera) + f;
      const xml = celdas.map((celda, c) =>
        celdaXML(celda, `${letrasDe(columnaDe(letras) + c)}${numero}`)
      );
      return `<${e('row')} r="${numero}">${xml.join('')}</${e('row')}>`;
    });
    partes[`xl/worksheets/sheet${i + 1}.xml`] =
      `${DECLARACION}<${e('worksheet')} ${espacio}><${e('sheetData')}>${filas.join('')}` +
      `</${e('sheetData')}></${e('worksheet')}>`;
  });

  const destino = (ruta: string) => (rutasAbsolutas ? `/xl/${ruta}` : ruta);
  const relaciones = hojas.map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="${RELACIONES}/worksheet" ` +
      `Target="${destino(`worksheets/sheet${i + 1}.xml`)}"/>`
  );
  relaciones.push(
    `<Relationship Id="rId${hojas.length + 1}" Type="${RELACIONES}/sharedStrings" ` +
      `Target="${destino('sharedStrings.xml')}"/>`
  );
  const hojasXML = hojas
    .map(
      (hoja, i) =>
        `<${e('sheet')} name="${escapar(hoja.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    )
    .join('');
  const preferencias = fechas1904 ? `<${e('workbookPr')} date1904="1"/>` : '';
  partes['xl/workbook.xml'] =
    `${DECLARACION}<${e('workbook')} ${espacio} xmlns:r="${RELACIONES}">${preferencias}` +
    `<${e('sheets')}>${hojasXML}</${e('sheets')}></${e('workbook')}>`;
  partes['xl/_rels/workbook.xml.rels'] =
    `${DECLARACION}<Relationships xmlns="${PAQUETE}">${relaciones.join('')}</Relationships>`;

  // Al final: los índices del texto compartido salen de armar las hojas.
  const textos = compartidos
    .map((texto) => {
      const t = `<${e('t')} xml:space="preserve">${escapar(texto)}</${e('t')}>`;
      return `<${e('si')}>${t}</${e('si')}>`;
    })
    .join('');
  partes['xl/sharedStrings.xml'] =
    `${DECLARACION}<${e('sst')} ${espacio} count="${compartidos.length}" ` +
    `uniqueCount="${compartidos.length}">${textos}</${e('sst')}>`;
  return armarZip(partes);
}

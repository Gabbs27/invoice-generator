import { DOMParser } from '@xmldom/xmldom';
import { posix } from 'node:path';
import { abrirZip } from './zip';

// Un libro .xlsx (Office Open XML): xl/workbook.xml nombra las hojas, sus relaciones dicen dónde
// está cada una, y el texto de las celdas suele estar en xl/sharedStrings.xml. Se leen los valores
// guardados: de una fórmula, el último resultado que calculó la hoja de cálculo.

export type Celda = { tipo: 'texto'; valor: string } | { tipo: 'numero'; valor: string };

export interface Fila {
  numero: number;
  // Por columna: la A es 0. Una celda vacía no está.
  celdas: (Celda | undefined)[];
}

export interface Hoja {
  nombre: string;
  filas: Fila[];
}

export interface Libro {
  // Excel cuenta las fechas desde 1900, o desde 1904 si el libro lo pide.
  fechas1904: boolean;
  hojas: Hoja[];
}

const NO_ES_UN_LIBRO =
  'El archivo no es un libro .xlsx. Si es un .xls, ábrelo en Excel y guárdalo como .xlsx.';

const fallar = (mensaje: string) => {
  throw new Error(mensaje);
};

function leerXML(leer: (nombre: string) => Buffer | undefined, ruta: string): Document | undefined {
  const contenido = leer(ruta);
  if (contenido === undefined) return undefined;
  const danado = `El libro está dañado: ${ruta} no es un XML válido.`;
  let documento: Document;
  try {
    documento = new DOMParser({
      errorHandler: { warning: () => undefined, error: fallar, fatalError: fallar },
    }).parseFromString(contenido.toString('utf8'), 'text/xml');
  } catch (error) {
    throw new Error(danado, { cause: error });
  }
  if (!documento.documentElement) throw new Error(danado);
  return documento;
}

// Por nombre local: hay programas que escriben los elementos con prefijo (x:row) y otros sin él.
const elementos = (padre: Document | Element, nombre: string): Element[] =>
  Array.from(padre.getElementsByTagNameNS('*', nombre));

// El texto de un <si> o de un <is>: sus <t>, menos los de la guía fonética (<rPh>).
const textoDe = (elemento: Element): string =>
  elementos(elemento, 't')
    .filter((t) => (t.parentNode as Element | null)?.localName !== 'rPh')
    .map((t) => t.textContent ?? '')
    .join('');

// r:id, en el espacio de nombres de las relaciones de Office (con cualquier prefijo).
function idDeRelacion(hoja: Element): string {
  for (let i = 0; i < hoja.attributes.length; i++) {
    const atributo = hoja.attributes.item(i);
    if (atributo?.localName === 'id' && atributo.namespaceURI?.endsWith('relationships')) {
      return atributo.value;
    }
  }
  return '';
}

function columnaDe(referencia: string): number | undefined {
  const letras = referencia.match(/^[A-Z]+/)?.[0];
  if (letras === undefined) return undefined;
  return [...letras].reduce((numero, letra) => numero * 26 + letra.charCodeAt(0) - 64, 0) - 1;
}

function leerCelda(celda: Element, compartidos: string[]): Celda | undefined {
  const tipo = celda.getAttribute('t') || 'n';
  if (tipo === 'inlineStr') {
    const enLinea = elementos(celda, 'is')[0];
    return enLinea === undefined ? undefined : { tipo: 'texto', valor: textoDe(enLinea) };
  }
  const v = elementos(celda, 'v')[0];
  if (v === undefined) return undefined;
  const valor = v.textContent ?? '';
  if (tipo === 's') {
    const texto = compartidos[Number(valor)];
    if (texto === undefined) {
      throw new Error('El libro está dañado: una celda apunta a un texto que no existe.');
    }
    return { tipo: 'texto', valor: texto };
  }
  // n es un número; str, el texto de una fórmula; b, verdadero o falso; e, un error como #N/A.
  return tipo === 'n' ? { tipo: 'numero', valor } : { tipo: 'texto', valor };
}

function leerHoja(documento: Document | undefined, compartidos: string[]): Fila[] {
  if (documento === undefined) return [];
  const filas: Fila[] = [];
  let numero = 0;
  for (const fila of elementos(documento, 'row')) {
    // r es opcional: sin él, la fila sigue a la anterior, y la celda a la anterior.
    numero = Number(fila.getAttribute('r')) || numero + 1;
    const celdas: (Celda | undefined)[] = [];
    let columna = -1;
    for (const celda of elementos(fila, 'c')) {
      columna = columnaDe(celda.getAttribute('r') ?? '') ?? columna + 1;
      const valor = leerCelda(celda, compartidos);
      if (valor !== undefined) celdas[columna] = valor;
    }
    if (celdas.length > 0) filas.push({ numero, celdas });
  }
  return filas;
}

export function leerLibro(bytes: Uint8Array): Libro {
  const leer = abrirZip(bytes);
  const libro = leerXML(leer, 'xl/workbook.xml');
  const relaciones = leerXML(leer, 'xl/_rels/workbook.xml.rels');
  if (libro === undefined || relaciones === undefined) throw new Error(NO_ES_UN_LIBRO);

  // Los destinos son relativos a xl/, o absolutos desde la raíz del paquete.
  const destinos = new Map<string, { tipo: string; ruta: string }>();
  for (const relacion of elementos(relaciones, 'Relationship')) {
    const destino = relacion.getAttribute('Target') ?? '';
    destinos.set(relacion.getAttribute('Id') ?? '', {
      tipo: (relacion.getAttribute('Type') ?? '').split('/').pop() ?? '',
      ruta: destino.startsWith('/') ? destino.slice(1) : posix.normalize(posix.join('xl', destino)),
    });
  }
  const deCompartidos = [...destinos.values()].find(({ tipo }) => tipo === 'sharedStrings');
  const documentoDeCompartidos = deCompartidos && leerXML(leer, deCompartidos.ruta);
  const compartidos =
    documentoDeCompartidos === undefined ? [] : elementos(documentoDeCompartidos, 'si').map(textoDe);

  const fechas1904 = elementos(libro, 'workbookPr')[0]?.getAttribute('date1904') ?? '';
  return {
    fechas1904: fechas1904 === '1' || fechas1904 === 'true',
    hojas: elementos(libro, 'sheet').map((hoja) => {
      const destino = destinos.get(idDeRelacion(hoja));
      return {
        nombre: hoja.getAttribute('name') ?? '',
        // Una hoja de gráfico no tiene celdas.
        filas:
          destino?.tipo === 'worksheet' ? leerHoja(leerXML(leer, destino.ruta), compartidos) : [],
      };
    }),
  };
}

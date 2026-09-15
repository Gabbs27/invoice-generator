# Importar el libro de gastos al 606 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** In local mode, read the purchases workbook (.xlsx), show the month's rows as purchases to
review, and save the chosen ones, so the workbook becomes the source of the 606.

**Architecture:**
- **Reading:** `lib/compras/zip.ts` and `lib/compras/xlsx.ts` open the workbook on the server with
  Node's zlib and `@xmldom/xmldom`. No new dependencies.
- **Rows to purchases:** `lib/compras/desdeExcel.ts` is pure, so both sides use it.
  - On the server it turns sheets into rows, with their defaults and what needs review.
  - On the page it turns a row plus the user's choices into a `Compra` checked by `validarCompra`,
    so the preview updates without calling the server.
- **Actions:** `leerLibroDeGastos` and `guardarComprasDelLibro` in `app/compras/acciones.ts`, only in
  local mode.
- **Page:** `app/compras/importarLibro.tsx`, in section A of `/compras`.
- **Design:** `docs/plans/2026-09-14-excel-606-design.md`, with the decisions below.

**Tech Stack:**
- Next.js 16 (App Router, Server Actions), React 19, Vitest 5.
- TypeScript with target ES2017: write `BigInt(0)`, never `0n`.
- `node:zlib` (`inflateRawSync`, `crc32`) and `@xmldom/xmldom` 0.8.

---

## Decisions made after the design

On 2026-09-14 the reference workbook was compared with the 606 files DGII accepted, printing only
counts. Gabriel then chose:
- **The purchases table ends at a repeated header.** Every sheet has a second block below the
  totals, with the same header. The totals formulas only add up the first table, and the one row
  below it that could be compared is in no accepted 606. Rows after a repeated header aren't read.
- **A checkbox per row.** In 5 of 7 months, 2 to 5 rows of the workbook never reached the 606. Every
  ready row has a checked "Anotar" box, and only checked rows are saved.
- **The propina stays out of the invoiced amount:** amount = Monto total − ITBS − 10% ley, and the
  propina goes in its own field, as NG 07-2018 says (Anexo A, fields 8 to 10).
- **A check digit that doesn't match is flagged.** A 9-digit RNC or an 11-digit cédula whose check
  digit fails, and that isn't a cédula that lost its zeros, stays in "Revisa el RNC" until the user
  keeps the number.

The comparison also confirmed what the design assumes. In every accepted line, the type is 09, the
amount is services, the payment date is the invoice date and the ITBIS is the ITBS column. A
supplier keeps its type, class and payment method from month to month.

What the workbook looks like, which the fixtures copy:
- RNCs are numbers, written in exponent notation (`1.30000001E8`).
- Dates are serial numbers and amounts are plain numbers. Only the totals row has formulas.
- The header is on row 8, and columns move between sheets.
- Some rows below the purchases only have a payment method, or a number in another column.

## Before you start

- **Workspace:** `~/.config/superpowers/worktrees/invoice-generator/excel-606`, branch `excel-606`.
  - Use Node 22: `source ~/.nvm/nvm.sh && nvm use 22`.
  - Baseline: `npm test`, 28 files and 339 tests. The branch sits on `master` after PRs #9 and
    #10; #10 moved `SIN_RESPUESTA` to `app/partes.tsx`, where Task 10 imports it from.
- **Privacy:** the real workbook is `~/Downloads/DGII Gastos 2026.xlsx`.
  - Never copy its RNCs, NCFs, amounts, dates or names into tests, docs, commits or messages.
  - Tests build fictitious workbooks with `lib/compras/libroDePrueba.ts`.
  - Task 11 reads the real one with a script that prints only counts.
- **Conventions:** as in `docs/plans/2026-09-13-dgii-606-implementation.md`.
  - Identifiers, comments, test names and messages are in Spanish. Commit messages are in English,
    with no co-author.
  - Money is counted in BigInt cents with half-up rounding. Comments say why.
- **Commands:** one file, `npx vitest run <path>`; everything, `npm test`; types,
  `npx next typegen && npx tsc --noEmit`; lint, `npm run lint`.
- **Made-up numbers,** checked with DGII's check digit:

| Number | What it is |
|---|---|
| `130000001`, `100000004` | valid RNCs |
| `140000001` | a valid RNC that is also a valid cédula with `00` in front: it stays an RNC |
| `100000009` | not a valid RNC; `00100000009` is a valid cédula |
| `1000000008` | 10 digits; `01000000008` is a valid cédula |
| `100000000` | not a valid RNC, and not a cédula with zeros either |
| `40200000004` | a valid cédula |
| `40200000005` | a cédula with a wrong check digit |

---

### Task 1: Dígito verificador

**Files:**
- Create: `lib/compras/digitoVerificador.ts`
- Test: `lib/compras/digitoVerificador.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { esCedulaValida, esRNCValido, revisarRNC } from './digitoVerificador';

// Números inventados. El dígito verificador es el de las macros de la herramienta 606 de la DGII.
describe('dígito verificador', () => {
  it('reconoce un RNC con su dígito verificador', () => {
    expect(esRNCValido('130000001')).toBe(true);
    expect(esRNCValido('100000004')).toBe(true);
    for (const valor of ['130000002', '100000009', '13000000', '1300000011', '13000000A']) {
      expect(esRNCValido(valor)).toBe(false);
    }
  });

  it('reconoce una cédula con su dígito verificador', () => {
    for (const valor of ['00100000009', '01000000008', '40200000004']) {
      expect(esCedulaValida(valor)).toBe(true);
    }
    for (const valor of ['40200000005', '0010000000', '001000000090']) {
      expect(esCedulaValida(valor)).toBe(false);
    }
  });

  it('deja pasar un RNC o una cédula válidos', () => {
    expect(revisarRNC('130000001')).toEqual({ estado: 'valido' });
    expect(revisarRNC('40200000004')).toEqual({ estado: 'valido' });
  });

  // Excel guarda el número sin los ceros de la izquierda: una cédula que empieza con 00 llega con 9
  // dígitos, y una que empieza con un solo 0, con 10.
  it('propone la cédula de un número que perdió los ceros', () => {
    expect(revisarRNC('100000009')).toEqual({ estado: 'cedula', cedula: '00100000009' });
    expect(revisarRNC('1000000008')).toEqual({ estado: 'cedula', cedula: '01000000008' });
  });

  it('no toca un RNC válido aunque con ceros también sea una cédula válida', () => {
    expect(revisarRNC('140000001')).toEqual({ estado: 'valido' });
  });

  it('marca como dudoso un RNC o una cédula con el dígito verificador mal', () => {
    expect(revisarRNC('100000000')).toEqual({ estado: 'dudoso' });
    expect(revisarRNC('40200000005')).toEqual({ estado: 'dudoso' });
  });

  // El largo lo revisa validarCompra, con su propio mensaje.
  it('no opina de lo que no es un RNC, una cédula ni una cédula sin ceros', () => {
    for (const valor of ['', '12345678', '123456789012', '1000000009', 'RNC']) {
      expect(revisarRNC(valor)).toEqual({ estado: 'otro' });
    }
  });
});
```

**Step 2: Run it to see it fail**

Run: `npx vitest run lib/compras/digitoVerificador.test.ts`
Expected: FAIL with `Failed to resolve import "./digitoVerificador"`.

**Step 3: Write the implementation**

```ts
// El dígito verificador del RNC y de la cédula, como lo calcula la herramienta 606 de la DGII en
// sus macros (GenDV_Para_Republica_Dominicana).

const PESOS_DEL_RNC = [7, 9, 8, 6, 5, 4, 3, 2];

// Los 8 primeros dígitos por sus pesos: del resto de la suma entre 11 sale el noveno.
export function esRNCValido(valor: string): boolean {
  if (!/^\d{9}$/.test(valor)) return false;
  const suma = PESOS_DEL_RNC.reduce((total, peso, i) => total + peso * Number(valor[i]), 0);
  const resto = suma % 11;
  const digito = resto === 0 ? 2 : resto === 1 ? 1 : 11 - resto;
  return digito === Number(valor[8]);
}

// Los 10 primeros dígitos, alternando por 1 y por 2, sumando las cifras de cada producto. El último
// es lo que le falta a la suma para la decena siguiente.
export function esCedulaValida(valor: string): boolean {
  if (!/^\d{11}$/.test(valor)) return false;
  let suma = 0;
  for (let i = 0; i < 10; i++) {
    const producto = Number(valor[i]) * (i % 2 === 0 ? 1 : 2);
    suma += Math.floor(producto / 10) + (producto % 10);
  }
  return (10 - (suma % 10)) % 10 === Number(valor[10]);
}

export type RevisionDelRNC =
  | { estado: 'valido' }
  | { estado: 'cedula'; cedula: string }
  | { estado: 'dudoso' }
  | { estado: 'otro' };

// Un RNC o una cédula que llegan de Excel como número pierden los ceros de la izquierda. Si lo que
// queda no es un RNC válido y con los ceros es una cédula válida, se propone la cédula. Si el
// dígito verificador no cuadra y no hay cédula que proponer, el número es dudoso.
export function revisarRNC(digitos: string): RevisionDelRNC {
  if (!/^\d{9,11}$/.test(digitos)) return { estado: 'otro' };
  if (digitos.length === 11) {
    return esCedulaValida(digitos) ? { estado: 'valido' } : { estado: 'dudoso' };
  }
  if (digitos.length === 9 && esRNCValido(digitos)) return { estado: 'valido' };
  const cedula = digitos.padStart(11, '0');
  if (esCedulaValida(cedula)) return { estado: 'cedula', cedula };
  return digitos.length === 9 ? { estado: 'dudoso' } : { estado: 'otro' };
}
```

**Step 4: Run it to see it pass**

Run: `npx vitest run lib/compras/digitoVerificador.test.ts`
Expected: PASS, 7 tests.

**Step 5: Commit**

```bash
git add lib/compras/digitoVerificador.ts lib/compras/digitoVerificador.test.ts
git commit -m "feat(compras): DGII check digit for RNC and cédula"
```

---

### Task 2: Leer un zip

**Files:**
- Create: `lib/compras/libroDePrueba.ts`
- Create: `lib/compras/zip.ts`
- Test: `lib/compras/zip.test.ts`

**Step 1: Write the test helper**

The tests need zips shaped like the reference workbook's: deflate, a data descriptor on every entry
(general-purpose flag `0x0808`) and no zip64.

`lib/compras/libroDePrueba.ts`:

```ts
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
```

**Step 2: Write the failing test**

`lib/compras/zip.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { armarZip } from './libroDePrueba';
import { abrirZip, TAMANO_MAXIMO_DESCOMPRIMIDO } from './zip';

// El registro del final del zip mide 22 bytes; en el byte 10 dice cuántas entradas hay y en el 16
// dónde empieza el directorio central.
const finDelZip = (zip: Buffer) => zip.length - 22;

describe('leer un zip', () => {
  // Excel guarda con deflate y data descriptor: la cabecera local trae los tamaños en cero.
  it('lee partes con deflate y data descriptor', () => {
    const leer = abrirZip(armarZip({ 'xl/workbook.xml': '<workbook/>', 'a.txt': 'ñandú' }));
    expect(leer('xl/workbook.xml')?.toString('utf8')).toBe('<workbook/>');
    expect(leer('a.txt')?.toString('utf8')).toBe('ñandú');
    expect(leer('no-esta.xml')).toBeUndefined();
  });

  it('lee partes guardadas sin comprimir', () => {
    const leer = abrirZip(armarZip({ 'a.txt': 'hola' }, { comprimir: false }));
    expect(leer('a.txt')?.toString('utf8')).toBe('hola');
  });

  it('rechaza lo que no es un zip', () => {
    expect(() => abrirZip(Buffer.from('no soy un libro'))).toThrow(/no es un libro .xlsx/);
    expect(() => abrirZip(new Uint8Array(0))).toThrow(/no es un libro .xlsx/);
  });

  it('rechaza una parte dañada', () => {
    const zip = armarZip({ 'a.txt': 'hola, hola, hola' }, { comprimir: false });
    // Sin comprimir, el contenido empieza tras la cabecera local (30 bytes) y el nombre.
    zip[30 + 'a.txt'.length] ^= 0xff;
    expect(() => abrirZip(zip)('a.txt')).toThrow(/dañado/);
  });

  // El tamaño sin comprimir del directorio central se revisa antes de descomprimir.
  it('no descomprime una parte de más de 50 MB', () => {
    const zip = armarZip({ 'a.txt': 'hola' });
    const directorio = zip.readUInt32LE(finDelZip(zip) + 16);
    zip.writeUInt32LE(TAMANO_MAXIMO_DESCOMPRIMIDO + 1, directorio + 24);
    expect(() => abrirZip(zip)('a.txt')).toThrow(/demasiado grande/);
  });

  it('no lee zip64', () => {
    const zip = armarZip({ 'a.txt': 'hola' });
    zip.writeUInt16LE(0xffff, finDelZip(zip) + 10);
    expect(() => abrirZip(zip)).toThrow(/zip64/);
  });
});
```

**Step 3: Run it to see it fail**

Run: `npx vitest run lib/compras/zip.test.ts`
Expected: FAIL with `Failed to resolve import "./zip"`.

**Step 4: Write the implementation**

`lib/compras/zip.ts`:

```ts
import { crc32, inflateRawSync } from 'node:zlib';

// Un .xlsx es un zip. Aquí se lee lo que guardan Excel y las demás hojas de cálculo: partes sin
// comprimir o con deflate, sin cifrar y sin zip64. El tamaño y el lugar de cada parte salen del
// directorio central, porque con data descriptor la cabecera local los trae en cero.

const FIN_DEL_DIRECTORIO = 0x06054b50;
const ENTRADA_DEL_DIRECTORIO = 0x02014b50;
const CABECERA_LOCAL = 0x04034b50;

// Un libro de 1 MB podría descomprimirse en mucho más: ninguna parte pasa de 50 MB.
export const TAMANO_MAXIMO_DESCOMPRIMIDO = 50_000_000;

const NO_ES_UN_LIBRO =
  'El archivo no es un libro .xlsx. Si es un .xls, ábrelo en Excel y guárdalo como .xlsx.';
const DANADO = 'El libro está dañado: ábrelo en Excel, guárdalo otra vez y vuelve a subirlo.';

interface Entrada {
  metodo: number;
  crc: number;
  comprimido: number;
  tamano: number;
  desplazamiento: number;
}

function buscarFinDelDirectorio(datos: Buffer): number {
  // El registro mide 22 bytes, más un comentario de hasta 65 535.
  const hasta = Math.max(0, datos.length - 22 - 0xffff);
  for (let i = datos.length - 22; i >= hasta; i--) {
    if (datos.readUInt32LE(i) === FIN_DEL_DIRECTORIO) return i;
  }
  throw new Error(NO_ES_UN_LIBRO);
}

// Devuelve cómo leer cada parte por su nombre, sin descomprimir las que no se piden.
export function abrirZip(bytes: Uint8Array): (nombre: string) => Buffer | undefined {
  const datos = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fin = buscarFinDelDirectorio(datos);
  const cuantas = datos.readUInt16LE(fin + 10);
  const inicio = datos.readUInt32LE(fin + 16);
  if (cuantas === 0xffff || inicio === 0xffffffff) {
    throw new Error('El libro usa zip64, que no se lee: guárdalo otra vez desde Excel.');
  }

  const entradas = new Map<string, Entrada>();
  let posicion = inicio;
  for (let i = 0; i < cuantas; i++) {
    if (posicion + 46 > datos.length || datos.readUInt32LE(posicion) !== ENTRADA_DEL_DIRECTORIO) {
      throw new Error(DANADO);
    }
    const largoDelNombre = datos.readUInt16LE(posicion + 28);
    const nombre = datos.toString('utf8', posicion + 46, posicion + 46 + largoDelNombre);
    entradas.set(nombre, {
      metodo: datos.readUInt16LE(posicion + 10),
      crc: datos.readUInt32LE(posicion + 16),
      comprimido: datos.readUInt32LE(posicion + 20),
      tamano: datos.readUInt32LE(posicion + 24),
      desplazamiento: datos.readUInt32LE(posicion + 42),
    });
    const extras = datos.readUInt16LE(posicion + 30) + datos.readUInt16LE(posicion + 32);
    posicion += 46 + largoDelNombre + extras;
  }

  return (nombre) => {
    const entrada = entradas.get(nombre);
    if (entrada === undefined) return undefined;
    if (entrada.tamano > TAMANO_MAXIMO_DESCOMPRIMIDO) {
      throw new Error(`El libro es demasiado grande: ${nombre} pasa de 50 MB sin comprimir.`);
    }
    const local = entrada.desplazamiento;
    if (local + 30 > datos.length || datos.readUInt32LE(local) !== CABECERA_LOCAL) {
      throw new Error(DANADO);
    }
    const desde = local + 30 + datos.readUInt16LE(local + 26) + datos.readUInt16LE(local + 28);
    const comprimido = datos.subarray(desde, desde + entrada.comprimido);
    if (comprimido.length !== entrada.comprimido) throw new Error(DANADO);

    let contenido: Buffer;
    if (entrada.metodo === 0) {
      contenido = comprimido;
    } else if (entrada.metodo === 8) {
      try {
        contenido = inflateRawSync(comprimido, { maxOutputLength: TAMANO_MAXIMO_DESCOMPRIMIDO });
      } catch (error) {
        throw new Error(DANADO, { cause: error });
      }
    } else {
      throw new Error(`El libro usa una compresión que no se lee (método ${entrada.metodo}).`);
    }
    if (contenido.length !== entrada.tamano || crc32(contenido) !== entrada.crc) {
      throw new Error(DANADO);
    }
    return contenido;
  };
}
```

**Step 5: Run it to see it pass**

Run: `npx vitest run lib/compras/zip.test.ts`
Expected: PASS, 6 tests.

**Step 6: Commit**

```bash
git add lib/compras/libroDePrueba.ts lib/compras/zip.ts lib/compras/zip.test.ts
git commit -m "feat(compras): read an .xlsx zip from its central directory"
```

---

### Task 3: Leer un libro .xlsx

**Files:**
- Create: `lib/compras/xlsx.ts`
- Modify: `lib/compras/libroDePrueba.ts`
- Test: `lib/compras/xlsx.test.ts`

**Step 1: Add `armarLibro` to the test helper**

Append to `lib/compras/libroDePrueba.ts`. It writes only what `leerLibro` reads: without
`[Content_Types].xml`, Excel itself wouldn't open it.

```ts
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
```

**Step 2: Write the failing test**

`lib/compras/xlsx.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { armarLibro, armarZip } from './libroDePrueba';
import { leerLibro } from './xlsx';

const texto = (valor: string) => ({ tipo: 'texto', valor });
const numero = (valor: string) => ({ tipo: 'numero', valor });

describe('leer un libro .xlsx', () => {
  it('lee las hojas en orden, con texto compartido, números y el valor de las fórmulas', () => {
    const libro = leerLibro(
      armarLibro([
        {
          nombre: 'Enero',
          desde: 'E8',
          filas: [
            ['Proveedor', 'RNC'],
            ['Ferretería Inventada', { numero: '1.30000001E8' }],
            [null, { formula: 'SUM(F9:F9)', valor: '130000001' }],
          ],
        },
        { nombre: 'Febrero', filas: [[{ enLinea: 'Texto en línea' }, 46270]] },
      ])
    );
    expect(libro.fechas1904).toBe(false);
    expect(libro.hojas.map((hoja) => hoja.nombre)).toEqual(['Enero', 'Febrero']);
    const [enero, febrero] = libro.hojas;
    expect(enero.filas.map((fila) => fila.numero)).toEqual([8, 9, 10]);
    expect(enero.filas[0].celdas[4]).toEqual(texto('Proveedor'));
    expect(enero.filas[1].celdas[5]).toEqual(numero('1.30000001E8'));
    expect(enero.filas[2].celdas[4]).toBeUndefined();
    expect(enero.filas[2].celdas[5]).toEqual(numero('130000001'));
    expect(febrero.filas[0].celdas).toEqual([texto('Texto en línea'), numero('46270')]);
  });

  it('dice si el libro cuenta las fechas desde 1904', () => {
    const libro = armarLibro([{ nombre: 'Enero', filas: [] }], { fechas1904: true });
    expect(leerLibro(libro).fechas1904).toBe(true);
  });

  // Excel escribe rutas relativas a xl/ y elementos sin prefijo, pero no todos los programas.
  it('sigue rutas absolutas y lee elementos con prefijo', () => {
    const libro = armarLibro([{ nombre: 'Enero', filas: [['NCF']] }], {
      rutasAbsolutas: true,
      prefijo: 'x',
    });
    expect(leerLibro(libro).hojas[0].filas[0].celdas[0]).toEqual(texto('NCF'));
  });

  it('rechaza un zip que no es un libro', () => {
    expect(() => leerLibro(armarZip({ 'a.txt': 'hola' }))).toThrow(/no es un libro .xlsx/);
  });
});
```

**Step 3: Run it to see it fail**

Run: `npx vitest run lib/compras/xlsx.test.ts`
Expected: FAIL with `Failed to resolve import "./xlsx"`.

**Step 4: Write the implementation**

`lib/compras/xlsx.ts`. Two things about `@xmldom/xmldom` 0.8, checked on 2026-09-14:
- `getAttribute` returns `''`, not `null`, for a missing attribute.
- Malformed XML doesn't always throw: `documentElement` can come back `null`.

```ts
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
```

**Step 5: Run it to see it pass**

Run: `npx vitest run lib/compras/xlsx.test.ts && npx next typegen && npx tsc --noEmit`
Expected: PASS, 4 tests, and no type errors.

**Step 6: Commit**

```bash
git add lib/compras/libroDePrueba.ts lib/compras/xlsx.ts lib/compras/xlsx.test.ts
git commit -m "feat(compras): read sheets, shared strings and cached values from an .xlsx"
```

End of batch 1: run `npm test`, `npx next typegen && npx tsc --noEmit` and `npm run lint`, and report.

---

### Task 4: Valores de Excel

**Files:**
- Modify: `lib/compras/fechas.ts`
- Modify: `lib/compras/fechas.test.ts`
- Create: `lib/compras/desdeExcel.ts`
- Test: `lib/compras/desdeExcel.test.ts`

**Step 1: Write the failing tests**

In `lib/compras/fechas.test.ts`, add `fechaLegible` and `nombreDelMes` to the import from `./fechas`,
extend the last test and add one:

```ts
  it('nombra el periodo en español', () => {
    expect(nombreDelPeriodo('202609')).toBe('septiembre de 2026');
    expect(nombreDelMes('202609')).toBe('septiembre');
  });

  it('escribe una fecha AAAAMMDD como dd/mm/aaaa', () => {
    expect(fechaLegible('20260905')).toBe('05/09/2026');
  });
```

Create `lib/compras/desdeExcel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  centavosDeExcel,
  digitosDeExcel,
  fechaDeExcel,
  formaDePagoDelTexto,
  montoDeLaCelda,
  normalizar,
} from './desdeExcel';

describe('valores de Excel', () => {
  it('normaliza etiquetas sin mayúsculas, tildes ni espacios', () => {
    expect(normalizar(' Método de  pago ')).toBe('metododepago');
    expect(normalizar('10% ley')).toBe('10%ley');
    expect(normalizar('SEPTIEMBRE')).toBe('septiembre');
  });

  // En el XML, Excel guarda los dígitos que hagan falta, a veces en notación científica.
  it('lleva un número de Excel a centavos, con la mitad hacia arriba', () => {
    expect(centavosDeExcel('1234.5')).toBe(BigInt(123450));
    expect(centavosDeExcel('212.39999999999998')).toBe(BigInt(21240));
    expect(centavosDeExcel('1.30000001E8')).toBe(BigInt(13000000100));
    expect(centavosDeExcel('0.005')).toBe(BigInt(1));
    expect(centavosDeExcel('5E-3')).toBe(BigInt(1));
    expect(centavosDeExcel('2.5E-3')).toBe(BigInt(0));
    expect(centavosDeExcel('-12')).toBe(BigInt(-1200));
    for (const valor of ['', 'abc', '1e', '1,234.50']) {
      expect(centavosDeExcel(valor)).toBeUndefined();
    }
  });

  it('lee un monto: vacío es cero y un texto no se lee', () => {
    expect(montoDeLaCelda(undefined)).toBe(BigInt(0));
    expect(montoDeLaCelda({ tipo: 'texto', valor: '  ' })).toBe(BigInt(0));
    expect(montoDeLaCelda({ tipo: 'numero', valor: '118' })).toBe(BigInt(11800));
    expect(montoDeLaCelda({ tipo: 'texto', valor: 'RD$118' })).toBeUndefined();
  });

  it('saca los dígitos del RNC, venga como número o como texto', () => {
    expect(digitosDeExcel({ tipo: 'numero', valor: '1.30000001E8' })).toBe('130000001');
    expect(digitosDeExcel({ tipo: 'texto', valor: '1-30-00000-1' })).toBe('130000001');
    expect(digitosDeExcel({ tipo: 'texto', valor: '001 0000000 9' })).toBe('00100000009');
    expect(digitosDeExcel({ tipo: 'numero', valor: '130000001.5' })).toBe('130000001.5');
    expect(digitosDeExcel(undefined)).toBe('');
  });

  // 46270 es el 5 de septiembre de 2026 contando desde 1900, y 44808 contando desde 1904.
  it('lleva una fecha de Excel a AAAAMMDD', () => {
    expect(fechaDeExcel({ tipo: 'numero', valor: '46270' }, false)).toBe('20260905');
    expect(fechaDeExcel({ tipo: 'numero', valor: '46270.75' }, false)).toBe('20260905');
    expect(fechaDeExcel({ tipo: 'numero', valor: '44808' }, true)).toBe('20260905');
    expect(fechaDeExcel({ tipo: 'texto', valor: '05/09/2026' }, false)).toBeUndefined();
    expect(fechaDeExcel(undefined, false)).toBeUndefined();
  });

  it('reconoce la forma de pago por su nombre', () => {
    expect(formaDePagoDelTexto('Efectivo')).toBe('1');
    expect(formaDePagoDelTexto('Cheques/Transferencias/Depósito')).toBe('2');
    expect(formaDePagoDelTexto('03 - TARJETA CRÉDITO/DÉBITO')).toBe('3');
    expect(formaDePagoDelTexto('Compra a crédito')).toBe('4');
    expect(formaDePagoDelTexto('Permuta')).toBe('5');
    expect(formaDePagoDelTexto('Notas de crédito')).toBe('6');
    expect(formaDePagoDelTexto('Mixto')).toBe('7');
    expect(formaDePagoDelTexto('')).toBeUndefined();
    expect(formaDePagoDelTexto('Pagado')).toBeUndefined();
  });
});
```

**Step 2: Run them to see them fail**

Run: `npx vitest run lib/compras/fechas.test.ts lib/compras/desdeExcel.test.ts`
Expected: FAIL. `nombreDelMes is not a function`, and `Failed to resolve import "./desdeExcel"`.

**Step 3: Write the implementation**

In `lib/compras/fechas.ts`, replace `nombreDelPeriodo` with:

```ts
export function nombreDelMes(periodo: string): string {
  const [, mes] = partesDelPeriodo(periodo);
  return MESES[mes - 1];
}

export function nombreDelPeriodo(periodo: string): string {
  const [anio] = partesDelPeriodo(periodo);
  return `${nombreDelMes(periodo)} de ${anio}`;
}

// Una fecha AAAAMMDD para leerla en la página y en los mensajes.
export const fechaLegible = (fecha: string) =>
  `${fecha.slice(6, 8)}/${fecha.slice(4, 6)}/${fecha.slice(0, 4)}`;
```

Create `lib/compras/desdeExcel.ts`. It must not import `./xlsx` except as a type: the page imports
this file, and `./xlsx` needs `node:zlib`.

```ts
import type { FormaPago } from './tipos';
import type { Celda } from './xlsx';

// Del libro de gastos a compras del 606: lo que dice cada fila y lo que falta revisar. No lee
// archivos, así que también corre en la página, para la vista previa.

const CERO = BigInt(0);
const UNO = BigInt(1);
const CIEN = BigInt(100);

// Las etiquetas se comparan sin mayúsculas, tildes ni espacios: "Método de pago" es metododepago.
export const normalizar = (texto: string): string =>
  texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '');

// Un número como lo guarda Excel en el XML ('1234.5', '-12', '1.30000001E8') a centavos, con la
// mitad hacia arriba y sin pasar por punto flotante.
export function centavosDeExcel(valor: string): bigint | undefined {
  const partes = valor.trim().match(/^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
  if (partes === null) return undefined;
  const [, signo, enteros, fraccion = '', exponente = '0'] = partes;
  const digitos = enteros + fraccion;
  if (digitos === '') return undefined;
  // Dónde queda el punto después de multiplicar por 100.
  const punto = enteros.length + Number(exponente) + 2;
  let centavos: bigint;
  let siguiente: number;
  if (punto <= 0) {
    centavos = CERO;
    siguiente = punto === 0 ? Number(digitos[0]) : 0;
  } else if (punto >= digitos.length) {
    centavos = BigInt(digitos.padEnd(punto, '0'));
    siguiente = 0;
  } else {
    centavos = BigInt(digitos.slice(0, punto));
    siguiente = Number(digitos[punto]);
  }
  if (siguiente >= 5) centavos += UNO;
  return signo === '-' ? -centavos : centavos;
}

// Una celda de monto vacía vale cero. Un texto que no está en blanco no es un monto.
export function montoDeLaCelda(celda: Celda | undefined): bigint | undefined {
  if (celda === undefined) return CERO;
  if (celda.tipo === 'texto') return celda.valor.trim() === '' ? CERO : undefined;
  return centavosDeExcel(celda.valor);
}

// Los dígitos del RNC o la cédula. Como número llega sin guiones, pero en notación científica si
// es largo; como texto puede traer espacios y guiones. Lo que no es un entero va tal cual, y
// validarCompra dice por qué no sirve.
export function digitosDeExcel(celda: Celda | undefined): string {
  if (celda === undefined) return '';
  if (celda.tipo === 'texto') return celda.valor.replace(/[\s-]/g, '');
  const centavos = centavosDeExcel(celda.valor);
  return centavos !== undefined && centavos >= CERO && centavos % CIEN === CERO
    ? (centavos / CIEN).toString()
    : celda.valor;
}

// Excel cuenta los días desde el 30 de diciembre de 1899. Así cuadra desde marzo de 1900, después
// del 29 de febrero de 1900 que Excel cuenta y que no existió. Con fechas de 1904 cuenta desde el
// 1 de enero de 1904. La fracción es la hora, que no cuenta.
const EPOCA_1900 = Date.UTC(1899, 11, 30);
const EPOCA_1904 = Date.UTC(1904, 0, 1);
const UN_DIA = 86_400_000;

export function fechaDeExcel(celda: Celda | undefined, fechas1904: boolean): string | undefined {
  if (celda?.tipo !== 'numero') return undefined;
  const dias = Number(celda.valor);
  if (!Number.isFinite(dias) || dias < 1) return undefined;
  const fecha = new Date((fechas1904 ? EPOCA_1904 : EPOCA_1900) + Math.floor(dias) * UN_DIA);
  const dos = (numero: number) => String(numero).padStart(2, '0');
  return `${fecha.getUTCFullYear()}${dos(fecha.getUTCMonth() + 1)}${dos(fecha.getUTCDate())}`;
}

// Por palabras y en este orden: "Tarjeta de crédito" y "Notas de crédito" también dicen crédito.
const FORMAS_POR_PALABRA: [string, FormaPago][] = [
  ['nota', '6'],
  ['tarjeta', '3'],
  ['mixto', '7'],
  ['permuta', '5'],
  ['efectivo', '1'],
  ['cheque', '2'],
  ['transferencia', '2'],
  ['deposito', '2'],
  ['credito', '4'],
];

export function formaDePagoDelTexto(texto: string): FormaPago | undefined {
  const normalizado = normalizar(texto);
  return FORMAS_POR_PALABRA.find(([palabra]) => normalizado.includes(palabra))?.[1];
}
```

**Step 4: Run them to see them pass**

Run: `npx vitest run lib/compras/fechas.test.ts lib/compras/desdeExcel.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add lib/compras/fechas.ts lib/compras/fechas.test.ts lib/compras/desdeExcel.ts lib/compras/desdeExcel.test.ts
git commit -m "feat(compras): read amounts, RNCs, dates and payment methods from Excel cells"
```

---

### Task 5: Historial de proveedores

**Files:**
- Modify: `lib/compras/desdeExcel.ts`
- Test: `lib/compras/desdeExcel.test.ts`

**Step 1: Write the failing test**

In `lib/compras/desdeExcel.test.ts`, add `historialDeProveedores` to the import from `./desdeExcel`,
add these imports, and append the `describe`:

```ts
import { compraDePrueba } from './ejemplos';
import type { FormaPago } from './tipos';
```

```ts
describe('historial de proveedores', () => {
  it('toma el tipo, la clase y la forma de pago de la compra más reciente de cada proveedor', () => {
    const historial = historialDeProveedores([
      compraDePrueba({ RNCCedula: '130000001', FechaComprobante: '20260805' }),
      compraDePrueba({
        RNCCedula: '130000001',
        NCF: 'B0100000124',
        FechaComprobante: '20260812',
        TipoBienesServicios: '9',
        MontoServicios: '0.00',
        MontoBienes: '500.00',
        FormaPago: '3',
      }),
      compraDePrueba({ RNCCedula: '100000004', FechaComprobante: '20260701' }),
    ]);
    expect(historial).toEqual({
      '130000001': { tipo: '9', clase: 'bienes', forma: '3' },
      '100000004': { tipo: '2', clase: 'servicios', forma: '1' },
    });
  });

  // Un archivo de datos/compras editado a mano puede traer códigos que no existen.
  it('no toma una compra con códigos que no existen', () => {
    const historial = historialDeProveedores([
      compraDePrueba({ RNCCedula: '130000001', FechaComprobante: '20260805' }),
      compraDePrueba({
        RNCCedula: '130000001',
        NCF: 'B0100000124',
        FechaComprobante: '20260812',
        FormaPago: '8' as FormaPago,
      }),
    ]);
    expect(historial['130000001']).toEqual({ tipo: '2', clase: 'servicios', forma: '1' });
  });
});
```

**Step 2: Run it to see it fail**

Run: `npx vitest run lib/compras/desdeExcel.test.ts`
Expected: FAIL with `historialDeProveedores is not a function`.

**Step 3: Write the implementation**

In `lib/compras/desdeExcel.ts`, replace the import of `./tipos` with these two imports:

```ts
import { aCentavos, esMonto } from './montos';
import {
  esCodigo,
  FORMAS_DE_PAGO,
  TIPOS_DE_BIENES_Y_SERVICIOS,
  type Compra,
  type FormaPago,
  type TipoBienesServicios,
} from './tipos';
```

and append:

```ts
export type Clase = 'servicios' | 'bienes';

export interface Historia {
  tipo: TipoBienesServicios;
  clase: Clase;
  forma: FormaPago;
}

const centavosDelMonto = (valor: string) => (esMonto(valor) ? aCentavos(valor, 'Monto') : CERO);

// La compra guardada más reciente de cada proveedor propone el tipo, la clase y la forma de pago de
// sus filas. La clase es la del monto mayor.
export function historialDeProveedores(compras: Compra[]): Record<string, Historia> {
  const recientes = new Map<string, Compra>();
  for (const compra of compras) {
    if (!esCodigo(TIPOS_DE_BIENES_Y_SERVICIOS, compra.TipoBienesServicios)) continue;
    if (!esCodigo(FORMAS_DE_PAGO, compra.FormaPago)) continue;
    const anterior = recientes.get(compra.RNCCedula);
    if (anterior === undefined || compra.FechaComprobante >= anterior.FechaComprobante) {
      recientes.set(compra.RNCCedula, compra);
    }
  }
  return Object.fromEntries(
    [...recientes].map(([rnc, compra]): [string, Historia] => [
      rnc,
      {
        tipo: compra.TipoBienesServicios,
        clase:
          centavosDelMonto(compra.MontoBienes) > centavosDelMonto(compra.MontoServicios)
            ? 'bienes'
            : 'servicios',
        forma: compra.FormaPago,
      },
    ])
  );
}
```

**Step 4: Run it to see it pass**

Run: `npx vitest run lib/compras/desdeExcel.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add lib/compras/desdeExcel.ts lib/compras/desdeExcel.test.ts
git commit -m "feat(compras): suggest type, class and payment method from a supplier's last purchase"
```

---

### Task 6: Leer las hojas de gastos

**Files:**
- Modify: `lib/compras/desdeExcel.ts`
- Test: `lib/compras/desdeExcel.test.ts`

What each row becomes:
- **The table:** the first row with the RNC and NCF labels is the header, and the purchases end at
  the next row that repeats it.
- **Skipped:** a row without an NCF (totals, the list of payment methods, empty rows).
- **Amount:** Monto total − ITBS − 10% ley. The propina goes in its own field.
- **Suggestions:** type, class and payment method come from the supplier's history, found by the
  number or by the proposed cédula. With no history the type is 09 and the class is services. A
  payment method named in the row wins over the history; with neither, the user picks one for the
  whole import (Task 7).
- **Review:** `revisarRNC` from Task 1 marks a number with a proposed cédula or a doubtful check
  digit.
- **Doesn't go (`noVa`)**, checked in this order: an NCF the 606 doesn't take (consumo included), a
  date that isn't an Excel date or isn't in the month, a purchase already saved, a row repeated in
  the sheet, an amount that isn't a number or is negative, and an amount without taxes of zero or
  less.

**Step 1: Write the failing test**

In `lib/compras/desdeExcel.test.ts`, add `leerGastos` and `type Historia` to the import from
`./desdeExcel`, add these imports, and append the fixture and the `describe`:

```ts
import { armarLibro, type CeldaDePrueba } from './libroDePrueba';
import { leerLibro } from './xlsx';
```

```ts
const ENCABEZADO: CeldaDePrueba[] = [
  'Proveedor',
  'RNC',
  'NCF',
  'Fecha',
  'ITBS',
  '10% ley',
  'Monto total',
  'Concepto',
  'Método de pago',
];

// Como en el libro de referencia, la tabla empieza en E8. Los proveedores y los números son
// inventados. Fechas de Excel: 46270 es el 5 de septiembre de 2026 y cada día suma uno; 45910 es
// el 10 de septiembre de 2025 y 46240, el 6 de agosto de 2026.
const SEPTIEMBRE: CeldaDePrueba[][] = [
  ENCABEZADO,
  ['Ferretería Inventada', { numero: '1.30000001E8' }, 'B0100000001', 46270, 180, null, 1180,
    'Clavos', 'Tarjeta de crédito o débito'],
  ['Restaurante Inventado', 100000004, 'E310000000001', 46271, 180, 100, 1280, 'Almuerzo'],
  ['Colmado Inventado', 100000009, 'B0100000002', 46272, null, null, 500, null, 'Efectivo'],
  ['Taller Inventado', 100000000, 'B0100000003', 46273, 90, null, 590],
  ['Supermercado Inventado', 130000001, 'B0200000001', 46273, 18, null, 118, null, 'Efectivo'],
  ['Ferretería Inventada', 130000001, 'B0100000004', 45910, 180, null, 1180],
  ['Ferretería Inventada', 130000001, 'B0100000009', 46274, 18, null, 118],
  ['Ferretería Inventada', 130000001, 'B0100000001', 46270, 180, null, 1180],
  ['Imprenta Inventada', 140000001, 'B0100000005', 46274, 180, null, 180, null, 'Cheque'],
  // Los totales y la lista de métodos de pago no son compras.
  [null, null, null, null, { formula: 'SUM(I9:I17)', valor: '1026' }, null,
    { formula: 'SUM(K9:K17)', valor: '6326' }],
  [null, null, null, null, null, null, null, null, 'Efectivo'],
  // Debajo empieza otra tabla, que no se lee.
  ENCABEZADO,
  ['Otra Tabla Inventada', 130000001, 'B0100000006', 46274, 18, null, 118],
];

const LIBRO = leerLibro(
  armarLibro([
    {
      // Otras columnas, en otro orden y en otro lugar.
      nombre: 'Agosto',
      desde: 'B3',
      filas: [
        ['NCF', 'Monto total', 'Fecha', 'ITBS', 'RNC', 'Proveedor'],
        ['B0100000007', 590, 46240, 90, 100000004, 'Restaurante Inventado'],
      ],
    },
    { nombre: 'Septiembre', desde: 'E8', filas: SEPTIEMBRE },
    { nombre: 'Notas', filas: [['Pendientes de pago'], ['Llamar al contador']] },
    { nombre: 'Octubre', filas: [['Proveedor', 'RNC', 'NCF', 'ITBS', 'Monto total']] },
  ])
);

const historial: Record<string, Historia> = {
  '100000004': { tipo: '2', clase: 'bienes', forma: '2' },
};
const contexto = { periodo: '202609', anotadas: new Set(['130000001_B0100000009']), historial };

describe('leer las hojas de gastos', () => {
  const lectura = leerGastos(LIBRO, contexto);
  const [agosto, septiembre, notas, octubre] = lectura.hojas;
  const fila = (numero: number) => septiembre.filas.find((leida) => leida.fila === numero);

  it('propone la hoja del mes que se ve en Compras, o la primera', () => {
    expect(lectura.hojas.map((hoja) => hoja.nombre)).toEqual(['Agosto', 'Septiembre', 'Notas', 'Octubre']);
    expect(lectura.propuesta).toBe(1);
    expect(leerGastos(LIBRO, { ...contexto, periodo: '202612' }).propuesta).toBe(0);
  });

  it('salta las filas sin NCF y termina la tabla en el encabezado repetido', () => {
    expect(septiembre.filas.map((leida) => leida.fila)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it('lee una compra con el tipo 09 y servicios si el proveedor no tiene historial', () => {
    expect(fila(9)).toEqual({
      fila: 9,
      proveedor: 'Ferretería Inventada',
      rnc: '130000001',
      ncf: 'B0100000001',
      fecha: '20260905',
      monto: '1000.00',
      itbis: '180.00',
      propina: '0.00',
      tipo: '9',
      clase: 'servicios',
      forma: '3',
    });
  });

  // NG 07-2018: el monto facturado va sin ITBIS ni propina legal.
  it('saca el ITBIS y la propina del monto, y usa el historial del proveedor', () => {
    expect(fila(10)).toMatchObject({
      monto: '1000.00',
      itbis: '180.00',
      propina: '100.00',
      tipo: '2',
      clase: 'bienes',
      forma: '2',
    });
    expect(fila(10)?.revisarRNC).toBeUndefined();
  });

  it('propone la cédula de un número que perdió los ceros y marca un RNC dudoso', () => {
    expect(fila(11)).toMatchObject({ rnc: '100000009', itbis: '0.00', monto: '500.00', forma: '1' });
    expect(fila(11)?.revisarRNC).toEqual({ cedula: '00100000009' });
    expect(fila(12)?.revisarRNC).toEqual({});
    expect(fila(12)?.forma).toBeUndefined();
  });

  it('dice por qué no va cada fila que no va', () => {
    expect(fila(13)?.noVa).toMatch(/factura de consumo/);
    expect(fila(14)?.noVa).toBe('Es del 10/09/2025, no de septiembre de 2026.');
    expect(fila(15)?.noVa).toBe('Ya está anotada.');
    expect(fila(16)?.noVa).toBe('Repite la fila 9.');
    expect(fila(17)?.noVa).toMatch(/cero o negativo/);
    expect([9, 10, 11, 12].map((numero) => fila(numero)?.noVa)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('encuentra las columnas en otro orden', () => {
    expect(agosto.filas).toEqual([
      {
        fila: 4,
        proveedor: 'Restaurante Inventado',
        rnc: '100000004',
        ncf: 'B0100000007',
        fecha: '20260806',
        monto: '500.00',
        itbis: '90.00',
        propina: '0.00',
        tipo: '2',
        clase: 'bienes',
        forma: '2',
        noVa: 'Es del 06/08/2026, no de septiembre de 2026.',
      },
    ]);
  });

  it('dice por qué una hoja no tiene filas', () => {
    expect(notas).toEqual({
      nombre: 'Notas',
      motivo: 'No tiene una fila de encabezado con RNC y NCF.',
      filas: [],
    });
    expect(octubre).toEqual({
      nombre: 'Octubre',
      motivo: 'Al encabezado de la fila 1 le falta: Fecha.',
      filas: [],
    });
  });
});
```

**Step 2: Run it to see it fail**

Run: `npx vitest run lib/compras/desdeExcel.test.ts`
Expected: FAIL with `leerGastos is not a function`.

**Step 3: Write the implementation**

In `lib/compras/desdeExcel.ts`, replace all the imports with:

```ts
import { revisarRNC } from './digitoVerificador';
import { fechaLegible, nombreDelMes, nombreDelPeriodo } from './fechas';
import { aCentavos, aMonto, esMonto } from './montos';
import { leerNCFDeCompra } from './ncf';
import {
  claveDeCompra,
  esCodigo,
  FORMAS_DE_PAGO,
  TIPOS_DE_BIENES_Y_SERVICIOS,
  type Compra,
  type FormaPago,
  type TipoBienesServicios,
} from './tipos';
import type { Celda, Fila, Hoja, Libro } from './xlsx';
```

and append:

```ts
export interface FilaDeGastos {
  // La fila en Excel, para encontrarla en el libro.
  fila: number;
  // Solo para mostrar: el 606 no lleva el nombre del proveedor.
  proveedor: string;
  rnc: string;
  ncf: string;
  // AAAAMMDD, o '' si la celda no trae una fecha de Excel.
  fecha: string;
  // Montos del 606 como texto decimal, o '' si no se pueden leer. El monto va sin impuestos.
  monto: string;
  itbis: string;
  propina: string;
  // Lo que se propone. Quien importa lo puede cambiar.
  tipo: TipoBienesServicios;
  clase: Clase;
  // Del texto de la fila o del historial. Sin ninguno, la que se elija para toda la importación.
  forma?: FormaPago;
  // El dígito verificador no cuadra: la cédula que se propone, o nada si el número es dudoso.
  revisarRNC?: { cedula?: string };
  // Por qué la fila no va. Con esto no hay nada que elegir.
  noVa?: string;
}

export interface HojaDeGastos {
  nombre: string;
  // Sin encabezado, o sin una columna obligatoria, la hoja no trae filas y dice por qué.
  motivo?: string;
  filas: FilaDeGastos[];
}

export interface LecturaDeGastos {
  hojas: HojaDeGastos[];
  // La hoja del mes que se ve en Compras, buscada por su nombre; si no hay, la primera.
  propuesta: number;
}

export interface ContextoDeLectura {
  periodo: string;
  // Las claves (claveDeCompra) de las compras ya guardadas.
  anotadas: Set<string>;
  historial: Record<string, Historia>;
}

// Las etiquetas del encabezado, ya normalizadas. El libro de referencia dice ITBS.
const COLUMNAS = {
  proveedor: ['proveedor'],
  rnc: ['rnc'],
  ncf: ['ncf'],
  fecha: ['fecha'],
  itbis: ['itbs', 'itbis'],
  propina: ['10%ley'],
  total: ['montototal'],
  forma: ['metododepago'],
} as const;

type Columna = keyof typeof COLUMNAS;
type Columnas = Partial<Record<Columna, number>>;

const OBLIGATORIAS = {
  rnc: 'RNC',
  ncf: 'NCF',
  fecha: 'Fecha',
  itbis: 'ITBS',
  total: 'Monto total',
} as const;

function columnasDe(fila: Fila): Columnas {
  const columnas: Columnas = {};
  fila.celdas.forEach((celda, indice) => {
    if (celda?.tipo !== 'texto') return;
    const etiqueta = normalizar(celda.valor);
    for (const [columna, etiquetas] of Object.entries(COLUMNAS) as [Columna, readonly string[]][]) {
      if (etiquetas.includes(etiqueta) && columnas[columna] === undefined) columnas[columna] = indice;
    }
  });
  return columnas;
}

const esEncabezado = (columnas: Columnas) => columnas.rnc !== undefined && columnas.ncf !== undefined;

const montoLegible = (centavos: bigint | undefined) =>
  centavos === undefined || centavos < CERO ? '' : aMonto(centavos);

interface DatosDeLaFila {
  numero: number;
  ncf: string;
  rnc: string;
  cedula?: string;
  fecha: string;
  monto?: bigint;
  itbis?: bigint;
  propina?: bigint;
}

// Por qué una fila no va en el 606, o undefined si va. Lleva la cuenta de las ya leídas del mes
// para ver las repetidas.
function porQueNoVa(
  datos: DatosDeLaFila,
  contexto: ContextoDeLectura,
  vistas: Map<string, number>
): string | undefined {
  const lectura = leerNCFDeCompra(datos.ncf);
  if (!lectura.valido) return lectura.motivo;
  if (datos.fecha === '') return 'La fecha no es una fecha de Excel.';
  if (datos.fecha.slice(0, 6) !== contexto.periodo) {
    return `Es del ${fechaLegible(datos.fecha)}, no de ${nombreDelPeriodo(contexto.periodo)}.`;
  }
  // Con el número tal como vino y con la cédula que se propone.
  const claves = [datos.rnc, datos.cedula ?? '']
    .filter((valor) => valor !== '')
    .map((RNCCedula) => claveDeCompra({ RNCCedula, NCF: datos.ncf }));
  if (claves.some((clave) => contexto.anotadas.has(clave))) return 'Ya está anotada.';
  const repetida = claves.map((clave) => vistas.get(clave)).find((fila) => fila !== undefined);
  if (repetida !== undefined) return `Repite la fila ${repetida}.`;
  for (const clave of claves) vistas.set(clave, datos.numero);
  if (datos.monto === undefined || datos.itbis === undefined || datos.propina === undefined) {
    return 'Monto total, ITBS o 10% ley no es un número.';
  }
  if (datos.itbis < CERO || datos.propina < CERO) return 'El ITBS o el 10% ley es negativo.';
  if (datos.monto <= CERO) {
    return 'El monto sin impuestos (Monto total menos ITBS y 10% ley) es cero o negativo.';
  }
  return undefined;
}

function leerFilaDeGastos(
  numero: number,
  celda: (columna: Columna) => Celda | undefined,
  ncf: string,
  fechas1904: boolean,
  contexto: ContextoDeLectura,
  vistas: Map<string, number>
): FilaDeGastos {
  const rnc = digitosDeExcel(celda('rnc'));
  const revision = revisarRNC(rnc);
  const cedula = revision.estado === 'cedula' ? revision.cedula : undefined;
  const historia =
    contexto.historial[rnc] ?? (cedula === undefined ? undefined : contexto.historial[cedula]);
  const fecha = fechaDeExcel(celda('fecha'), fechas1904) ?? '';
  const total = montoDeLaCelda(celda('total'));
  const itbis = montoDeLaCelda(celda('itbis'));
  const propina = montoDeLaCelda(celda('propina'));
  // El monto total del libro incluye el ITBIS y la propina, y el 606 los lleva aparte.
  const monto =
    total === undefined || itbis === undefined || propina === undefined
      ? undefined
      : total - itbis - propina;

  const leida: FilaDeGastos = {
    fila: numero,
    proveedor: (celda('proveedor')?.valor ?? '').trim(),
    rnc,
    ncf,
    fecha,
    monto: montoLegible(monto),
    itbis: montoLegible(itbis),
    propina: montoLegible(propina),
    tipo: historia?.tipo ?? '9',
    clase: historia?.clase ?? 'servicios',
  };
  const forma = formaDePagoDelTexto(celda('forma')?.valor ?? '') ?? historia?.forma;
  if (forma !== undefined) leida.forma = forma;
  if (revision.estado === 'cedula') leida.revisarRNC = { cedula: revision.cedula };
  if (revision.estado === 'dudoso') leida.revisarRNC = {};
  const noVa = porQueNoVa(
    { numero, ncf, rnc, cedula, fecha, monto, itbis, propina },
    contexto,
    vistas
  );
  if (noVa !== undefined) leida.noVa = noVa;
  return leida;
}

function leerHojaDeGastos(
  hoja: Hoja,
  fechas1904: boolean,
  contexto: ContextoDeLectura
): HojaDeGastos {
  const inicio = hoja.filas.findIndex((fila) => esEncabezado(columnasDe(fila)));
  if (inicio < 0) {
    return { nombre: hoja.nombre, motivo: 'No tiene una fila de encabezado con RNC y NCF.', filas: [] };
  }
  const columnas = columnasDe(hoja.filas[inicio]);
  const faltan = (Object.keys(OBLIGATORIAS) as (keyof typeof OBLIGATORIAS)[])
    .filter((columna) => columnas[columna] === undefined)
    .map((columna) => OBLIGATORIAS[columna]);
  if (faltan.length > 0) {
    const numero = hoja.filas[inicio].numero;
    return {
      nombre: hoja.nombre,
      motivo: `Al encabezado de la fila ${numero} le falta: ${faltan.join(', ')}.`,
      filas: [],
    };
  }

  const filas: FilaDeGastos[] = [];
  const vistas = new Map<string, number>();
  for (const fila of hoja.filas.slice(inicio + 1)) {
    // Un encabezado repetido empieza otra tabla: las compras terminan ahí.
    if (esEncabezado(columnasDe(fila))) break;
    const celda = (columna: Columna): Celda | undefined => {
      const indice = columnas[columna];
      return indice === undefined ? undefined : fila.celdas[indice];
    };
    // Sin NCF no es una compra: son los totales, la lista de métodos de pago o filas vacías.
    const ncf = (celda('ncf')?.valor ?? '').replace(/[\s-]/g, '').toUpperCase();
    if (ncf === '') continue;
    filas.push(leerFilaDeGastos(fila.numero, celda, ncf, fechas1904, contexto, vistas));
  }
  return { nombre: hoja.nombre, filas };
}

export function leerGastos(libro: Libro, contexto: ContextoDeLectura): LecturaDeGastos {
  const mes = nombreDelMes(contexto.periodo);
  const propuesta = libro.hojas.findIndex((hoja) => normalizar(hoja.nombre).includes(mes));
  return {
    hojas: libro.hojas.map((hoja) => leerHojaDeGastos(hoja, libro.fechas1904, contexto)),
    propuesta: Math.max(propuesta, 0),
  };
}
```

**Step 4: Run it to see it pass**

Run: `npx vitest run lib/compras/desdeExcel.test.ts && npx next typegen && npx tsc --noEmit`
Expected: PASS, and no type errors.

**Step 5: Commit**

```bash
git add lib/compras/desdeExcel.ts lib/compras/desdeExcel.test.ts
git commit -m "feat(compras): turn the purchases sheet into rows to review"
```

End of batch 2: run `npm test`, `npx next typegen && npx tsc --noEmit` and `npm run lint`, and report.

---

### Task 7: De fila a compra

**Files:**
- Modify: `lib/compras/desdeExcel.ts`
- Test: `lib/compras/desdeExcel.test.ts`

A row's state in the preview comes from the row plus what the user chose:
- **No va:** the row's `noVa`, or any error from `validarCompra` once the purchase is built.
- **Revisa el RNC:** the row has `revisarRNC` and the user hasn't picked the cédula or the number yet.
- **Falta la forma de pago:** no method in the row, none chosen for the row, and none chosen for the
  whole workbook.
- **Lista:** everything else. The payment date is the invoice date, except on a purchase on credit
  (4), which has no payment date.

**Step 1: Write the failing test**

In `lib/compras/desdeExcel.test.ts`, add `comprasElegidas`, `evaluarFila` and `type FilaDeGastos` to
the import from `./desdeExcel`, and append:

```ts
describe('de fila a compra', () => {
  // El negocio de emisorDePrueba.
  const opciones = { rncDelNegocio: '123456789' };
  const fila = (cambios: Partial<FilaDeGastos> = {}): FilaDeGastos => ({
    fila: 9,
    proveedor: 'Ferretería Inventada',
    rnc: '130000001',
    ncf: 'B0100000001',
    fecha: '20260905',
    monto: '1000.00',
    itbis: '180.00',
    propina: '0.00',
    tipo: '9',
    clase: 'servicios',
    forma: '3',
    ...cambios,
  });

  it('arma la compra con la fecha de pago del comprobante', () => {
    expect(evaluarFila(fila(), {}, opciones)).toEqual({
      estado: 'lista',
      compra: {
        RNCCedula: '130000001',
        TipoBienesServicios: '9',
        NCF: 'B0100000001',
        FechaComprobante: '20260905',
        FechaPago: '20260905',
        MontoServicios: '1000.00',
        MontoBienes: '0.00',
        ITBISFacturado: '180.00',
        FormaPago: '3',
      },
    });
  });

  it('usa el tipo, la clase y la forma de pago que se eligen, y lleva la propina', () => {
    const eleccion = { tipo: '2', clase: 'bienes', forma: '1' } as const;
    expect(evaluarFila(fila({ propina: '100.00' }), eleccion, opciones)).toMatchObject({
      estado: 'lista',
      compra: {
        TipoBienesServicios: '2',
        MontoServicios: '0.00',
        MontoBienes: '1000.00',
        FormaPago: '1',
        PropinaLegal: '100.00',
      },
    });
  });

  it('deja sin fecha de pago una compra a crédito', () => {
    const estado = evaluarFila(fila({ forma: '4' }), {}, opciones);
    if (estado.estado !== 'lista') throw new Error(`Esperaba una compra lista y está ${estado.estado}.`);
    expect(estado.compra.FormaPago).toBe('4');
    expect(estado.compra).not.toHaveProperty('FechaPago');
  });

  it('pide la forma de pago, o toma la elegida para todo el libro', () => {
    expect(evaluarFila(fila({ forma: undefined }), {}, opciones)).toEqual({ estado: 'faltaForma' });
    expect(
      evaluarFila(fila({ forma: undefined }), {}, { ...opciones, formaGeneral: '2' })
    ).toMatchObject({ estado: 'lista', compra: { FormaPago: '2' } });
  });

  it('no deja pasar un RNC por revisar hasta que se decide', () => {
    const conCedula = fila({ rnc: '100000009', revisarRNC: { cedula: '00100000009' } });
    expect(evaluarFila(conCedula, {}, opciones)).toEqual({
      estado: 'revisaRNC',
      cedula: '00100000009',
    });
    expect(evaluarFila(conCedula, { rnc: 'cedula' }, opciones)).toMatchObject({
      estado: 'lista',
      compra: { RNCCedula: '00100000009' },
    });
    expect(evaluarFila(conCedula, { rnc: 'numero' }, opciones)).toMatchObject({
      estado: 'lista',
      compra: { RNCCedula: '100000009' },
    });
    const dudoso = fila({ rnc: '100000000', revisarRNC: {} });
    expect(evaluarFila(dudoso, {}, opciones)).toEqual({ estado: 'revisaRNC' });
    expect(evaluarFila(dudoso, { rnc: 'numero' }, opciones)).toMatchObject({
      estado: 'lista',
      compra: { RNCCedula: '100000000' },
    });
  });

  it('dice por qué no va: lo que dijo la lectura o lo que dice validarCompra', () => {
    expect(evaluarFila(fila({ noVa: 'Ya está anotada.' }), {}, opciones)).toEqual({
      estado: 'noVa',
      motivos: ['Ya está anotada.'],
    });
    // Un comprobante de gastos menores lleva el RNC del negocio, no el del proveedor.
    expect(evaluarFila(fila({ ncf: 'B1300000001' }), {}, opciones)).toEqual({
      estado: 'noVa',
      motivos: [expect.stringMatching(/gastos menores/)],
    });
  });

  it('guarda solo las filas listas con la casilla marcada', () => {
    const filas = [
      fila(),
      fila({ fila: 10, ncf: 'B0100000002' }),
      fila({ fila: 11, ncf: 'B0100000003', forma: undefined }),
      fila({ fila: 12, ncf: 'B0100000004', noVa: 'Ya está anotada.' }),
    ];
    const compras = comprasElegidas(filas, { 10: { anotar: false } }, opciones);
    expect(compras.map((compra) => compra.NCF)).toEqual(['B0100000001']);
  });
});
```

**Step 2: Run it to see it fail**

Run: `npx vitest run lib/compras/desdeExcel.test.ts`
Expected: FAIL with `evaluarFila is not a function`.

**Step 3: Write the implementation**

In `lib/compras/desdeExcel.ts`, add `import { validarCompra } from './validar';` after the import of
`./tipos`, and append:

```ts
// Lo que quien importa cambia en una fila de la vista previa. Lo que no toca queda como lo propuso
// la lectura.
export interface EleccionDeFila {
  tipo?: TipoBienesServicios;
  clase?: Clase;
  forma?: FormaPago;
  // En "Revisa el RNC": la cédula que se propone o el número como vino.
  rnc?: 'cedula' | 'numero';
  // La casilla "Anotar", marcada mientras no se desmarque.
  anotar?: boolean;
}

export interface OpcionesDeEvaluacion {
  rncDelNegocio: string;
  // La forma de pago elegida para las filas que no traen una y cuyo proveedor no tiene historial.
  formaGeneral?: FormaPago;
}

export type EstadoDeFila =
  | { estado: 'lista'; compra: Compra }
  | { estado: 'revisaRNC'; cedula?: string }
  | { estado: 'faltaForma' }
  | { estado: 'noVa'; motivos: string[] };

// La compra que sale de una fila con lo elegido. La fecha de pago es la del comprobante, salvo en
// una compra a crédito, que todavía no se ha pagado.
export function compraDeLaFila(
  fila: FilaDeGastos,
  eleccion: EleccionDeFila,
  forma: FormaPago
): Compra {
  const cedula = fila.revisarRNC?.cedula;
  const clase = eleccion.clase ?? fila.clase;
  const compra: Compra = {
    RNCCedula: eleccion.rnc === 'cedula' && cedula !== undefined ? cedula : fila.rnc,
    TipoBienesServicios: eleccion.tipo ?? fila.tipo,
    NCF: fila.ncf,
    FechaComprobante: fila.fecha,
    MontoServicios: clase === 'servicios' ? fila.monto : '0.00',
    MontoBienes: clase === 'bienes' ? fila.monto : '0.00',
    ITBISFacturado: fila.itbis,
    FormaPago: forma,
  };
  if (forma !== '4') compra.FechaPago = fila.fecha;
  if (fila.propina !== '0.00') compra.PropinaLegal = fila.propina;
  return compra;
}

export function evaluarFila(
  fila: FilaDeGastos,
  eleccion: EleccionDeFila,
  opciones: OpcionesDeEvaluacion
): EstadoDeFila {
  if (fila.noVa !== undefined) return { estado: 'noVa', motivos: [fila.noVa] };
  if (fila.revisarRNC !== undefined && eleccion.rnc === undefined) {
    return fila.revisarRNC.cedula === undefined
      ? { estado: 'revisaRNC' }
      : { estado: 'revisaRNC', cedula: fila.revisarRNC.cedula };
  }
  const forma = eleccion.forma ?? fila.forma ?? opciones.formaGeneral;
  if (forma === undefined) return { estado: 'faltaForma' };
  const compra = compraDeLaFila(fila, eleccion, forma);
  const errores = validarCompra(compra, opciones.rncDelNegocio);
  return errores.length > 0 ? { estado: 'noVa', motivos: errores } : { estado: 'lista', compra };
}

// Lo que se guarda: las filas listas con la casilla "Anotar" marcada. Las elecciones van por el
// número de la fila en Excel.
export function comprasElegidas(
  filas: FilaDeGastos[],
  elecciones: Record<number, EleccionDeFila>,
  opciones: OpcionesDeEvaluacion
): Compra[] {
  return filas.flatMap((fila) => {
    const eleccion = elecciones[fila.fila] ?? {};
    const estado = evaluarFila(fila, eleccion, opciones);
    return estado.estado === 'lista' && eleccion.anotar !== false ? [estado.compra] : [];
  });
}
```

**Step 4: Run it to see it pass**

Run: `npx vitest run lib/compras/desdeExcel.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add lib/compras/desdeExcel.ts lib/compras/desdeExcel.test.ts
git commit -m "feat(compras): build a purchase from a workbook row and the user's choices"
```

---

### Task 8: Forma de una compra

**Files:**
- Modify: `lib/compras/tipos.ts`
- Test: `lib/compras/tipos.test.ts`

The save action gets purchases from the page, so it can't trust their shape. `esCompra` checks that
the value has every field a purchase needs and nothing else, all as text; `validarCompra` then
applies the 606's rules.

**Step 1: Write the failing test**

In `lib/compras/tipos.test.ts`, add `esCompra` to the import from `./tipos`, import `compraDePrueba`
from `./ejemplos` if it isn't imported yet, and append:

```ts
describe('forma de una compra', () => {
  it('reconoce una compra, con o sin los campos opcionales', () => {
    expect(esCompra(compraDePrueba())).toBe(true);
    expect(esCompra(compraDePrueba({ FechaPago: '20260905', PropinaLegal: '100.00' }))).toBe(true);
  });

  it('rechaza lo que no tiene la forma de una compra', () => {
    const sinNCF: Record<string, unknown> = { ...compraDePrueba() };
    delete sinNCF.NCF;
    const valores = [
      null,
      'compra',
      [],
      sinNCF,
      { ...compraDePrueba(), MontoBienes: 0 },
      { ...compraDePrueba(), PropinaLegal: 10 },
      { ...compraDePrueba(), Proveedor: 'Ferretería Inventada' },
    ];
    for (const valor of valores) expect(esCompra(valor)).toBe(false);
  });
});
```

**Step 2: Run it to see it fail**

Run: `npx vitest run lib/compras/tipos.test.ts`
Expected: FAIL with `esCompra is not a function`.

**Step 3: Write the implementation**

Append to `lib/compras/tipos.ts`:

```ts
const CAMPOS_OBLIGATORIOS = [
  'RNCCedula',
  'TipoBienesServicios',
  'NCF',
  'FechaComprobante',
  'MontoServicios',
  'MontoBienes',
  'ITBISFacturado',
  'FormaPago',
] as const satisfies readonly (keyof Compra)[];

const CAMPOS_OPCIONALES = [
  'NCFModificado',
  'FechaPago',
  'ITBISRetenido',
  'ITBISProporcionalidad',
  'ITBISCosto',
  'TipoRetencionISR',
  'MontoRetencionRenta',
  'ImpuestoSelectivo',
  'OtrosImpuestos',
  'PropinaLegal',
] as const satisfies readonly (keyof Compra)[];

// Lo que llega a una acción de servidor puede venir de cualquiera: tiene que traer los campos de
// una compra, como texto, y ninguno más. Las reglas del 606 las aplica validarCompra.
export function esCompra(valor: unknown): valor is Compra {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return false;
  const campos = valor as Record<string, unknown>;
  const conocidos: readonly string[] = [...CAMPOS_OBLIGATORIOS, ...CAMPOS_OPCIONALES];
  return (
    Object.keys(campos).every((campo) => conocidos.includes(campo)) &&
    CAMPOS_OBLIGATORIOS.every((campo) => typeof campos[campo] === 'string') &&
    CAMPOS_OPCIONALES.every((campo) => campos[campo] === undefined || typeof campos[campo] === 'string')
  );
}
```

**Step 4: Run it to see it pass**

Run: `npx vitest run lib/compras/tipos.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add lib/compras/tipos.ts lib/compras/tipos.test.ts
git commit -m "feat(compras): check the shape of a purchase that comes from the page"
```

---

### Task 9: Acciones del libro de gastos

**Files:**
- Modify: `lib/compras/limites.ts`
- Modify: `app/compras/acciones.ts`
- Test: `app/compras/acciones.test.ts`

Two server actions, both only in local mode:
- `leerLibroDeGastos(datos)` takes the file (`libro`) and the month (`periodo`). It returns every
  sheet already read, the proposed sheet and the business's RNC, which the page needs to run
  `validarCompra`.
- `guardarComprasDelLibro(compras)` takes the chosen purchases. It checks their shape, validates each
  one again with the business's RNC and saves it with `wx`. It says how many were saved and why the
  others weren't.

**Step 1: Write the failing test**

In `app/compras/acciones.test.ts`, add `guardarComprasDelLibro` and `leerLibroDeGastos` to the import
from `./acciones`, add these imports, and append the helpers and the `describe`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { armarLibro } from '@/lib/compras/libroDePrueba';
import { AlmacenamientoEnArchivos } from '@/lib/storage/archivos';
```

```ts
// Modo local, con una carpeta de datos temporal y el emisor de prueba (RNC 123456789).
async function enModoLocal(prueba: () => Promise<void>) {
  vi.stubEnv('VERCEL', '');
  const directorio = mkdtempSync(join(tmpdir(), 'datos-'));
  try {
    writeFileSync(join(directorio, 'emisor.json'), JSON.stringify(emisorDePrueba()));
    (globalThis as Record<string, unknown>)[CLAVE_DEL_PROCESO] = new AlmacenamientoEnArchivos(directorio);
    await prueba();
  } finally {
    rmSync(directorio, { recursive: true, force: true });
  }
}

// Un libro inventado, con el mes de septiembre de 2026 (46270 es el día 5).
function libroDeGastos(contenido?: BlobPart): FormData {
  const datos = new FormData();
  datos.append('periodo', '202609');
  const libro = armarLibro([
    {
      nombre: 'Septiembre',
      filas: [
        ['Proveedor', 'RNC', 'NCF', 'Fecha', 'ITBS', 'Monto total', 'Método de pago'],
        ['Ferretería Inventada', 130000001, 'B0100000001', 46270, 180, 1180, 'Efectivo'],
        ['Papelería Inventada', 100000004, 'B0100000002', 46271, 18, 118, 'Efectivo'],
      ],
    },
  ]);
  datos.append('libro', new File([contenido ?? new Uint8Array(libro)], 'gastos.xlsx'));
  return datos;
}

describe('acciones del libro de gastos', () => {
  it('no importa el libro en la demostración', async () => {
    vi.stubEnv('VERCEL', '1');
    expect(await leerLibroDeGastos(libroDeGastos())).toEqual({
      leido: false,
      errores: [expect.stringMatching(/solo se puede en modo local/)],
    });
    expect(await guardarComprasDelLibro([compraDePrueba()])).toEqual({
      guardado: false,
      errores: [expect.stringMatching(/solo se puede en modo local/)],
    });
  });

  it('lee el libro con el historial y lo ya anotado', () =>
    enModoLocal(async () => {
      await obtenerAlmacenamiento().guardarCompra(
        compraDePrueba({
          RNCCedula: '100000004',
          NCF: 'B0100000002',
          FechaComprobante: '20260801',
          TipoBienesServicios: '11',
        })
      );
      const resultado = await leerLibroDeGastos(libroDeGastos());
      expect(resultado).toMatchObject({ leido: true, rncDelNegocio: '123456789' });
      if (!resultado.leido) return;
      expect(resultado.lectura.propuesta).toBe(0);
      const [ferreteria, papeleria] = resultado.lectura.hojas[0].filas;
      expect(ferreteria).toMatchObject({ ncf: 'B0100000001', monto: '1000.00', tipo: '9', forma: '1' });
      expect(papeleria).toMatchObject({ ncf: 'B0100000002', tipo: '11', noVa: 'Ya está anotada.' });
    }));

  it('no lee lo que no es un libro, ni un archivo de más de 1 MB', () =>
    enModoLocal(async () => {
      expect(await leerLibroDeGastos(libroDeGastos('hola'))).toEqual({
        leido: false,
        errores: [expect.stringMatching(/no es un libro .xlsx/)],
      });
      expect(await leerLibroDeGastos(libroDeGastos('x'.repeat(1_000_001)))).toEqual({
        leido: false,
        errores: [expect.stringMatching(/más de 1 MB/)],
      });
    }));

  it('guarda las compras elegidas y dice cuáles no se guardaron', () =>
    enModoLocal(async () => {
      const buena = compraDePrueba({ RNCCedula: '130000001' });
      const conError = compraDePrueba({ NCF: 'B0100000124', FormaPago: '8' as FormaPago });
      expect(await guardarComprasDelLibro([buena, buena, conError])).toEqual({
        guardado: true,
        guardadas: 1,
        noGuardadas: [
          expect.stringMatching(/ya está anotada/),
          expect.stringMatching(/^B0100000124 de 987654321: Forma de pago inválida/),
        ],
      });
      expect(await obtenerAlmacenamiento().listarCompras()).toEqual([buena]);
    }));

  it('no guarda lo que no tiene la forma de una compra', () =>
    enModoLocal(async () => {
      const nada = { guardado: false, errores: ['No llegaron compras para guardar.'] };
      expect(await guardarComprasDelLibro([{ NCF: 'B0100000001' }])).toEqual(nada);
      expect(await guardarComprasDelLibro([])).toEqual(nada);
      expect(await guardarComprasDelLibro('compras')).toEqual(nada);
    }));
});
```

**Step 2: Run it to see it fail**

Run: `npx vitest run app/compras/acciones.test.ts`
Expected: FAIL: `guardarComprasDelLibro` and `leerLibroDeGastos` aren't exported.

**Step 3: Write the implementation**

Append to `lib/compras/limites.ts`:

```ts
// El libro de gastos sube por una acción de servidor, con el mismo límite. Un libro de un año pesa
// unos cientos de kilobytes.
export const TAMANO_MAXIMO_DEL_LIBRO = 1_000_000;

export const LIBRO_DEMASIADO_GRANDE =
  'El libro pesa más de 1 MB, que es lo más que se puede subir. Guarda una copia con menos hojas.';
```

In `app/compras/acciones.ts`:
- Add these imports, keeping the alphabetical order:
  - `import { historialDeProveedores, leerGastos, type LecturaDeGastos } from '@/lib/compras/desdeExcel';`
  - `import { leerLibro } from '@/lib/compras/xlsx';`
- Add `LIBRO_DEMASIADO_GRANDE` and `TAMANO_MAXIMO_DEL_LIBRO` to the import from `@/lib/compras/limites`.
- Add `esCompra` to the import from `@/lib/compras/tipos`.
- Add `modoDeEjecucion` to the import from `@/lib/storage`.

Add these types after `ResultadoDel606`:

```ts
export type ResultadoDeLeerElLibro =
  | { leido: true; lectura: LecturaDeGastos; rncDelNegocio: string }
  | { leido: false; errores: string[] };
export type ResultadoDeGuardarDelLibro =
  | { guardado: true; guardadas: number; noGuardadas: string[] }
  | { guardado: false; errores: string[] };
```

Append the actions:

```ts
// En la demostración, lo que se guarda lo ve cualquiera que entre: un libro real mostraría
// proveedores y montos.
const SOLO_EN_LOCAL =
  'Importar el libro de gastos solo se puede en modo local: en la demostración, lo que se guarda lo ve cualquiera que entre.';

const NO_LLEGARON_COMPRAS = 'No llegaron compras para guardar.';

export async function leerLibroDeGastos(datos: FormData): Promise<ResultadoDeLeerElLibro> {
  try {
    if (modoDeEjecucion() !== 'local') return { leido: false, errores: [SOLO_EN_LOCAL] };
    const periodo = datos.get('periodo');
    if (typeof periodo !== 'string' || !esPeriodo(periodo)) {
      return { leido: false, errores: [`Periodo inválido: ${String(periodo)}.`] };
    }
    const archivo = datos.get('libro');
    if (!(archivo instanceof File) || archivo.size === 0) {
      return { leido: false, errores: ['Elige el libro de gastos (.xlsx).'] };
    }
    if (archivo.size > TAMANO_MAXIMO_DEL_LIBRO) {
      return { leido: false, errores: [LIBRO_DEMASIADO_GRANDE] };
    }
    const libro = leerLibro(new Uint8Array(await archivo.arrayBuffer()));
    const almacenamiento = obtenerAlmacenamiento();
    const { RNCEmisor } = await almacenamiento.leerEmisor();
    const compras = await almacenamiento.listarCompras();
    const lectura = leerGastos(libro, {
      periodo,
      anotadas: new Set(compras.map(claveDeCompra)),
      historial: historialDeProveedores(compras),
    });
    return { leido: true, lectura, rncDelNegocio: RNCEmisor };
  } catch (error) {
    return { leido: false, errores: [mensaje(error)] };
  }
}

// El servidor no se fía de la vista previa: vuelve a validar cada compra, y wx no deja guardar dos
// veces la misma.
export async function guardarComprasDelLibro(
  compras: unknown
): Promise<ResultadoDeGuardarDelLibro> {
  try {
    if (modoDeEjecucion() !== 'local') return { guardado: false, errores: [SOLO_EN_LOCAL] };
    if (!Array.isArray(compras) || compras.length === 0 || !compras.every(esCompra)) {
      return { guardado: false, errores: [NO_LLEGARON_COMPRAS] };
    }
    const almacenamiento = obtenerAlmacenamiento();
    const { RNCEmisor } = await almacenamiento.leerEmisor();
    let guardadas = 0;
    const noGuardadas: string[] = [];
    for (const compra of compras) {
      const cual = `${compra.NCF} de ${compra.RNCCedula}`;
      const errores = validarCompra(compra, RNCEmisor);
      if (errores.length > 0) {
        noGuardadas.push(`${cual}: ${errores.join(' ')}`);
        continue;
      }
      try {
        await almacenamiento.guardarCompra(compra);
        guardadas += 1;
      } catch (error) {
        // El error de una compra duplicada ya dice cuál es.
        const motivo = mensaje(error);
        noGuardadas.push(motivo.includes(compra.NCF) ? motivo : `${cual}: ${motivo}`);
      }
    }
    if (guardadas > 0) refresh();
    return { guardado: true, guardadas, noGuardadas };
  } catch (error) {
    return { guardado: false, errores: [mensaje(error)] };
  }
}
```

**Step 4: Run it to see it pass**

Run: `npx vitest run app/compras/acciones.test.ts && npx next typegen && npx tsc --noEmit`
Expected: PASS, and no type errors.

**Step 5: Commit**

```bash
git add lib/compras/limites.ts app/compras/acciones.ts app/compras/acciones.test.ts
git commit -m "feat(compras): server actions to read the purchases workbook and save its rows"
```

End of batch 3: run `npm test`, `npx next typegen && npx tsc --noEmit` and `npm run lint`, and report.

---

### Task 10: La pantalla

**Files:**
- Create: `app/compras/importarLibro.tsx`
- Modify: `app/compras/compras.tsx`
- Modify: `app/compras/page.tsx`
- Modify: `app/compras/compras.module.css`

The page has no component tests: Task 11 checks this in the browser. This task ends with types, lint
and the existing tests passing.

What the screen does:
- **Form:** a dashed box in section A, like the XML import: the file, the month and "Leer el libro".
  In the demo it's disabled and says why.
- **Preview:** after a read.
  - A sheet selector, starting on the proposed sheet. Changing sheet clears the choices.
  - A payment method for the rows that don't have one.
  - A table with one row per purchase:
    - "Anotar" checkbox, Excel row, supplier, RNC, NCF, date, amount, ITBIS and propina;
    - selects for type, class and payment method;
    - the state, with "Usar la cédula" and "Dejar el número" when the RNC needs review.
  - Below: "Guardar N compras" and a count of rows ready, to review, and that don't go.
- **After saving:** the preview becomes a summary. The month's list refreshes through `refresh()`.

**Step 1: Write the component**

`app/compras/importarLibro.tsx`:

```tsx
'use client';

import { startTransition, useActionState, useState } from 'react';
import {
  comprasElegidas,
  evaluarFila,
  type Clase,
  type EleccionDeFila,
  type EstadoDeFila,
  type FilaDeGastos,
} from '@/lib/compras/desdeExcel';
import { fechaLegible } from '@/lib/compras/fechas';
import { LIBRO_DEMASIADO_GRANDE, TAMANO_MAXIMO_DEL_LIBRO } from '@/lib/compras/limites';
import {
  FORMAS_DE_PAGO,
  TIPOS_DE_BIENES_Y_SERVICIOS,
  type Compra,
  type FormaPago,
  type TipoBienesServicios,
} from '@/lib/compras/tipos';
import { conMiles } from '@/lib/formato';
import type { Modo } from '@/lib/storage';
import emision from '../emision.module.css';
import { Campo, SIN_RESPUESTA } from '../partes';
import {
  guardarComprasDelLibro,
  leerLibroDeGastos,
  type ResultadoDeGuardarDelLibro,
  type ResultadoDeLeerElLibro,
} from './acciones';
import estilos from './compras.module.css';

type LibroLeido = Extract<ResultadoDeLeerElLibro, { leido: true }>;
type Guardado = Extract<ResultadoDeGuardarDelLibro, { guardado: true }>;

// Un monto que el libro no dejó leer llega vacío.
const monto = (valor: string) => (valor === '' ? '—' : conMiles(valor));
const formaElegida = (valor: string) => (valor === '' ? undefined : (valor as FormaPago));

export function ImportarLibro({ periodo, modo }: { periodo: string; modo: Modo }) {
  // Cada lectura monta una vista previa nueva, sin las elecciones de la anterior.
  const [lecturas, setLecturas] = useState(0);
  const [libro, setLibro] = useState<LibroLeido | null>(null);
  const [resultado, leer, leyendo] = useActionState<ResultadoDeLeerElLibro | null, FormData>(
    async (_anterior, datos) => {
      // Un archivo de más no llega a la acción: Next la rechaza antes, sin decir por qué.
      const archivo = datos.get('libro');
      if (archivo instanceof File && archivo.size > TAMANO_MAXIMO_DEL_LIBRO) {
        return { leido: false, errores: [LIBRO_DEMASIADO_GRANDE] };
      }
      try {
        const nuevo = await leerLibroDeGastos(datos);
        if (nuevo.leido) {
          setLibro(nuevo);
          setLecturas((cuenta) => cuenta + 1);
        }
        return nuevo;
      } catch {
        return { leido: false, errores: [SIN_RESPUESTA] };
      }
    },
    null
  );
  const enDemostracion = modo === 'demostracion';

  return (
    <>
      <form
        onSubmit={(evento) => {
          evento.preventDefault();
          const datos = new FormData(evento.currentTarget);
          startTransition(() => leer(datos));
        }}
        className={estilos.importar}
      >
        <label htmlFor="libro-de-gastos" className={emision.etiqueta}>
          Libro de gastos (.xlsx)
        </label>
        <input
          id="libro-de-gastos"
          type="file"
          name="libro"
          accept=".xlsx"
          required
          disabled={enDemostracion}
          aria-describedby={enDemostracion ? 'libro-de-gastos-ayuda' : undefined}
        />
        <input type="hidden" name="periodo" value={periodo} />
        <button type="submit" disabled={enDemostracion || leyendo} className={estilos.secundario}>
          {leyendo ? 'Leyendo…' : 'Leer el libro'}
        </button>
        {enDemostracion && (
          <p id="libro-de-gastos-ayuda" className={`${emision.ayuda} ${estilos.resultadoDeImportar}`}>
            Solo en modo local: en la demostración, lo que se guarda lo ve cualquiera que entre, y un
            libro real mostraría proveedores y montos.
          </p>
        )}
        <div aria-live="polite" className={estilos.resultadoDeImportar}>
          {resultado?.leido === false && (
            <div className={emision.fallido}>
              <h3>No se pudo leer el libro</h3>
              <ul>
                {resultado.errores.map((error, indice) => (
                  <li key={indice}>{error}</li>
                ))}
              </ul>
              <p>No se anotó nada.</p>
            </div>
          )}
        </div>
      </form>
      {libro && <VistaPrevia key={lecturas} libro={libro} />}
    </>
  );
}

function VistaPrevia({ libro }: { libro: LibroLeido }) {
  const { hojas, propuesta } = libro.lectura;
  const [hoja, setHoja] = useState(propuesta);
  const [formaGeneral, setFormaGeneral] = useState<FormaPago | undefined>(undefined);
  const [elecciones, setElecciones] = useState<Record<number, EleccionDeFila>>({});
  const [guardado, guardar, guardando] = useActionState<ResultadoDeGuardarDelLibro | null, Compra[]>(
    async (_anterior, compras) => {
      try {
        return await guardarComprasDelLibro(compras);
      } catch {
        return { guardado: false, errores: [SIN_RESPUESTA] };
      }
    },
    null
  );

  if (guardado?.guardado === true) return <Resumen guardado={guardado} />;
  const actual = hojas[hoja];
  if (actual === undefined) return <p className={emision.ayuda}>El libro no tiene hojas.</p>;

  const opciones = { rncDelNegocio: libro.rncDelNegocio, formaGeneral };
  const estados = actual.filas.map((fila) => evaluarFila(fila, elecciones[fila.fila] ?? {}, opciones));
  const compras = comprasElegidas(actual.filas, elecciones, opciones);
  const cuantas = (...cuales: EstadoDeFila['estado'][]) =>
    estados.filter(({ estado }) => cuales.includes(estado)).length;
  const elegir = (fila: number, cambios: EleccionDeFila) =>
    setElecciones((antes) => ({ ...antes, [fila]: { ...antes[fila], ...cambios } }));

  return (
    <section aria-labelledby="titulo-del-libro" className={estilos.vistaPrevia}>
      <h3 id="titulo-del-libro" className={estilos.tituloDelLibro}>
        Compras del libro
      </h3>
      <div className={emision.campos}>
        <Campo id="hoja-del-libro" etiqueta="Hoja" codigo="Una por mes">
          <select
            id="hoja-del-libro"
            value={hoja}
            onChange={(evento) => {
              setHoja(Number(evento.target.value));
              setElecciones({});
            }}
            className={emision.entrada}
          >
            {hojas.map((unaHoja, indice) => (
              <option key={indice} value={indice}>
                {unaHoja.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo
          id="forma-del-libro"
          etiqueta="Forma de pago de las demás filas"
          codigo="Casilla 23"
          ayuda="Para las filas sin método de pago cuyo proveedor no tiene compras anotadas."
        >
          <select
            id="forma-del-libro"
            value={formaGeneral ?? ''}
            onChange={(evento) => setFormaGeneral(formaElegida(evento.target.value))}
            aria-describedby="forma-del-libro-ayuda"
            className={emision.entrada}
          >
            <option value="">Sin elegir</option>
            {Object.entries(FORMAS_DE_PAGO).map(([codigo, nombre]) => (
              <option key={codigo} value={codigo}>
                {nombre}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      {actual.motivo ? (
        <p className={emision.ayuda}>{actual.motivo}</p>
      ) : actual.filas.length === 0 ? (
        <p className={emision.ayuda}>Esta hoja no tiene compras con NCF.</p>
      ) : (
        <div className={emision.tablaContenedor}>
          <table className={`${emision.tabla} ${estilos.tablaDelLibro}`}>
            <thead>
              <tr>
                <th scope="col">Anotar</th>
                <th scope="col">Fila</th>
                <th scope="col">Proveedor</th>
                <th scope="col">RNC o cédula</th>
                <th scope="col">NCF</th>
                <th scope="col">Fecha</th>
                <th scope="col" className={emision.derecha}>
                  Monto
                </th>
                <th scope="col" className={emision.derecha}>
                  ITBIS
                </th>
                <th scope="col" className={emision.derecha}>
                  Propina
                </th>
                <th scope="col">Tipo</th>
                <th scope="col">Clase</th>
                <th scope="col">Forma de pago</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {actual.filas.map((fila, indice) => (
                <FilaDelLibro
                  key={fila.fila}
                  fila={fila}
                  eleccion={elecciones[fila.fila] ?? {}}
                  estado={estados[indice]}
                  formaGeneral={formaGeneral}
                  elegir={(cambios) => elegir(fila.fila, cambios)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className={estilos.botones}>
        <button
          type="button"
          onClick={() => startTransition(() => guardar(compras))}
          disabled={compras.length === 0 || guardando}
          className={emision.boton}
        >
          {guardando
            ? 'Guardando…'
            : compras.length === 1
              ? 'Guardar 1 compra'
              : `Guardar ${compras.length} compras`}
        </button>
        <span className={emision.ayuda}>
          {cuantas('lista')} listas · {cuantas('revisaRNC', 'faltaForma')} por revisar ·{' '}
          {cuantas('noVa')} no van
        </span>
      </p>
      <div aria-live="polite">
        {guardado?.guardado === false && (
          <div className={emision.fallido}>
            <h3>No se guardó nada</h3>
            <ul>
              {guardado.errores.map((error, indice) => (
                <li key={indice}>{error}</li>
              ))}
            </ul>
            <p>Vuelve a intentarlo.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function FilaDelLibro({
  fila,
  eleccion,
  estado,
  formaGeneral,
  elegir,
}: {
  fila: FilaDeGastos;
  eleccion: EleccionDeFila;
  estado: EstadoDeFila;
  formaGeneral?: FormaPago;
  elegir: (cambios: EleccionDeFila) => void;
}) {
  const cual = `la fila ${fila.fila}`;
  const lista = estado.estado === 'lista';
  const cedula = fila.revisarRNC?.cedula;
  const rnc = eleccion.rnc === 'cedula' && cedula !== undefined ? cedula : fila.rnc;
  return (
    <tr className={fila.noVa === undefined ? emision.fila : `${emision.fila} ${estilos.filaQueNoVa}`}>
      <td>
        <input
          type="checkbox"
          checked={lista && eleccion.anotar !== false}
          disabled={!lista}
          onChange={(evento) => elegir({ anotar: evento.target.checked })}
          aria-label={`Anotar ${cual}`}
        />
      </td>
      <td className={emision.numeroLinea}>{fila.fila}</td>
      <td>{fila.proveedor}</td>
      <td className={emision.cifra}>{rnc}</td>
      <td className={emision.cifra}>{fila.ncf}</td>
      <td className={emision.cifra}>{fila.fecha === '' ? '—' : fechaLegible(fila.fecha)}</td>
      <td className={emision.monto}>{monto(fila.monto)}</td>
      <td className={emision.monto}>{monto(fila.itbis)}</td>
      <td className={emision.monto}>{fila.propina === '0.00' ? '—' : monto(fila.propina)}</td>
      {fila.noVa === undefined ? (
        <>
          <td>
            <select
              value={eleccion.tipo ?? fila.tipo}
              onChange={(evento) => elegir({ tipo: evento.target.value as TipoBienesServicios })}
              aria-label={`Tipo de bienes y servicios de ${cual}`}
              className={emision.entrada}
            >
              {Object.entries(TIPOS_DE_BIENES_Y_SERVICIOS).map(([codigo, nombre]) => (
                <option key={codigo} value={codigo}>
                  {codigo} · {nombre}
                </option>
              ))}
            </select>
          </td>
          <td>
            <select
              value={eleccion.clase ?? fila.clase}
              onChange={(evento) => elegir({ clase: evento.target.value as Clase })}
              aria-label={`Bienes o servicios en ${cual}`}
              className={emision.entrada}
            >
              <option value="servicios">Servicios</option>
              <option value="bienes">Bienes</option>
            </select>
          </td>
          <td>
            <select
              value={eleccion.forma ?? fila.forma ?? ''}
              onChange={(evento) => elegir({ forma: formaElegida(evento.target.value) })}
              aria-label={`Forma de pago de ${cual}`}
              className={emision.entrada}
            >
              {fila.forma === undefined && (
                <option value="">
                  {formaGeneral === undefined ? 'Sin elegir' : `${FORMAS_DE_PAGO[formaGeneral]} (la de las demás)`}
                </option>
              )}
              {Object.entries(FORMAS_DE_PAGO).map(([codigo, nombre]) => (
                <option key={codigo} value={codigo}>
                  {nombre}
                </option>
              ))}
            </select>
          </td>
        </>
      ) : (
        <td colSpan={3} />
      )}
      <td>
        <EstadoDeLaFila estado={estado} elegir={elegir} />
      </td>
    </tr>
  );
}

function EstadoDeLaFila({
  estado,
  elegir,
}: {
  estado: EstadoDeFila;
  elegir: (cambios: EleccionDeFila) => void;
}) {
  if (estado.estado === 'lista') return <span className={estilos.lista}>Lista</span>;
  if (estado.estado === 'faltaForma') {
    return <span className={estilos.pendiente}>Falta la forma de pago</span>;
  }
  if (estado.estado === 'noVa') {
    return <span className={estilos.noVa}>No va: {estado.motivos.join(' ')}</span>;
  }
  return (
    <span className={estilos.pendiente}>
      {estado.cedula === undefined
        ? 'Revisa el RNC: el dígito verificador no cuadra.'
        : `Revisa el RNC: ¿es la cédula ${estado.cedula}?`}
      <span className={estilos.acciones}>
        {estado.cedula !== undefined && (
          <button type="button" onClick={() => elegir({ rnc: 'cedula' })}>
            Usar la cédula
          </button>
        )}
        <button type="button" onClick={() => elegir({ rnc: 'numero' })}>
          Dejar el número
        </button>
      </span>
    </span>
  );
}

function Resumen({ guardado }: { guardado: Guardado }) {
  return (
    <div aria-live="polite" className={estilos.vistaPrevia}>
      <p className={estilos.aviso}>
        {guardado.guardadas === 1
          ? 'Se guardó 1 compra.'
          : `Se guardaron ${guardado.guardadas} compras.`}{' '}
        Las guardadas ya están en la lista del mes.
      </p>
      {guardado.noGuardadas.length > 0 && (
        <div className={emision.fallido}>
          <h3>No se guardaron</h3>
          <ul>
            {guardado.noGuardadas.map((motivo, indice) => (
              <li key={indice}>{motivo}</li>
            ))}
          </ul>
          <p>Corrígelas en el libro y vuelve a leerlo, o anótalas a mano.</p>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Add the styles**

Append to `app/compras/compras.module.css`:

```css
.vistaPrevia {
  margin: 0 0 2rem;
}

.tituloDelLibro {
  margin: 0 0 1rem;
  font-family: var(--fuente-titulares), Georgia, serif;
  font-size: 1.45rem;
  font-weight: 400;
}

.vistaPrevia > * + * {
  margin-top: 1.4rem;
}

.tablaDelLibro {
  min-width: 90rem;
}

.tablaDelLibro select {
  min-width: 8.5rem;
  font-size: 0.85rem;
}

.filaQueNoVa td {
  color: var(--tinta-tenue);
}

.lista {
  font-weight: 700;
  color: var(--verde);
}

.pendiente {
  font-weight: 700;
  color: var(--azul);
}

.noVa {
  font-size: 0.85rem;
  color: var(--tinta-suave);
}
```

**Step 3: Show it in Compras**

In `app/compras/compras.tsx`:
- Add `import { ImportarLibro } from './importarLibro';` after the import from `./acciones`, and
  `import type { Modo } from '@/lib/storage';` after the import from `@/lib/formato`.
- Add `fechaLegible` to the import from `@/lib/compras/fechas` and delete the file's own
  `fechaLegible` constant. Task 4 moved it to `lib/compras/fechas.ts`.
- Add `modo` to the props of `Compras` (`modo: Modo` in the type).
- Render the workbook import right after the `aviso` paragraph, outside the condition that hides the
  XML import while correcting, so a preview isn't lost when the user corrects a purchase:

```tsx
        <ImportarLibro periodo={periodo} modo={modo} />
```

In `app/compras/page.tsx`, pass the mode:

```tsx
        <Compras
          key={periodo}
          periodo={periodo}
          modo={modoDeEjecucion()}
          lineas={mes.lineas}
          completas={mes.completas}
        />
```

**Step 4: Check types, lint and tests**

Run: `npx next typegen && npx tsc --noEmit && npm run lint && npm test`
Expected: no errors, and every test passes.

**Step 5: Commit**

```bash
git add app/compras/importarLibro.tsx app/compras/compras.tsx app/compras/page.tsx app/compras/compras.module.css
git commit -m "feat(app): import the purchases workbook in Compras, with a preview to review"
```

---

### Task 11: Verificar en el navegador y con el libro real

**Files:** nothing is committed. Temporary files go in the session scratchpad or are deleted at the
end.

**Step 1: A fictitious workbook**

Create `lib/compras/libroFicticio.tmp.test.ts`, run it once, and delete it:

```ts
// Temporal: escribe un libro inventado para probar la página. No se sube.
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { armarLibro } from './libroDePrueba';

const ENCABEZADO = ['Proveedor', 'RNC', 'NCF', 'Fecha', 'ITBS', '10% ley', 'Monto total', 'Concepto', 'Método de pago'];

it('escribe el libro ficticio', () => {
  writeFileSync(
    process.env.LIBRO_FICTICIO ?? '',
    armarLibro([
      {
        nombre: 'Agosto',
        desde: 'E8',
        filas: [ENCABEZADO, ['Ferretería Inventada', 130000001, 'B0100000011', 46240, 90, null, 590]],
      },
      {
        nombre: 'Septiembre',
        desde: 'E8',
        filas: [
          ENCABEZADO,
          ['Ferretería Inventada', { numero: '1.30000001E8' }, 'B0100000001', 46270, 180, null, 1180, null, 'Tarjeta de crédito o débito'],
          ['Restaurante Inventado', 100000004, 'E310000000001', 46271, 180, 100, 1280],
          ['Colmado Inventado', 100000009, 'B0100000002', 46272, null, null, 500, null, 'Efectivo'],
          ['Taller Inventado', 100000000, 'B0100000003', 46273, 90, null, 590, null, 'Efectivo'],
          ['Supermercado Inventado', 130000001, 'B0200000001', 46273, 18, null, 118, null, 'Efectivo'],
          ['Imprenta Inventada', 140000001, 'B0100000005', 46274, 90, null, 590, null, 'Compra a crédito'],
          [null, null, null, null, { formula: 'SUM(I9:I14)', valor: '558' }, null, { formula: 'SUM(K9:K14)', valor: '4258' }],
          ENCABEZADO,
          ['Otra Tabla Inventada', 130000001, 'B0100000006', 46274, 18, null, 118],
        ],
      },
    ])
  );
});
```

Run:

```bash
LIBRO_FICTICIO=<scratchpad>/libro-ficticio.xlsx npx vitest run lib/compras/libroFicticio.tmp.test.ts
rm lib/compras/libroFicticio.tmp.test.ts
base64 -i <scratchpad>/libro-ficticio.xlsx | tr -d '\n' > <scratchpad>/libro-ficticio.b64
```

**Step 2: Local mode with fictitious data**

- Create `datos/emisor.json` in the worktree (ignored by git) with the `emisorDePrueba()` values:
  RNC `123456789`, "Comercial Ejemplo SRL".
- Add a launch configuration for the worktree to the main folder's `.claude/launch.json`, like the
  existing ones: `excel-606-local`, port 3105, no `VERCEL`. Start it with `preview_start`.

**Step 3: Check the page**

Open `http://localhost:3105/compras?periodo=202609`. The browser pane can't pick a file from disk,
so put the fictitious workbook in the file input from the console, then press "Leer el libro":

```js
const bytes = Uint8Array.from(atob('<contents of libro-ficticio.b64>'), (c) => c.charCodeAt(0));
const archivo = new File([bytes], 'libro-ficticio.xlsx');
const transferencia = new DataTransfer();
transferencia.items.add(archivo);
document.querySelector('#libro-de-gastos').files = transferencia.files;
```

Check, reading the page's text rather than screenshots:
- The sheet selector starts on Septiembre, and the table shows rows 9 to 14 only. Row 15 is the totals,
  and the repeated header ends the table.
- Row 9 is "Lista": amount 1,000.00, type 9, services, card.
- Row 10 is "Falta la forma de pago", with amount 1,000.00 and propina 100.00.
- Row 11 is "Revisa el RNC: ¿es la cédula 00100000009?".
- Row 12 is "Revisa el RNC: el dígito verificador no cuadra." with only "Dejar el número".
- Row 13 is "No va", with the consumo invoice message.
- Row 14 is "Lista", a purchase on credit.
- The count line reads "2 listas · 3 por revisar · 1 no van".

Then:
- Pick "Efectivo" as the payment method for the other rows: row 10 becomes "Lista".
- Press "Usar la cédula" on row 11 and "Dejar el número" on row 12: both become "Lista", and row
  11 shows `00100000009`.
- Uncheck row 12. The button reads "Guardar 4 compras".
- Save. The summary says 4 were saved, and "Compras de septiembre de 2026" lists 4 purchases.
- Check `datos/compras/`: row 14's purchase has no `FechaPago`, and row 10's has `PropinaLegal` 100.00.
- Read the workbook again: rows 9, 10, 11 and 14 are "No va: Ya está anotada."; row 12 is still
  "Revisa el RNC".
- Change the sheet to Agosto: its row says it isn't September's.
- Press "Bajar el 606": the page says it downloaded `DGII_F_606_123456789_202609.TXT`, with no errors.

**Step 4: The demo**

Add and start an `excel-606-demostracion` configuration for the worktree (port 3106, `VERCEL=1`). At
`/compras?periodo=202609`, the file input and "Leer el libro" are disabled and the local-only note
shows.

**Step 5: The real workbook, counts only**

Create another temporary test (`lib/compras/libroReal.tmp.test.ts`). It reads
`~/Downloads/DGII Gastos 2026.xlsx` and runs `leerGastos` for 202607 and 202608 with no saved
purchases and no history. It prints only counts: rows read, how many don't go by reason (consumo,
another month, repeated, amount), rows with `revisarRNC`, and rows with a payment method. Delete it
afterwards. Expected, from the structure scan of 2026-09-14:
- 202607: 8 rows, all with a payment method, none that don't go, none to review.
- 202608: 7 rows, one consumo invoice that doesn't go, the rest with a payment method, none to review.

Never print names, RNCs, NCFs, dates or amounts.

**Step 6: Clean up**

- Stop the servers with `preview_stop`.
- Remove the launch configurations you added.
- Delete the worktree's `datos/` folder (fictitious data only) and the scratchpad files.
- Run `git status`: nothing new should be tracked.

---

### Task 12: README y cierre

**Files:**
- Modify: `README.md`

**Step 1: Document the import**

In "Purchases and the 606", after the bullet about received e-CF, add:

```markdown
- Locally, the purchases workbook (.xlsx) fills a month in one go. Pick the
  month's sheet, review each row and save the ones you check.
  - The amount is Monto total less ITBS and 10% ley. The tip goes in its own
    field, as NG 07-2018 asks.
  - Type, goods or services and payment method come from the supplier's last
    purchase. Without one, it's 09, services, and a method you pick.
  - An RNC or cédula that lost its leading zeros in Excel, or whose check digit
    doesn't match, waits for you to confirm it.
  - It isn't in the demo, where anything saved is visible to everyone.
```

**Step 2: Final verification**

Run: `npm test && npx next typegen && npx tsc --noEmit && npm run lint && npm run build`
Expected: every test passes, no type or lint errors, and the build lists `/compras` as dynamic.

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: importing the purchases workbook"
```

**Step 4: Finish the branch**

Use superpowers:finishing-a-development-branch. Gabriel's way (2026-09-14): push the branch and open
a PR; once approved, merge locally with `--no-ff` as Gabbs27, verify on the merged `master`, and push.

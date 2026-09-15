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

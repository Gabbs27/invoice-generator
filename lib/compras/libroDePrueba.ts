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

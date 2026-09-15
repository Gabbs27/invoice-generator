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

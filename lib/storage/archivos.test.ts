import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compraDePrueba } from '../compras/ejemplos';
import { AlmacenamientoEnArchivos } from './archivos';
import { emisorDePrueba, probarContratoDeAlmacenamiento } from './contrato';
import type { Emisor } from './tipos';

const carpetas: string[] = [];

function carpetaDeDatos(emisor: Emisor = emisorDePrueba()): string {
  const directorio = mkdtempSync(join(tmpdir(), 'datos-'));
  carpetas.push(directorio);
  writeFileSync(join(directorio, 'emisor.json'), JSON.stringify(emisor, null, 2));
  return directorio;
}

afterEach(() => {
  for (const directorio of carpetas.splice(0)) rmSync(directorio, { recursive: true, force: true });
});

probarContratoDeAlmacenamiento(
  'en archivos',
  async (emisor) => new AlmacenamientoEnArchivos(carpetaDeDatos(emisor))
);

describe('almacenamiento en archivos', () => {
  it('guarda cada comprobante como facturas/<e-NCF>.xml', async () => {
    const directorio = carpetaDeDatos();
    await new AlmacenamientoEnArchivos(directorio).guardarComprobante('E310000000001', '<ECF/>');
    expect(readFileSync(join(directorio, 'facturas', 'E310000000001.xml'), 'utf8')).toBe('<ECF/>');
  });

  // El sistema de archivos es el índice único: con wx, escribir un archivo que ya existe
  // falla con EEXIST.
  it('rechaza un e-NCF duplicado con EEXIST y deja el original en disco', async () => {
    const directorio = carpetaDeDatos();
    const almacen = new AlmacenamientoEnArchivos(directorio);
    await almacen.guardarComprobante('E310000000001', '<original/>');
    await expect(almacen.guardarComprobante('E310000000001', '<otro/>')).rejects.toThrow(/EEXIST/);
    expect(readFileSync(join(directorio, 'facturas', 'E310000000001.xml'), 'utf8')).toBe(
      '<original/>'
    );
  });

  // Sin contador ni caché: la fuente de verdad es lo que se emitió.
  it('una instancia nueva sobre la misma carpeta sigue la secuencia', async () => {
    const directorio = carpetaDeDatos();
    await new AlmacenamientoEnArchivos(directorio).guardarComprobante('E310000000007', '<a/>');
    expect(await new AlmacenamientoEnArchivos(directorio).proximaSecuencia('31')).toBe(8);
  });

  it('cuenta un comprobante que llegó a la carpeta por fuera de la aplicación', async () => {
    const directorio = carpetaDeDatos();
    mkdirSync(join(directorio, 'facturas'));
    writeFileSync(join(directorio, 'facturas', 'E310000000004.xml'), '<a/>');
    expect(await new AlmacenamientoEnArchivos(directorio).proximaSecuencia('31')).toBe(5);
  });

  it('ignora en facturas/ lo que no es un comprobante', async () => {
    const directorio = carpetaDeDatos();
    mkdirSync(join(directorio, 'facturas'));
    for (const nombre of ['.DS_Store', 'notas.txt', 'E310000000009.xml.bak', 'E31000000001.xml']) {
      writeFileSync(join(directorio, 'facturas', nombre), 'x');
    }
    const almacen = new AlmacenamientoEnArchivos(directorio);
    expect(await almacen.listarComprobantes()).toEqual([]);
    expect(await almacen.proximaSecuencia('31')).toBe(1);
  });

  // El e-NCF llega de afuera y termina en una ruta: no puede salirse de facturas/.
  it('no lee fuera de facturas/ con un e-NCF inventado', async () => {
    const directorio = carpetaDeDatos();
    await expect(
      new AlmacenamientoEnArchivos(directorio).leerComprobante('../emisor')
    ).rejects.toThrow(/e-NCF/);
  });

  it('lee emisor.json en cada consulta: un rango nuevo no pide reiniciar', async () => {
    const directorio = carpetaDeDatos(emisorDePrueba(3));
    const almacen = new AlmacenamientoEnArchivos(directorio);
    await almacen.guardarComprobante('E310000000003', '<a/>');
    await expect(almacen.proximaSecuencia('31')).rejects.toThrow(/rango autorizado/i);
    writeFileSync(join(directorio, 'emisor.json'), JSON.stringify(emisorDePrueba(10)));
    expect(await almacen.proximaSecuencia('31')).toBe(4);
  });

  it('dice qué falta cuando no hay emisor.json', async () => {
    const directorio = mkdtempSync(join(tmpdir(), 'datos-'));
    carpetas.push(directorio);
    await expect(new AlmacenamientoEnArchivos(directorio).leerEmisor()).rejects.toThrow(
      /emisor\.json.*rangos autorizados/
    );
  });
});

describe('compras en archivos', () => {
  it('guarda cada compra como compras/<RNC>_<NCF>.json, con su XML al lado', async () => {
    const directorio = carpetaDeDatos();
    await new AlmacenamientoEnArchivos(directorio).guardarCompra(compraDePrueba(), '<ECF/>');
    const compras = join(directorio, 'compras');
    expect(JSON.parse(readFileSync(join(compras, '987654321_B0100000123.json'), 'utf8'))).toEqual(
      compraDePrueba()
    );
    expect(readFileSync(join(compras, '987654321_B0100000123.xml'), 'utf8')).toBe('<ECF/>');
  });

  it('borra la compra y su XML', async () => {
    const directorio = carpetaDeDatos();
    const almacen = new AlmacenamientoEnArchivos(directorio);
    await almacen.guardarCompra(compraDePrueba(), '<ECF/>');
    await almacen.borrarCompra('987654321_B0100000123');
    expect(existsSync(join(directorio, 'compras', '987654321_B0100000123.json'))).toBe(false);
    expect(existsSync(join(directorio, 'compras', '987654321_B0100000123.xml'))).toBe(false);
  });

  it('ignora en compras/ lo que no es una compra', async () => {
    const directorio = carpetaDeDatos();
    mkdirSync(join(directorio, 'compras'));
    for (const nombre of ['.DS_Store', 'notas.json', '987654321_B0100000123.json.bak']) {
      writeFileSync(join(directorio, 'compras', nombre), '{}');
    }
    expect(await new AlmacenamientoEnArchivos(directorio).listarCompras()).toEqual([]);
  });
});

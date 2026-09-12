import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AlmacenamientoEnArchivos } from './archivos';
import { emisorDePrueba } from './contrato';
import { AlmacenamientoEnMemoria } from './memoria';
import {
  CLAVE_DEL_PROCESO,
  EMISOR_DE_DEMOSTRACION,
  crearAlmacenamiento,
  modoDeEjecucion,
} from './index';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  // El almacenamiento del proceso vive en globalThis: cada prueba empieza sin él.
  delete (globalThis as Record<string, unknown>)[CLAVE_DEL_PROCESO];
});

describe('almacenamiento según el entorno', () => {
  // Vercel define VERCEL=1, y su disco es efímero: guardar archivos ahí parecería
  // funcionar y perdería todo.
  it('en Vercel es una demostración', () => {
    expect(modoDeEjecucion({ VERCEL: '1' })).toBe('demostracion');
  });

  it('fuera de Vercel es local', () => {
    expect(modoDeEjecucion({})).toBe('local');
  });

  it('la demostración guarda en memoria, con un emisor que no es de nadie', async () => {
    const almacen = crearAlmacenamiento('demostracion');
    expect(almacen).toBeInstanceOf(AlmacenamientoEnMemoria);
    expect(await almacen.leerEmisor()).toEqual(EMISOR_DE_DEMOSTRACION);
    expect(EMISOR_DE_DEMOSTRACION.RazonSocialEmisor).toMatch(/sin valor fiscal/);
  });

  it('en local guarda en la carpeta de datos', async () => {
    const directorio = mkdtempSync(join(tmpdir(), 'datos-'));
    try {
      writeFileSync(join(directorio, 'emisor.json'), JSON.stringify(emisorDePrueba()));
      const almacen = crearAlmacenamiento('local', directorio);
      expect(almacen).toBeInstanceOf(AlmacenamientoEnArchivos);
      expect(await almacen.leerEmisor()).toEqual(emisorDePrueba());
    } finally {
      rmSync(directorio, { recursive: true, force: true });
    }
  });

  // En memoria, lo emitido tiene que durar de una petición a la siguiente.
  it('entrega el mismo almacenamiento a todo el proceso', async () => {
    vi.stubEnv('VERCEL', '1');
    const { obtenerAlmacenamiento } = await import('./index');
    const primero = obtenerAlmacenamiento();
    await primero.guardarComprobante('E320000000001', '<a/>');
    expect(obtenerAlmacenamiento()).toBe(primero);
    expect(await obtenerAlmacenamiento().proximaSecuencia('32')).toBe(2);
  });

  // Next carga cada ruta con su propia copia de los módulos: la ruta que imprime el PDF tiene
  // que ver lo que guardó la página que emite.
  it('entrega el mismo almacenamiento aunque el módulo se cargue otra vez', async () => {
    vi.stubEnv('VERCEL', '1');
    const pagina = await import('./index');
    await pagina.obtenerAlmacenamiento().guardarComprobante('E320000000001', '<a/>');
    vi.resetModules();
    const ruta = await import('./index');
    expect(ruta).not.toBe(pagina);
    expect(await ruta.obtenerAlmacenamiento().leerComprobante('E320000000001')).toBe('<a/>');
  });
});

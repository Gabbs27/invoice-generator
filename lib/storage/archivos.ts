import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { esENCFValido, parsearENCF } from '../ecf/encf';
import type { TipoECF } from '../ecf/tipos';
import { comprobarQueSePuedeGuardar, siguienteSecuencia } from './secuencias';
import type { Almacenamiento, Emisor } from './tipos';

const codigo = (error: unknown) => (error as NodeJS.ErrnoException).code;

// La carpeta es la base de datos: datos/emisor.json, y un XML por comprobante en
// datos/facturas/<e-NCF>.xml, tal como se emitió.
export class AlmacenamientoEnArchivos implements Almacenamiento {
  private readonly directorio: string;
  private readonly facturas: string;

  constructor(directorio: string) {
    this.directorio = directorio;
    this.facturas = join(directorio, 'facturas');
  }

  // Se lee en cada consulta: un rango nuevo en emisor.json no pide reiniciar.
  async leerEmisor(): Promise<Emisor> {
    const ruta = join(this.directorio, 'emisor.json');
    let texto: string;
    try {
      texto = await readFile(ruta, 'utf8');
    } catch (error) {
      throw new Error(
        `No se pudo leer ${ruta}: ahí van el RNC, la razón social y los rangos autorizados.`,
        { cause: error }
      );
    }
    return JSON.parse(texto) as Emisor;
  }

  private async emitidos(): Promise<string[]> {
    let nombres: string[];
    try {
      nombres = await readdir(this.facturas);
    } catch (error) {
      if (codigo(error) === 'ENOENT') return [];
      throw error;
    }
    return nombres
      .filter((nombre) => nombre.endsWith('.xml') && esENCFValido(nombre.slice(0, -4)))
      .map((nombre) => nombre.slice(0, -4));
  }

  async proximaSecuencia(tipo: TipoECF): Promise<number> {
    return siguienteSecuencia(await this.leerEmisor(), tipo, await this.emitidos());
  }

  async guardarComprobante(encf: string, xml: string): Promise<void> {
    comprobarQueSePuedeGuardar(await this.leerEmisor(), encf);
    await mkdir(this.facturas, { recursive: true });
    try {
      // wx falla con EEXIST si el archivo ya existe: el sistema de archivos es el índice
      // único, y un duplicado explota en vez de pasar callado.
      await writeFile(join(this.facturas, `${encf}.xml`), xml, { flag: 'wx' });
    } catch (error) {
      if (codigo(error) === 'EEXIST') {
        throw new Error(`e-NCF duplicado: ${encf} ya se emitió (EEXIST).`, { cause: error });
      }
      throw error;
    }
  }

  async leerComprobante(encf: string): Promise<string> {
    // El e-NCF termina en una ruta: si no es un e-NCF, no se toca el disco.
    parsearENCF(encf);
    try {
      return await readFile(join(this.facturas, `${encf}.xml`), 'utf8');
    } catch (error) {
      if (codigo(error) === 'ENOENT') {
        throw new Error(`No hay un comprobante ${encf}.`, { cause: error });
      }
      throw error;
    }
  }

  async listarComprobantes(tipo?: TipoECF): Promise<string[]> {
    return (await this.emitidos())
      .filter((encf) => tipo === undefined || parsearENCF(encf).tipo === tipo)
      .sort();
  }
}

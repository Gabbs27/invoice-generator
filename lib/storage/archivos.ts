import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { claveDeCompra, esClaveDeCompra, exigirClaveDeCompra, type Compra } from '../compras/tipos';
import { esENCFValido, parsearENCF } from '../ecf/encf';
import type { TipoECF } from '../ecf/tipos';
import { comprobarQueSePuedeGuardar, siguienteSecuencia } from './secuencias';
import type { Almacenamiento, Emisor } from './tipos';

const codigo = (error: unknown) => (error as NodeJS.ErrnoException).code;

// La carpeta es la base de datos: datos/emisor.json, un XML por comprobante en
// datos/facturas/<e-NCF>.xml, tal como se emitió, y una compra por archivo en
// datos/compras/<RNC>_<NCF>.json.
export class AlmacenamientoEnArchivos implements Almacenamiento {
  private readonly directorio: string;
  private readonly facturas: string;
  private readonly compras: string;

  constructor(directorio: string) {
    this.directorio = directorio;
    this.facturas = join(directorio, 'facturas');
    this.compras = join(directorio, 'compras');
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

  async guardarCompra(compra: Compra, xml?: string): Promise<void> {
    const clave = exigirClaveDeCompra(claveDeCompra(compra));
    await mkdir(this.compras, { recursive: true });
    const ruta = join(this.compras, `${clave}.json`);
    try {
      // wx: el JSON de la compra es el índice único, como el XML de las facturas.
      await writeFile(ruta, `${JSON.stringify(compra, null, 2)}\n`, { flag: 'wx' });
    } catch (error) {
      if (codigo(error) === 'EEXIST') {
        throw new Error(
          `Compra duplicada: ${compra.NCF} de ${compra.RNCCedula} ya está anotada (EEXIST).`,
          { cause: error }
        );
      }
      throw error;
    }
    if (xml === undefined) return;
    try {
      await writeFile(join(this.compras, `${clave}.xml`), xml);
    } catch (error) {
      // Una compra importada no queda sin su XML: se deshace.
      await rm(ruta, { force: true });
      throw error;
    }
  }

  async reemplazarCompra(compra: Compra): Promise<void> {
    const clave = exigirClaveDeCompra(claveDeCompra(compra));
    const ruta = join(this.compras, `${clave}.json`);
    try {
      await access(ruta);
    } catch (error) {
      if (codigo(error) === 'ENOENT') throw new Error(`No hay una compra ${clave}.`, { cause: error });
      throw error;
    }
    // Se escribe aparte y se renombra: si algo corta la escritura, la compra anterior queda entera.
    const temporal = `${ruta}.tmp`;
    await writeFile(temporal, `${JSON.stringify(compra, null, 2)}\n`);
    await rename(temporal, ruta);
  }

  async borrarCompra(clave: string): Promise<void> {
    exigirClaveDeCompra(clave);
    try {
      await rm(join(this.compras, `${clave}.json`));
    } catch (error) {
      if (codigo(error) === 'ENOENT') throw new Error(`No hay una compra ${clave}.`, { cause: error });
      throw error;
    }
    await rm(join(this.compras, `${clave}.xml`), { force: true });
  }

  async listarCompras(): Promise<Compra[]> {
    let nombres: string[];
    try {
      nombres = await readdir(this.compras);
    } catch (error) {
      if (codigo(error) === 'ENOENT') return [];
      throw error;
    }
    const claves = nombres
      .filter((nombre) => nombre.endsWith('.json') && esClaveDeCompra(nombre.slice(0, -5)))
      .map((nombre) => nombre.slice(0, -5))
      .sort();
    return Promise.all(
      claves.map(async (clave) => {
        const ruta = join(this.compras, `${clave}.json`);
        try {
          return JSON.parse(await readFile(ruta, 'utf8')) as Compra;
        } catch (error) {
          throw new Error(`No se pudo leer ${ruta}: ${(error as Error).message}`, { cause: error });
        }
      })
    );
  }
}

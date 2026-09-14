import { claveDeCompra, exigirClaveDeCompra, type Compra } from '../compras/tipos';
import { parsearENCF } from '../ecf/encf';
import type { TipoECF } from '../ecf/tipos';
import { comprobarQueSePuedeGuardar, siguienteSecuencia } from './secuencias';
import type { Almacenamiento, Emisor } from './tipos';

// Para la demostración en Vercel: todo vive en el proceso y se pierde al reiniciar.
export class AlmacenamientoEnMemoria implements Almacenamiento {
  private readonly emisor: Emisor;
  private readonly comprobantes = new Map<string, string>();
  private readonly compras = new Map<string, { compra: Compra; xml?: string }>();

  constructor(emisor: Emisor) {
    this.emisor = structuredClone(emisor);
  }

  async leerEmisor(): Promise<Emisor> {
    return structuredClone(this.emisor);
  }

  async proximaSecuencia(tipo: TipoECF): Promise<number> {
    return siguienteSecuencia(this.emisor, tipo, [...this.comprobantes.keys()]);
  }

  async guardarComprobante(encf: string, xml: string): Promise<void> {
    comprobarQueSePuedeGuardar(this.emisor, encf);
    // Comprobar y escribir van en el mismo tick, sin un await en medio: de dos guardados
    // simultáneos del mismo e-NCF pasa uno solo.
    if (this.comprobantes.has(encf)) throw new Error(`e-NCF duplicado: ${encf} ya se emitió.`);
    this.comprobantes.set(encf, xml);
  }

  async leerComprobante(encf: string): Promise<string> {
    const xml = this.comprobantes.get(encf);
    if (xml === undefined) throw new Error(`No hay un comprobante ${encf}.`);
    return xml;
  }

  async listarComprobantes(tipo?: TipoECF): Promise<string[]> {
    return [...this.comprobantes.keys()]
      .filter((encf) => tipo === undefined || parsearENCF(encf).tipo === tipo)
      .sort();
  }

  async guardarCompra(compra: Compra, xml?: string): Promise<void> {
    const clave = exigirClaveDeCompra(claveDeCompra(compra));
    // Comprobar y escribir en el mismo tick, como con los comprobantes.
    if (this.compras.has(clave)) {
      throw new Error(`Compra duplicada: ${compra.NCF} de ${compra.RNCCedula} ya está anotada.`);
    }
    this.compras.set(clave, { compra: structuredClone(compra), xml });
  }

  async reemplazarCompra(compra: Compra): Promise<void> {
    const clave = exigirClaveDeCompra(claveDeCompra(compra));
    const guardada = this.compras.get(clave);
    if (guardada === undefined) throw new Error(`No hay una compra ${clave}.`);
    this.compras.set(clave, { ...guardada, compra: structuredClone(compra) });
  }

  async borrarCompra(clave: string): Promise<void> {
    exigirClaveDeCompra(clave);
    if (!this.compras.delete(clave)) throw new Error(`No hay una compra ${clave}.`);
  }

  async listarCompras(): Promise<Compra[]> {
    return [...this.compras.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, { compra }]) => structuredClone(compra));
  }
}

import { parsearENCF } from '../ecf/encf';
import type { TipoECF } from '../ecf/tipos';
import { comprobarQueSePuedeGuardar, siguienteSecuencia } from './secuencias';
import type { Almacenamiento, Emisor } from './tipos';

// Para la demostración en Vercel: todo vive en el proceso y se pierde al reiniciar.
export class AlmacenamientoEnMemoria implements Almacenamiento {
  private readonly emisor: Emisor;
  private readonly comprobantes = new Map<string, string>();

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
}

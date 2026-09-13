import type { Compra } from '../compras/tipos';
import type { TipoECF } from '../ecf/tipos';

// Un rango de secuencias autorizado para un tipo de e-CF, con la fecha de vencimiento
// que el tipo 31 declara en FechaVencimientoSecuencia (Formato e-CF, pág. 6).
export interface RangoAutorizado {
  desde: number;
  hasta: number;
  FechaVencimientoSecuencia: string;
}

export interface Emisor {
  RNCEmisor: string;
  RazonSocialEmisor: string;
  DireccionEmisor: string;
  rangos: Partial<Record<TipoECF, RangoAutorizado>>;
}

export interface Almacenamiento {
  leerEmisor(): Promise<Emisor>;
  proximaSecuencia(tipo: TipoECF): Promise<number>;
  guardarComprobante(encf: string, xml: string): Promise<void>;
  leerComprobante(encf: string): Promise<string>;
  listarComprobantes(tipo?: TipoECF): Promise<string[]>;
  // Compras para el 606. La llave es el proveedor y el NCF (claveDeCompra).
  guardarCompra(compra: Compra, xml?: string): Promise<void>;
  reemplazarCompra(compra: Compra): Promise<void>;
  borrarCompra(clave: string): Promise<void>;
  listarCompras(): Promise<Compra[]>;
}

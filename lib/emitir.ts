import { construirENCF } from './ecf/encf';
import { firmarECF, type Credencial } from './ecf/firma';
import { validarContraXSD } from './ecf/validar';
import { construirXML, type Comprobante, type ItemComprobante } from './ecf/xml';
import type { Almacenamiento } from './storage/tipos';

// Lo que llega del formulario. El emisor, el e-NCF y las fechas los pone el flujo.
export interface SolicitudDeEmision {
  tipo: '31' | '32';
  IndicadorMontoGravado: Comprobante['IndicadorMontoGravado'];
  TipoIngresos: Comprobante['TipoIngresos'];
  TipoPago: Comprobante['TipoPago'];
  FechaLimitePago?: Comprobante['FechaLimitePago'];
  Comprador?: Comprobante['Comprador'];
  Items: ItemComprobante[];
}

export interface Dependencias {
  almacenamiento: Almacenamiento;
  // Se pide al emitir: en local lee el .p12, y si falta no se consume nada.
  credencial: () => Credencial | Promise<Credencial>;
  leerEsquema: (tipo: string) => string;
  ahora?: () => Date;
}

export type ResultadoDeEmision =
  | { emitido: true; eNCF: string; xml: string }
  | { emitido: false; errores: string[] };

const INTENTOS = 3;

// Formato e-CF, pág. 58: FechaHoraFirma va en GMT-4, y República Dominicana no cambia de
// hora durante el año. Se trunca al segundo, así nunca queda después del momento de firmar.
export function fechaHoraRD(instante: Date): { fecha: string; fechaHora: string } {
  const rd = new Date(instante.getTime() - 4 * 60 * 60 * 1000);
  const dos = (numero: number) => String(numero).padStart(2, '0');
  const fecha = `${dos(rd.getUTCDate())}-${dos(rd.getUTCMonth() + 1)}-${rd.getUTCFullYear()}`;
  const hora = `${dos(rd.getUTCHours())}:${dos(rd.getUTCMinutes())}:${dos(rd.getUTCSeconds())}`;
  return { fecha, fechaHora: `${fecha} ${hora}` };
}

// Armar, firmar, validar y guardar, en ese orden: el XSD exige la firma, así que la
// validación no puede ir antes. Nada se escribe si el XML no valida, y la secuencia sale de
// lo escrito, así que un intento fallido no consume número.
export async function emitirECF(
  solicitud: SolicitudDeEmision,
  dependencias: Dependencias
): Promise<ResultadoDeEmision> {
  const { almacenamiento, credencial, leerEsquema, ahora = () => new Date() } = dependencias;
  try {
    if (solicitud.tipo !== '31' && solicitud.tipo !== '32') {
      throw new Error(`Esta versión emite facturas 31 y 32, no ${String(solicitud.tipo)}.`);
    }
    const emisor = await almacenamiento.leerEmisor();
    const credencialDeFirma = await credencial();

    for (let intento = 1; ; intento++) {
      const secuencia = await almacenamiento.proximaSecuencia(solicitud.tipo);
      const eNCF = construirENCF(solicitud.tipo, secuencia);
      const { fecha, fechaHora } = fechaHoraRD(ahora());
      const xml = construirXML({
        eNCF,
        FechaVencimientoSecuencia:
          solicitud.tipo === '31' ? emisor.rangos['31']?.FechaVencimientoSecuencia : undefined,
        IndicadorMontoGravado: solicitud.IndicadorMontoGravado,
        TipoIngresos: solicitud.TipoIngresos,
        TipoPago: solicitud.TipoPago,
        FechaLimitePago: solicitud.FechaLimitePago,
        Emisor: {
          RNCEmisor: emisor.RNCEmisor,
          RazonSocialEmisor: emisor.RazonSocialEmisor,
          DireccionEmisor: emisor.DireccionEmisor,
          FechaEmision: fecha,
        },
        Comprador: solicitud.Comprador,
        Items: solicitud.Items,
        FechaHoraFirma: fechaHora,
      });
      const firmado = firmarECF(xml, credencialDeFirma);
      const validacion = await validarContraXSD(firmado, leerEsquema(solicitud.tipo));
      if (!validacion.valido) return { emitido: false, errores: validacion.errores };

      try {
        await almacenamiento.guardarComprobante(eNCF, firmado);
        return { emitido: true, eNCF, xml: firmado };
      } catch (error) {
        // El contrato de Almacenamiento promete "duplicado" cuando otra emisión guardó ese
        // e-NCF primero: entonces se pide el número siguiente.
        if (intento < INTENTOS && /duplicad/i.test((error as Error).message)) continue;
        throw error;
      }
    }
  } catch (error) {
    return { emitido: false, errores: [(error as Error).message] };
  }
}

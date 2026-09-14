import { desdeElNavegador } from './fechas';
import type { Compra, FormaPago, TipoBienesServicios, TipoRetencionISR } from './tipos';

// Lo que recibe una Server Action es texto y puede venir de cualquiera. Aquí solo se leen los
// campos: las reglas del 606 las aplica validarCompra.

function texto(datos: FormData, nombre: string): string {
  const valor = datos.get(nombre);
  return typeof valor === 'string' ? valor.trim() : '';
}

const OPCIONALES = [
  'ITBISRetenido',
  'ITBISProporcionalidad',
  'ITBISCosto',
  'TipoRetencionISR',
  'MontoRetencionRenta',
  'ImpuestoSelectivo',
  'OtrosImpuestos',
  'PropinaLegal',
] as const;

export function leerCompraDelFormulario(datos: FormData): Compra {
  const fecha = (nombre: string, campo: string): string | undefined => {
    const valor = texto(datos, nombre);
    if (valor === '') return undefined;
    try {
      return desdeElNavegador(valor);
    } catch {
      throw new Error(`${campo} inválida: ${valor}.`);
    }
  };
  const FechaComprobante = fecha('FechaComprobante', 'Fecha del comprobante');
  if (FechaComprobante === undefined) throw new Error('Falta la fecha del comprobante.');
  // Un monto obligatorio vacío es cero.
  const monto = (nombre: string) => texto(datos, nombre) || '0';

  const compra: Compra = {
    // El RNC y la cédula se escriben con guiones; el 606 los lleva solo con dígitos.
    RNCCedula: texto(datos, 'RNCCedula').replace(/[\s-]/g, ''),
    TipoBienesServicios: texto(datos, 'TipoBienesServicios') as TipoBienesServicios,
    NCF: texto(datos, 'NCF').toUpperCase(),
    FechaComprobante,
    MontoServicios: monto('MontoServicios'),
    MontoBienes: monto('MontoBienes'),
    ITBISFacturado: monto('ITBISFacturado'),
    FormaPago: texto(datos, 'FormaPago') as FormaPago,
  };
  const NCFModificado = texto(datos, 'NCFModificado').toUpperCase();
  if (NCFModificado !== '') compra.NCFModificado = NCFModificado;
  const FechaPago = fecha('FechaPago', 'Fecha de pago');
  if (FechaPago !== undefined) compra.FechaPago = FechaPago;
  for (const campo of OPCIONALES) {
    const valor = texto(datos, campo);
    if (valor === '') continue;
    if (campo === 'TipoRetencionISR') compra.TipoRetencionISR = valor as TipoRetencionISR;
    else compra[campo] = valor;
  }
  return compra;
}

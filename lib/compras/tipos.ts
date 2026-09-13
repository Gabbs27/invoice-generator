// Códigos y nombres del instructivo del Formato de Envío 606 (febrero de 2026): casilla 3, tipo de
// bienes y servicios; casilla 17, tipo de retención en ISR; casilla 23, forma de pago.
export const TIPOS_DE_BIENES_Y_SERVICIOS = {
  '1': 'Gastos de personal',
  '2': 'Gastos por trabajos, suministros y servicios',
  '3': 'Arrendamientos',
  '4': 'Gastos de activos fijos',
  '5': 'Gastos de representación',
  '6': 'Otras deducciones admitidas',
  '7': 'Gastos financieros',
  '8': 'Gastos extraordinarios',
  '9': 'Compras y gastos que formarán parte del costo de venta',
  '10': 'Adquisiciones de activos',
  '11': 'Gastos de seguros',
} as const;

export const TIPOS_DE_RETENCION_ISR = {
  '1': 'Alquileres',
  '2': 'Honorarios por servicios',
  '3': 'Otras rentas',
  '4': 'Otras rentas (rentas presuntas)',
  '5': 'Intereses pagados a personas jurídicas residentes',
  '6': 'Intereses pagados a personas físicas residentes',
  '7': 'Retención por proveedores del Estado',
  '8': 'Juegos telefónicos',
  '9': 'Retenciones subsector de ganadería de carne bovina',
} as const;

export const FORMAS_DE_PAGO = {
  '1': 'Efectivo',
  '2': 'Cheques, transferencias o depósito',
  '3': 'Tarjeta de crédito o débito',
  '4': 'Compra a crédito',
  '5': 'Permuta',
  '6': 'Notas de crédito',
  '7': 'Mixto',
} as const;

export type TipoBienesServicios = keyof typeof TIPOS_DE_BIENES_Y_SERVICIOS;
export type TipoRetencionISR = keyof typeof TIPOS_DE_RETENCION_ISR;
export type FormaPago = keyof typeof FORMAS_DE_PAGO;

export const esCodigo = <T extends string>(tabla: Record<T, string>, valor: string): valor is T =>
  Object.hasOwn(tabla, valor);

// Una compra con las casillas del 606 que se anotan. Los montos van como texto decimal y las
// fechas AAAAMMDD, como en el archivo. El total, el ITBIS por adelantar y las dos percepciones no
// se guardan: el archivo los calcula o los deja vacíos.
export interface Compra {
  RNCCedula: string;
  TipoBienesServicios: TipoBienesServicios;
  NCF: string;
  NCFModificado?: string;
  FechaComprobante: string;
  FechaPago?: string;
  MontoServicios: string;
  MontoBienes: string;
  ITBISFacturado: string;
  ITBISRetenido?: string;
  ITBISProporcionalidad?: string;
  ITBISCosto?: string;
  TipoRetencionISR?: TipoRetencionISR;
  MontoRetencionRenta?: string;
  ImpuestoSelectivo?: string;
  OtrosImpuestos?: string;
  PropinaLegal?: string;
  FormaPago: FormaPago;
}

// El proveedor y el NCF son la llave: la DGII marca como error el mismo NCF de un proveedor
// reportado dos veces.
export const claveDeCompra = ({ RNCCedula, NCF }: Pick<Compra, 'RNCCedula' | 'NCF'>): string =>
  `${RNCCedula}_${NCF}`;

// La clave termina en un nombre de archivo: solo el RNC o la cédula, un guion bajo y un NCF.
export const esClaveDeCompra = (valor: string): boolean =>
  typeof valor === 'string' && /^(\d{9}|\d{11})_(B\d{10}|E\d{12})$/.test(valor);

export function exigirClaveDeCompra(clave: string): string {
  if (!esClaveDeCompra(clave)) {
    throw new Error(
      `Clave de compra inválida: ${clave}. Es el RNC o la cédula, un guion bajo y el NCF.`
    );
  }
  return clave;
}

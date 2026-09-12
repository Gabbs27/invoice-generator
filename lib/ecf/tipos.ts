export const TIPOS_ECF = {
  '31': 'Factura de Crédito Fiscal Electrónica',
  '32': 'Factura de Consumo Electrónica',
  '33': 'Nota de Débito Electrónica',
  '34': 'Nota de Crédito Electrónica',
  '41': 'Comprobante Electrónico de Compras',
  '43': 'Comprobante Electrónico para Gastos Menores',
  '44': 'Comprobante Electrónico para Regímenes Especiales',
  '45': 'Comprobante Electrónico Gubernamental',
  '46': 'Comprobante Electrónico para Exportaciones',
  '47': 'Comprobante Electrónico para Pagos al Exterior',
} as const;

export type TipoECF = keyof typeof TIPOS_ECF;

export const esTipoValido = (t: string): t is TipoECF => Object.hasOwn(TIPOS_ECF, t);
export const nombreTipo = (t: TipoECF): string => TIPOS_ECF[t];

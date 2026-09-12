export type TipoIdentificacion = 'RNC' | 'cedula';

// El formato es el de RNCValidationType en los XSD de DGII: [0-9]{11}|[0-9]{9}.
// Ningún documento de DGII en esquemas/docs/ define un dígito verificador, así
// que aquí no se calcula uno.
export function tipoIdentificacion(valor: string): TipoIdentificacion | null {
  if (typeof valor !== 'string') return null;
  if (/^\d{9}$/.test(valor)) return 'RNC';
  if (/^\d{11}$/.test(valor)) return 'cedula';
  return null;
}

export const esIdentificacionValida = (valor: string): boolean =>
  tipoIdentificacion(valor) !== null;

// NG 07-2018, Anexo A: los montos del 606 son N 12 con punto decimal, así que con dos decimales
// caben nueve enteros. Como en lib/ecf/calculo.ts, se cuenta en centavos para no pasar nunca
// por punto flotante.
const MONTO = /^\d{1,9}(\.\d{1,2})?$/;

export const esMonto = (valor: string): boolean => typeof valor === 'string' && MONTO.test(valor);

export function aCentavos(valor: string, campo: string): bigint {
  if (!esMonto(valor)) {
    throw new Error(`${campo} inválido: ${valor}. Hasta 9 enteros y 2 decimales, con punto.`);
  }
  const [enteros, fraccion = ''] = valor.split('.');
  return BigInt(enteros + fraccion.padEnd(2, '0'));
}

export function aMonto(centavos: bigint): string {
  const digitos = centavos.toString().padStart(3, '0');
  return `${digitos.slice(0, -2)}.${digitos.slice(-2)}`;
}

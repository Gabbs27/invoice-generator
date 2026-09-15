import type { FormaPago } from './tipos';
import type { Celda } from './xlsx';

// Del libro de gastos a compras del 606: lo que dice cada fila y lo que falta revisar. No lee
// archivos, así que también corre en la página, para la vista previa.

const CERO = BigInt(0);
const UNO = BigInt(1);
const CIEN = BigInt(100);

// Las etiquetas se comparan sin mayúsculas, tildes ni espacios: "Método de pago" es metododepago.
export const normalizar = (texto: string): string =>
  texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '');

// Un número como lo guarda Excel en el XML ('1234.5', '-12', '1.30000001E8') a centavos, con la
// mitad hacia arriba y sin pasar por punto flotante.
export function centavosDeExcel(valor: string): bigint | undefined {
  const partes = valor.trim().match(/^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
  if (partes === null) return undefined;
  const [, signo, enteros, fraccion = '', exponente = '0'] = partes;
  const digitos = enteros + fraccion;
  if (digitos === '') return undefined;
  // Dónde queda el punto después de multiplicar por 100.
  const punto = enteros.length + Number(exponente) + 2;
  let centavos: bigint;
  let siguiente: number;
  if (punto <= 0) {
    centavos = CERO;
    siguiente = punto === 0 ? Number(digitos[0]) : 0;
  } else if (punto >= digitos.length) {
    centavos = BigInt(digitos.padEnd(punto, '0'));
    siguiente = 0;
  } else {
    centavos = BigInt(digitos.slice(0, punto));
    siguiente = Number(digitos[punto]);
  }
  if (siguiente >= 5) centavos += UNO;
  return signo === '-' ? -centavos : centavos;
}

// Una celda de monto vacía vale cero. Un texto que no está en blanco no es un monto.
export function montoDeLaCelda(celda: Celda | undefined): bigint | undefined {
  if (celda === undefined) return CERO;
  if (celda.tipo === 'texto') return celda.valor.trim() === '' ? CERO : undefined;
  return centavosDeExcel(celda.valor);
}

// Los dígitos del RNC o la cédula. Como número llega sin guiones, pero en notación científica si
// es largo; como texto puede traer espacios y guiones. Lo que no es un entero va tal cual, y
// validarCompra dice por qué no sirve.
export function digitosDeExcel(celda: Celda | undefined): string {
  if (celda === undefined) return '';
  if (celda.tipo === 'texto') return celda.valor.replace(/[\s-]/g, '');
  const centavos = centavosDeExcel(celda.valor);
  return centavos !== undefined && centavos >= CERO && centavos % CIEN === CERO
    ? (centavos / CIEN).toString()
    : celda.valor;
}

// Excel cuenta los días desde el 30 de diciembre de 1899. Así cuadra desde marzo de 1900, después
// del 29 de febrero de 1900 que Excel cuenta y que no existió. Con fechas de 1904 cuenta desde el
// 1 de enero de 1904. La fracción es la hora, que no cuenta.
const EPOCA_1900 = Date.UTC(1899, 11, 30);
const EPOCA_1904 = Date.UTC(1904, 0, 1);
const UN_DIA = 86_400_000;

export function fechaDeExcel(celda: Celda | undefined, fechas1904: boolean): string | undefined {
  if (celda?.tipo !== 'numero') return undefined;
  const dias = Number(celda.valor);
  if (!Number.isFinite(dias) || dias < 1) return undefined;
  const fecha = new Date((fechas1904 ? EPOCA_1904 : EPOCA_1900) + Math.floor(dias) * UN_DIA);
  const dos = (numero: number) => String(numero).padStart(2, '0');
  return `${fecha.getUTCFullYear()}${dos(fecha.getUTCMonth() + 1)}${dos(fecha.getUTCDate())}`;
}

// Por palabras y en este orden: "Tarjeta de crédito" y "Notas de crédito" también dicen crédito.
const FORMAS_POR_PALABRA: [string, FormaPago][] = [
  ['nota', '6'],
  ['tarjeta', '3'],
  ['mixto', '7'],
  ['permuta', '5'],
  ['efectivo', '1'],
  ['cheque', '2'],
  ['transferencia', '2'],
  ['deposito', '2'],
  ['credito', '4'],
];

export function formaDePagoDelTexto(texto: string): FormaPago | undefined {
  const normalizado = normalizar(texto);
  return FORMAS_POR_PALABRA.find(([palabra]) => normalizado.includes(palabra))?.[1];
}

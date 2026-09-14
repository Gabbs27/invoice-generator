export type IndicadorFacturacion = 1 | 2 | 3 | 4;

// Los campos llevan los nombres del XSD. Los montos van como texto decimal, igual
// que en el XML, para no pasar nunca por punto flotante.
export interface Linea {
  CantidadItem: string;
  PrecioUnitarioItem: string;
  IndicadorFacturacion: IndicadorFacturacion;
  DescuentoMonto?: string;
  RecargoMonto?: string;
}

export interface TasasITBIS {
  ITBIS1: number;
  ITBIS2: number;
  ITBIS3: number;
}

// Las tasas con que el Formato e-CF describe ITBIS1, ITBIS2 e ITBIS3 (págs. 20–21).
// El XML las declara y la ley las puede cambiar, así que entran como parámetro.
export const TASAS_ITBIS: TasasITBIS = { ITBIS1: 18, ITBIS2: 16, ITBIS3: 0 };

export interface OpcionesTotales {
  // Formato e-CF, pág. 7: 1 si los montos de las líneas incluyen el ITBIS.
  IndicadorMontoGravado: 0 | 1;
  tasas?: TasasITBIS;
}

export interface Totales {
  MontoGravadoTotal?: string;
  MontoGravadoI1?: string;
  MontoGravadoI2?: string;
  MontoGravadoI3?: string;
  MontoExento?: string;
  ITBIS1?: number;
  ITBIS2?: number;
  ITBIS3?: number;
  TotalITBIS?: string;
  TotalITBIS1?: string;
  TotalITBIS2?: string;
  TotalITBIS3?: string;
  MontoTotal: string;
}

const CERO = BigInt(0);
const DOS = BigInt(2);
const CIEN = BigInt(100);
const DIEZ_MIL = BigInt(10_000);
const INDICADORES_GRAVADOS = [1, 2, 3] as const;

// '1.5' con dos decimales es 150n.
function aEntero(valor: string, decimales: number, campo: string): bigint {
  const patron = new RegExp(`^\\d{1,16}(\\.\\d{1,${decimales}})?$`);
  if (typeof valor !== 'string' || !patron.test(valor)) {
    throw new Error(
      `${campo} inválido: ${valor}. Se esperan hasta 16 enteros y ${decimales} decimales.`
    );
  }
  const [enteros, fraccion = ''] = valor.split('.');
  return BigInt(enteros + fraccion.padEnd(decimales, '0'));
}

// Informe Técnico, pág. 22: si el tercer decimal es 5 o más, sube el segundo. Solo
// para valores no negativos, que son los únicos que el XSD admite en estos montos.
function dividirRedondeando(numerador: bigint, divisor: bigint): bigint {
  return (numerador * DOS + divisor) / (divisor * DOS);
}

function aTexto(centavos: bigint): string {
  const digitos = centavos.toString().padStart(3, '0');
  return `${digitos.slice(0, -2)}.${digitos.slice(-2)}`;
}

function validarTasa(tasa: number, campo: string): void {
  if (!Number.isInteger(tasa) || tasa < 0 || tasa > 99) {
    throw new Error(`${campo} inválido: ${tasa}. Es un entero de uno o dos dígitos.`);
  }
}

// Formato e-CF, pág. 44: (Precio Unitario del ítem * Cantidad) – Monto Descuento + Monto Recargo.
function montoItemEnCentavos(linea: Linea): bigint {
  const cantidad = aEntero(linea.CantidadItem, 2, 'CantidadItem');
  if (cantidad === CERO) throw new Error('CantidadItem tiene que ser mayor que cero.');
  const precio = aEntero(linea.PrecioUnitarioItem, 4, 'PrecioUnitarioItem');
  const descuento =
    linea.DescuentoMonto === undefined ? CERO : aEntero(linea.DescuentoMonto, 2, 'DescuentoMonto');
  const recargo =
    linea.RecargoMonto === undefined ? CERO : aEntero(linea.RecargoMonto, 2, 'RecargoMonto');

  // Diezmilésimas por centésimas dan millonésimas; se redondea a centavos, y el
  // descuento y el recargo ya vienen en centavos.
  const monto = dividirRedondeando(precio * cantidad, DIEZ_MIL) - descuento + recargo;
  if (monto < CERO) {
    throw new Error(`El descuento de ${linea.DescuentoMonto} deja negativo el MontoItem.`);
  }
  return monto;
}

export function calcularMontoItem(linea: Linea): string {
  return aTexto(montoItemEnCentavos(linea));
}

// Formato e-CF, págs. 18–21 y 25: el ITBIS sale del monto gravado de cada tasa, no
// de cada línea.
export function calcularTotales(lineas: Linea[], opciones: OpcionesTotales): Totales {
  if (lineas.length === 0) throw new Error('Un e-CF lleva al menos un ítem.');
  const tasas = opciones.tasas ?? TASAS_ITBIS;
  const porcentajes = { 1: tasas.ITBIS1, 2: tasas.ITBIS2, 3: tasas.ITBIS3 };
  for (const i of INDICADORES_GRAVADOS) validarTasa(porcentajes[i], `ITBIS${i}`);

  const sumas = new Map<IndicadorFacturacion, bigint>();
  for (const linea of lineas) {
    const indicador = linea.IndicadorFacturacion;
    if ((indicador as number) === 0) {
      throw new Error('IndicadorFacturacion 0 (no facturable) no está soportado en esta versión.');
    }
    if (![1, 2, 3, 4].includes(indicador)) {
      throw new Error(`IndicadorFacturacion inválido: ${indicador}.`);
    }
    sumas.set(indicador, (sumas.get(indicador) ?? CERO) + montoItemEnCentavos(linea));
  }

  const gravadas = INDICADORES_GRAVADOS.flatMap((i) => {
    const suma = sumas.get(i);
    if (suma === undefined) return [];
    const tasa = BigInt(porcentajes[i]);
    // Con ITBIS incluido, el monto gravado es la suma entre (1 + tasa) (pág. 19).
    const gravado =
      opciones.IndicadorMontoGravado === 1 ? dividirRedondeando(suma * CIEN, CIEN + tasa) : suma;
    return [{ i, gravado, itbis: dividirRedondeando(gravado * tasa, CIEN) }];
  });
  const exento = sumas.get(4);
  const gravadoTotal = gravadas.reduce((total, t) => total + t.gravado, CERO);
  const itbisTotal = gravadas.reduce((total, t) => total + t.itbis, CERO);

  // En el orden del XSD. Los campos de una tasa que ningún ítem usa se omiten: DGII
  // los marca condicionales.
  const totales: Partial<Totales> = {};
  if (gravadas.length > 0) totales.MontoGravadoTotal = aTexto(gravadoTotal);
  for (const t of gravadas) totales[`MontoGravadoI${t.i}` as const] = aTexto(t.gravado);
  if (exento !== undefined) totales.MontoExento = aTexto(exento);
  for (const t of gravadas) totales[`ITBIS${t.i}` as const] = porcentajes[t.i];
  if (gravadas.length > 0) totales.TotalITBIS = aTexto(itbisTotal);
  for (const t of gravadas) totales[`TotalITBIS${t.i}` as const] = aTexto(t.itbis);

  return { ...totales, MontoTotal: aTexto(gravadoTotal + (exento ?? CERO) + itbisTotal) };
}

// Formato e-CF, pág. 25 y nota 30: la nota de crédito no puede pasar del total del
// e-CF modificado, tampoco sumada a las notas anteriores contra ese mismo e-CF.
export function validarNotaCredito({
  MontoTotalNota,
  MontoTotalModificado,
  MontoNotasAnteriores = '0',
}: {
  MontoTotalNota: string;
  MontoTotalModificado: string;
  MontoNotasAnteriores?: string;
}): void {
  const nota = aEntero(MontoTotalNota, 2, 'MontoTotal de la nota');
  const anteriores = aEntero(MontoNotasAnteriores, 2, 'Monto de las notas anteriores');
  const modificado = aEntero(MontoTotalModificado, 2, 'MontoTotal del e-CF modificado');
  const notas = nota + anteriores;
  if (notas > modificado) {
    throw new Error(
      `Las notas de crédito suman ${aTexto(notas)} y el e-CF modificado es de ${aTexto(modificado)}.`
    );
  }
}

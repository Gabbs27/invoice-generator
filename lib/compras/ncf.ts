// Instructivo del 606, casilla 4: NCF de 11 posiciones (serie B) o de 13 (e-CF, Aviso 24 de abril de
// 2019). Los tipos son los que acepta la expresión regular de la herramienta 606 de la DGII
// (strRegexNcf), menos las facturas de consumo y E42, que no es un tipo de e-CF.
const TIPOS_B: readonly string[] = ['01', '03', '04', '11', '12', '13', '14', '15', '17'];
const TIPOS_E: readonly string[] = ['31', '33', '34', '41', '43', '44', '45', '47'];
const NOTAS: readonly string[] = ['B03', 'B04', 'E33', 'E34'];
// Los comprobantes que emite quien compra, que en la casilla 1 llevan su propio RNC: gastos
// menores (la herramienta 606 lo revisa en B13) y pagos al exterior (el instructivo del 606 lo pide
// en B17).
const EMITIDOS_POR_QUIEN_COMPRA: Readonly<Record<string, string>> = {
  B13: 'gastos menores',
  E43: 'gastos menores',
  B17: 'pagos al exterior',
  E47: 'pagos al exterior',
};
// NG 06-2018: la factura de consumo es la que se emite para el consumidor final; la de crédito
// fiscal, la que tiene valor fiscal.
const CONSUMO: readonly string[] = ['B02', 'E32'];

export type LecturaDeNCF = { valido: true; esNota: boolean } | { valido: false; motivo: string };

export const tieneFormaDeNCF = (valor: string): boolean =>
  typeof valor === 'string' && /^(B\d{10}|E\d{12})$/.test(valor);

export function leerNCFDeCompra(ncf: string): LecturaDeNCF {
  if (!tieneFormaDeNCF(ncf)) {
    return {
      valido: false,
      motivo: `NCF inválido: ${ncf}. Es de serie B con 11 caracteres (B0100000001) o un e-NCF de 13 (E310000000001).`,
    };
  }
  const serieYTipo = ncf.slice(0, 3);
  if (CONSUMO.includes(serieYTipo)) {
    return { valido: false, motivo: `${ncf} es una factura de consumo: no va en el 606.` };
  }
  const tipos = ncf[0] === 'B' ? TIPOS_B : TIPOS_E;
  if (!tipos.includes(ncf.slice(1, 3))) {
    return { valido: false, motivo: `${ncf}: el 606 no admite comprobantes ${serieYTipo}.` };
  }
  return { valido: true, esNota: NOTAS.includes(serieYTipo) };
}

// El nombre del comprobante, si lo emite quien compra.
export function emitidoPorQuienCompra(ncf: string): string | undefined {
  const serieYTipo = ncf.slice(0, 3);
  return Object.hasOwn(EMITIDOS_POR_QUIEN_COMPRA, serieYTipo)
    ? EMITIDOS_POR_QUIEN_COMPRA[serieYTipo]
    : undefined;
}

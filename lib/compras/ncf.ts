// Instructivo del 606, casilla 4: NCF de 11 posiciones (serie B) o de 13 (e-CF, Aviso 24 de abril de
// 2019). Los tipos admitidos están pendientes de confirmar con la herramienta 606 o el
// pre-validador de la DGII (docs/plans/2026-09-13-dgii-606-design.md, "Pendiente de confirmar").
const TIPOS_B: readonly string[] = ['01', '03', '04', '11', '13', '14', '15', '16', '17'];
const TIPOS_E: readonly string[] = ['31', '33', '34', '41', '43', '44', '45', '46', '47'];
const NOTAS: readonly string[] = ['B03', 'B04', 'E33', 'E34'];
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

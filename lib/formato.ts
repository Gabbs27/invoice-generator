// '1234567.50' → '1,234,567.50'. Trabaja sobre el texto, sin pasar por punto flotante, y los
// decimales quedan como vinieron.
export function conMiles(monto: string): string {
  const [enteros, decimales] = monto.split('.');
  const agrupados = enteros.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimales === undefined ? agrupados : `${agrupados}.${decimales}`;
}

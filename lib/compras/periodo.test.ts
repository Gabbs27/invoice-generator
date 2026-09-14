import { describe, it, expect } from 'vitest';
import { compraDePrueba } from './ejemplos';
import { comprasDelPeriodo } from './periodo';

describe('qué entra en el 606 de un mes', () => {
  it('lleva las compras con comprobante del mes', () => {
    const septiembre = compraDePrueba();
    const octubre = compraDePrueba({ NCF: 'B0100000124', FechaComprobante: '20261002' });
    expect(comprasDelPeriodo([septiembre, octubre], '202609')).toEqual([septiembre]);
  });

  it('deja la fecha de pago y las retenciones si se pagó dentro del mes', () => {
    const compra = compraDePrueba({ FechaPago: '20260930', ITBISRetenido: '54.00' });
    expect(comprasDelPeriodo([compra], '202609')).toEqual([compra]);
  });

  it('quita el pago y las retenciones si se pagó después del mes', () => {
    const compra = compraDePrueba({
      FechaPago: '20261005',
      ITBISRetenido: '54.00',
      TipoRetencionISR: '2',
      MontoRetencionRenta: '100.00',
    });
    expect(comprasDelPeriodo([compra], '202609')).toEqual([compraDePrueba()]);
  });

  // Instructivo del 606: el NCF se reenvía en el mes del pago, con su fecha original.
  it('reenvía en el mes del pago una compra anterior con retención', () => {
    const compra = compraDePrueba({
      FechaComprobante: '20260825',
      FechaPago: '20260910',
      ITBISRetenido: '54.00',
    });
    expect(comprasDelPeriodo([compra], '202608')).toEqual([
      compraDePrueba({ FechaComprobante: '20260825' }),
    ]);
    expect(comprasDelPeriodo([compra], '202609')).toEqual([compra]);
  });

  it('no reenvía una compra anterior pagada sin retenciones', () => {
    const compra = compraDePrueba({ FechaComprobante: '20260825', FechaPago: '20260910' });
    expect(comprasDelPeriodo([compra], '202609')).toEqual([]);
  });

  it('ordena por fecha del comprobante, proveedor y NCF', () => {
    const c = compraDePrueba({ FechaComprobante: '20260920' });
    const b = compraDePrueba({ RNCCedula: '123456789', NCF: 'B0100000999' });
    const a = compraDePrueba({ RNCCedula: '123456789', NCF: 'B0100000001' });
    expect(comprasDelPeriodo([c, b, a], '202609')).toEqual([a, b, c]);
  });

  it('rechaza un periodo inválido', () => {
    expect(() => comprasDelPeriodo([], '2026-09')).toThrow(/Periodo inválido/);
  });
});

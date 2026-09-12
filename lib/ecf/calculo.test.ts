import { describe, it, expect } from 'vitest';
import {
  TASAS_ITBIS,
  calcularMontoItem,
  calcularTotales,
  validarNotaCredito,
  type IndicadorFacturacion,
  type Linea,
} from './calculo';

// Las páginas citadas son las impresas del Formato e-CF v1.0 y del Informe Técnico
// e-CF v1.0, en esquemas/docs/.

const linea = (
  PrecioUnitarioItem: string,
  IndicadorFacturacion: IndicadorFacturacion = 1,
  CantidadItem = '1'
): Linea => ({ CantidadItem, PrecioUnitarioItem, IndicadorFacturacion });

describe('MontoItem', () => {
  // Formato, pág. 44: (Precio Unitario del ítem * Cantidad) – Monto Descuento + Monto Recargo.
  it('es precio por cantidad, menos descuento, más recargo', () => {
    const monto = calcularMontoItem({
      CantidadItem: '3',
      PrecioUnitarioItem: '100.50',
      IndicadorFacturacion: 1,
      DescuentoMonto: '1.50',
      RecargoMonto: '0.25',
    });
    expect(monto).toBe('300.25');
  });

  // Informe, pág. 22: dos decimales; si el tercero es 5 o más, sube el segundo.
  it.each([
    ['750.5212', '750.52'],
    ['750.5276', '750.53'],
  ])('redondea %s a %s, como el ejemplo de DGII', (precio, esperado) => {
    expect(calcularMontoItem(linea(precio))).toBe(esperado);
  });

  it('redondea 1.005 a 1.01, donde el punto flotante da 1.00', () => {
    expect(calcularMontoItem(linea('1.005'))).toBe('1.01');
  });

  it('multiplica antes de redondear: 1.2345 × 2.5 = 3.08625', () => {
    expect(calcularMontoItem(linea('1.2345', 1, '2.5'))).toBe('3.09');
  });

  // El control negativo: lo que los tipos del XSD no admiten.
  it.each<[string, Partial<Linea>]>([
    ['cantidad cero', { CantidadItem: '0' }],
    ['cantidad negativa', { CantidadItem: '-1' }],
    ['cantidad con tres decimales', { CantidadItem: '1.005' }],
    ['precio con cinco decimales', { PrecioUnitarioItem: '1.00005' }],
    ['precio en notación científica', { PrecioUnitarioItem: '1e3' }],
    ['precio con coma decimal', { PrecioUnitarioItem: '1,50' }],
    ['descuento con tres decimales', { DescuentoMonto: '0.001' }],
    ['descuento mayor que el monto del ítem', { DescuentoMonto: '200.01' }],
  ])('rechaza %s', (_motivo, cambio) => {
    expect(() => calcularMontoItem({ ...linea('200.00'), ...cambio })).toThrow();
  });
});

describe('totales', () => {
  // Formato, págs. 18–21 y 25: el ITBIS se calcula sobre el monto gravado de cada tasa.
  it('suma por indicador de facturación y calcula el ITBIS de cada tasa', () => {
    const totales = calcularTotales(
      [linea('100.00', 1), linea('50.00', 2), linea('20.00', 3), linea('30.00', 4)],
      { IndicadorMontoGravado: 0 }
    );
    expect(totales).toStrictEqual({
      MontoGravadoTotal: '170.00',
      MontoGravadoI1: '100.00',
      MontoGravadoI2: '50.00',
      MontoGravadoI3: '20.00',
      MontoExento: '30.00',
      ITBIS1: 18,
      ITBIS2: 16,
      ITBIS3: 0,
      TotalITBIS: '26.00',
      TotalITBIS1: '18.00',
      TotalITBIS2: '8.00',
      TotalITBIS3: '0.00',
      MontoTotal: '226.00',
    });
  });

  it('calcula el ITBIS sobre el total gravado, no línea por línea', () => {
    // Línea por línea: 10.03 × 18% = 1.8054 → 1.81, tres veces 5.43.
    // Sobre el total: 30.09 × 18% = 5.4162 → 5.42.
    const totales = calcularTotales(
      [linea('10.03'), linea('10.03'), linea('10.03')],
      { IndicadorMontoGravado: 0 }
    );
    expect(totales.TotalITBIS1).toBe('5.42');
  });

  it('deja los ítems exentos fuera del ITBIS', () => {
    const totales = calcularTotales([linea('100.00', 4)], { IndicadorMontoGravado: 0 });
    expect(totales).toStrictEqual({ MontoExento: '100.00', MontoTotal: '100.00' });
  });

  it('omite los campos de las tasas que ningún ítem usa', () => {
    const totales = calcularTotales([linea('100.00', 1)], { IndicadorMontoGravado: 0 });
    expect(totales).toStrictEqual({
      MontoGravadoTotal: '100.00',
      MontoGravadoI1: '100.00',
      ITBIS1: 18,
      TotalITBIS: '18.00',
      TotalITBIS1: '18.00',
      MontoTotal: '118.00',
    });
  });

  // Formato, pág. 19: con ITBIS incluido, el monto gravado es la suma entre (1 + tasa).
  it('saca el ITBIS incluido con la tasa de cada indicador y no toca los exentos', () => {
    const totales = calcularTotales(
      [linea('118.00', 1), linea('116.00', 2), linea('50.00', 4)],
      { IndicadorMontoGravado: 1 }
    );
    expect(totales).toStrictEqual({
      MontoGravadoTotal: '200.00',
      MontoGravadoI1: '100.00',
      MontoGravadoI2: '100.00',
      MontoExento: '50.00',
      ITBIS1: 18,
      ITBIS2: 16,
      TotalITBIS: '34.00',
      TotalITBIS1: '18.00',
      TotalITBIS2: '16.00',
      MontoTotal: '284.00',
    });
  });

  // Informe, pág. 21: la tolerancia global es de una unidad por línea de detalle.
  it('con ITBIS incluido, el total puede quedar un centavo sobre lo cobrado', () => {
    // 100.00 / 1.18 = 84.7457… → 84.75; 84.75 × 18% = 15.255 → 15.26; total 100.01.
    const totales = calcularTotales([linea('100.00')], { IndicadorMontoGravado: 1 });
    expect(totales.MontoGravadoI1).toBe('84.75');
    expect(totales.TotalITBIS1).toBe('15.26');
    expect(totales.MontoTotal).toBe('100.01');
  });

  it('usa las tasas del Formato si no se le pasan otras', () => {
    expect(TASAS_ITBIS).toEqual({ ITBIS1: 18, ITBIS2: 16, ITBIS3: 0 });
  });

  it('toma las tasas como parámetro', () => {
    const totales = calcularTotales([linea('100.00')], {
      IndicadorMontoGravado: 0,
      tasas: { ...TASAS_ITBIS, ITBIS1: 20 },
    });
    expect(totales.ITBIS1).toBe(20);
    expect(totales.TotalITBIS1).toBe('20.00');
  });

  it.each([18.5, 100, -1])('rechaza la tasa %s: ITBIS1 es un entero de uno o dos dígitos', (tasa) => {
    expect(() =>
      calcularTotales([linea('100.00')], {
        IndicadorMontoGravado: 0,
        tasas: { ...TASAS_ITBIS, ITBIS1: tasa },
      })
    ).toThrow();
  });

  it('rechaza ítems no facturables: esta versión no los soporta', () => {
    const noFacturable = linea('10.00', 0 as unknown as IndicadorFacturacion);
    expect(() => calcularTotales([noFacturable], { IndicadorMontoGravado: 0 })).toThrow(
      /no facturable/i
    );
  });

  it('rechaza un comprobante sin ítems', () => {
    expect(() => calcularTotales([], { IndicadorMontoGravado: 0 })).toThrow();
  });
});

describe('nota de crédito (tipo 34)', () => {
  // Formato, pág. 25 y nota 30: la nota no puede pasar del total del e-CF modificado,
  // tampoco sumada a las notas anteriores contra ese mismo e-CF.
  it('acepta una nota por el total exacto del e-CF modificado', () => {
    expect(() =>
      validarNotaCredito({ MontoTotalNota: '118.00', MontoTotalModificado: '118.00' })
    ).not.toThrow();
  });

  it('rechaza una nota un centavo por encima del e-CF modificado', () => {
    expect(() =>
      validarNotaCredito({ MontoTotalNota: '118.01', MontoTotalModificado: '118.00' })
    ).toThrow();
  });

  it('cuenta las notas anteriores contra el mismo e-CF', () => {
    const base = { MontoTotalNota: '50.00', MontoTotalModificado: '118.00' };
    expect(() => validarNotaCredito({ ...base, MontoNotasAnteriores: '68.00' })).not.toThrow();
    expect(() => validarNotaCredito({ ...base, MontoNotasAnteriores: '68.01' })).toThrow();
  });
});

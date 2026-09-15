import { describe, it, expect } from 'vitest';
import {
  centavosDeExcel,
  digitosDeExcel,
  fechaDeExcel,
  formaDePagoDelTexto,
  historialDeProveedores,
  leerGastos,
  montoDeLaCelda,
  normalizar,
  type Historia,
} from './desdeExcel';
import { compraDePrueba } from './ejemplos';
import { armarLibro, type CeldaDePrueba } from './libroDePrueba';
import type { FormaPago } from './tipos';
import { leerLibro } from './xlsx';

describe('valores de Excel', () => {
  it('normaliza etiquetas sin mayúsculas, tildes ni espacios', () => {
    expect(normalizar(' Método de  pago ')).toBe('metododepago');
    expect(normalizar('10% ley')).toBe('10%ley');
    expect(normalizar('SEPTIEMBRE')).toBe('septiembre');
  });

  // En el XML, Excel guarda los dígitos que hagan falta, a veces en notación científica.
  it('lleva un número de Excel a centavos, con la mitad hacia arriba', () => {
    expect(centavosDeExcel('1234.5')).toBe(BigInt(123450));
    expect(centavosDeExcel('212.39999999999998')).toBe(BigInt(21240));
    expect(centavosDeExcel('1.30000001E8')).toBe(BigInt(13000000100));
    expect(centavosDeExcel('0.005')).toBe(BigInt(1));
    expect(centavosDeExcel('5E-3')).toBe(BigInt(1));
    expect(centavosDeExcel('2.5E-3')).toBe(BigInt(0));
    expect(centavosDeExcel('-12')).toBe(BigInt(-1200));
    for (const valor of ['', 'abc', '1e', '1,234.50']) {
      expect(centavosDeExcel(valor)).toBeUndefined();
    }
  });

  it('lee un monto: vacío es cero y un texto no se lee', () => {
    expect(montoDeLaCelda(undefined)).toBe(BigInt(0));
    expect(montoDeLaCelda({ tipo: 'texto', valor: '  ' })).toBe(BigInt(0));
    expect(montoDeLaCelda({ tipo: 'numero', valor: '118' })).toBe(BigInt(11800));
    expect(montoDeLaCelda({ tipo: 'texto', valor: 'RD$118' })).toBeUndefined();
  });

  it('saca los dígitos del RNC, venga como número o como texto', () => {
    expect(digitosDeExcel({ tipo: 'numero', valor: '1.30000001E8' })).toBe('130000001');
    expect(digitosDeExcel({ tipo: 'texto', valor: '1-30-00000-1' })).toBe('130000001');
    expect(digitosDeExcel({ tipo: 'texto', valor: '001 0000000 9' })).toBe('00100000009');
    expect(digitosDeExcel({ tipo: 'numero', valor: '130000001.5' })).toBe('130000001.5');
    expect(digitosDeExcel(undefined)).toBe('');
  });

  // 46270 es el 5 de septiembre de 2026 contando desde 1900, y 44808 contando desde 1904.
  it('lleva una fecha de Excel a AAAAMMDD', () => {
    expect(fechaDeExcel({ tipo: 'numero', valor: '46270' }, false)).toBe('20260905');
    expect(fechaDeExcel({ tipo: 'numero', valor: '46270.75' }, false)).toBe('20260905');
    expect(fechaDeExcel({ tipo: 'numero', valor: '44808' }, true)).toBe('20260905');
    expect(fechaDeExcel({ tipo: 'texto', valor: '05/09/2026' }, false)).toBeUndefined();
    expect(fechaDeExcel(undefined, false)).toBeUndefined();
  });

  it('reconoce la forma de pago por su nombre', () => {
    expect(formaDePagoDelTexto('Efectivo')).toBe('1');
    expect(formaDePagoDelTexto('Cheques/Transferencias/Depósito')).toBe('2');
    expect(formaDePagoDelTexto('03 - TARJETA CRÉDITO/DÉBITO')).toBe('3');
    expect(formaDePagoDelTexto('Compra a crédito')).toBe('4');
    expect(formaDePagoDelTexto('Permuta')).toBe('5');
    expect(formaDePagoDelTexto('Notas de crédito')).toBe('6');
    expect(formaDePagoDelTexto('Mixto')).toBe('7');
    expect(formaDePagoDelTexto('')).toBeUndefined();
    expect(formaDePagoDelTexto('Pagado')).toBeUndefined();
  });
});

describe('historial de proveedores', () => {
  it('toma el tipo, la clase y la forma de pago de la compra más reciente de cada proveedor', () => {
    const historial = historialDeProveedores([
      compraDePrueba({ RNCCedula: '130000001', FechaComprobante: '20260805' }),
      compraDePrueba({
        RNCCedula: '130000001',
        NCF: 'B0100000124',
        FechaComprobante: '20260812',
        TipoBienesServicios: '9',
        MontoServicios: '0.00',
        MontoBienes: '500.00',
        FormaPago: '3',
      }),
      compraDePrueba({ RNCCedula: '100000004', FechaComprobante: '20260701' }),
    ]);
    expect(historial).toEqual({
      '130000001': { tipo: '9', clase: 'bienes', forma: '3' },
      '100000004': { tipo: '2', clase: 'servicios', forma: '1' },
    });
  });

  // Un archivo de datos/compras editado a mano puede traer códigos que no existen.
  it('no toma una compra con códigos que no existen', () => {
    const historial = historialDeProveedores([
      compraDePrueba({ RNCCedula: '130000001', FechaComprobante: '20260805' }),
      compraDePrueba({
        RNCCedula: '130000001',
        NCF: 'B0100000124',
        FechaComprobante: '20260812',
        FormaPago: '8' as FormaPago,
      }),
    ]);
    expect(historial['130000001']).toEqual({ tipo: '2', clase: 'servicios', forma: '1' });
  });
});

const ENCABEZADO: CeldaDePrueba[] = [
  'Proveedor',
  'RNC',
  'NCF',
  'Fecha',
  'ITBS',
  '10% ley',
  'Monto total',
  'Concepto',
  'Método de pago',
];

// Como en el libro de referencia, la tabla empieza en E8. Los proveedores y los números son
// inventados. Fechas de Excel: 46270 es el 5 de septiembre de 2026 y cada día suma uno; 45910 es
// el 10 de septiembre de 2025 y 46240, el 6 de agosto de 2026.
const SEPTIEMBRE: CeldaDePrueba[][] = [
  ENCABEZADO,
  ['Ferretería Inventada', { numero: '1.30000001E8' }, 'B0100000001', 46270, 180, null, 1180,
    'Clavos', 'Tarjeta de crédito o débito'],
  ['Restaurante Inventado', 100000004, 'E310000000001', 46271, 180, 100, 1280, 'Almuerzo'],
  ['Colmado Inventado', 100000009, 'B0100000002', 46272, null, null, 500, null, 'Efectivo'],
  ['Taller Inventado', 100000000, 'B0100000003', 46273, 90, null, 590],
  ['Supermercado Inventado', 130000001, 'B0200000001', 46273, 18, null, 118, null, 'Efectivo'],
  ['Ferretería Inventada', 130000001, 'B0100000004', 45910, 180, null, 1180],
  ['Ferretería Inventada', 130000001, 'B0100000009', 46274, 18, null, 118],
  ['Ferretería Inventada', 130000001, 'B0100000001', 46270, 180, null, 1180],
  ['Imprenta Inventada', 140000001, 'B0100000005', 46274, 180, null, 180, null, 'Cheque'],
  // Los totales y la lista de métodos de pago no son compras.
  [null, null, null, null, { formula: 'SUM(I9:I17)', valor: '1026' }, null,
    { formula: 'SUM(K9:K17)', valor: '6326' }],
  [null, null, null, null, null, null, null, null, 'Efectivo'],
  // Debajo empieza otra tabla, que no se lee.
  ENCABEZADO,
  ['Otra Tabla Inventada', 130000001, 'B0100000006', 46274, 18, null, 118],
];

const LIBRO = leerLibro(
  armarLibro([
    {
      // Otras columnas, en otro orden y en otro lugar.
      nombre: 'Agosto',
      desde: 'B3',
      filas: [
        ['NCF', 'Monto total', 'Fecha', 'ITBS', 'RNC', 'Proveedor'],
        ['B0100000007', 590, 46240, 90, 100000004, 'Restaurante Inventado'],
      ],
    },
    { nombre: 'Septiembre', desde: 'E8', filas: SEPTIEMBRE },
    { nombre: 'Notas', filas: [['Pendientes de pago'], ['Llamar al contador']] },
    { nombre: 'Octubre', filas: [['Proveedor', 'RNC', 'NCF', 'ITBS', 'Monto total']] },
  ])
);

const historial: Record<string, Historia> = {
  '100000004': { tipo: '2', clase: 'bienes', forma: '2' },
};
const contexto = { periodo: '202609', anotadas: new Set(['130000001_B0100000009']), historial };

describe('leer las hojas de gastos', () => {
  const lectura = leerGastos(LIBRO, contexto);
  const [agosto, septiembre, notas, octubre] = lectura.hojas;
  const fila = (numero: number) => septiembre.filas.find((leida) => leida.fila === numero);

  it('propone la hoja del mes que se ve en Compras, o la primera', () => {
    expect(lectura.hojas.map((hoja) => hoja.nombre)).toEqual(['Agosto', 'Septiembre', 'Notas', 'Octubre']);
    expect(lectura.propuesta).toBe(1);
    expect(leerGastos(LIBRO, { ...contexto, periodo: '202612' }).propuesta).toBe(0);
  });

  it('salta las filas sin NCF y termina la tabla en el encabezado repetido', () => {
    expect(septiembre.filas.map((leida) => leida.fila)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it('lee una compra con el tipo 09 y servicios si el proveedor no tiene historial', () => {
    expect(fila(9)).toEqual({
      fila: 9,
      proveedor: 'Ferretería Inventada',
      rnc: '130000001',
      ncf: 'B0100000001',
      fecha: '20260905',
      monto: '1000.00',
      itbis: '180.00',
      propina: '0.00',
      tipo: '9',
      clase: 'servicios',
      forma: '3',
    });
  });

  // NG 07-2018: el monto facturado va sin ITBIS ni propina legal.
  it('saca el ITBIS y la propina del monto, y usa el historial del proveedor', () => {
    expect(fila(10)).toMatchObject({
      monto: '1000.00',
      itbis: '180.00',
      propina: '100.00',
      tipo: '2',
      clase: 'bienes',
      forma: '2',
    });
    expect(fila(10)?.revisarRNC).toBeUndefined();
  });

  it('propone la cédula de un número que perdió los ceros y marca un RNC dudoso', () => {
    expect(fila(11)).toMatchObject({ rnc: '100000009', itbis: '0.00', monto: '500.00', forma: '1' });
    expect(fila(11)?.revisarRNC).toEqual({ cedula: '00100000009' });
    expect(fila(12)?.revisarRNC).toEqual({});
    expect(fila(12)?.forma).toBeUndefined();
  });

  it('dice por qué no va cada fila que no va', () => {
    expect(fila(13)?.noVa).toMatch(/factura de consumo/);
    expect(fila(14)?.noVa).toBe('Es del 10/09/2025, no de septiembre de 2026.');
    expect(fila(15)?.noVa).toBe('Ya está anotada.');
    expect(fila(16)?.noVa).toBe('Repite la fila 9.');
    expect(fila(17)?.noVa).toMatch(/cero o negativo/);
    expect([9, 10, 11, 12].map((numero) => fila(numero)?.noVa)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('encuentra las columnas en otro orden', () => {
    expect(agosto.filas).toEqual([
      {
        fila: 4,
        proveedor: 'Restaurante Inventado',
        rnc: '100000004',
        ncf: 'B0100000007',
        fecha: '20260806',
        monto: '500.00',
        itbis: '90.00',
        propina: '0.00',
        tipo: '2',
        clase: 'bienes',
        forma: '2',
        noVa: 'Es del 06/08/2026, no de septiembre de 2026.',
      },
    ]);
  });

  it('dice por qué una hoja no tiene filas', () => {
    expect(notas).toEqual({
      nombre: 'Notas',
      motivo: 'No tiene una fila de encabezado con RNC y NCF.',
      filas: [],
    });
    expect(octubre).toEqual({
      nombre: 'Octubre',
      motivo: 'Al encabezado de la fila 1 le falta: Fecha.',
      filas: [],
    });
  });
});

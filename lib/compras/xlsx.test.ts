import { describe, it, expect } from 'vitest';
import { armarLibro, armarZip } from './libroDePrueba';
import { leerLibro } from './xlsx';

const texto = (valor: string) => ({ tipo: 'texto', valor });
const numero = (valor: string) => ({ tipo: 'numero', valor });

describe('leer un libro .xlsx', () => {
  it('lee las hojas en orden, con texto compartido, números y el valor de las fórmulas', () => {
    const libro = leerLibro(
      armarLibro([
        {
          nombre: 'Enero',
          desde: 'E8',
          filas: [
            ['Proveedor', 'RNC'],
            ['Ferretería Inventada', { numero: '1.30000001E8' }],
            [null, { formula: 'SUM(F9:F9)', valor: '130000001' }],
          ],
        },
        { nombre: 'Febrero', filas: [[{ enLinea: 'Texto en línea' }, 46270]] },
      ])
    );
    expect(libro.fechas1904).toBe(false);
    expect(libro.hojas.map((hoja) => hoja.nombre)).toEqual(['Enero', 'Febrero']);
    const [enero, febrero] = libro.hojas;
    expect(enero.filas.map((fila) => fila.numero)).toEqual([8, 9, 10]);
    expect(enero.filas[0].celdas[4]).toEqual(texto('Proveedor'));
    expect(enero.filas[1].celdas[5]).toEqual(numero('1.30000001E8'));
    expect(enero.filas[2].celdas[4]).toBeUndefined();
    expect(enero.filas[2].celdas[5]).toEqual(numero('130000001'));
    expect(febrero.filas[0].celdas).toEqual([texto('Texto en línea'), numero('46270')]);
  });

  it('dice si el libro cuenta las fechas desde 1904', () => {
    const libro = armarLibro([{ nombre: 'Enero', filas: [] }], { fechas1904: true });
    expect(leerLibro(libro).fechas1904).toBe(true);
  });

  // Excel escribe rutas relativas a xl/ y elementos sin prefijo, pero no todos los programas.
  it('sigue rutas absolutas y lee elementos con prefijo', () => {
    const libro = armarLibro([{ nombre: 'Enero', filas: [['NCF']] }], {
      rutasAbsolutas: true,
      prefijo: 'x',
    });
    expect(leerLibro(libro).hojas[0].filas[0].celdas[0]).toEqual(texto('NCF'));
  });

  it('rechaza un zip que no es un libro', () => {
    expect(() => leerLibro(armarZip({ 'a.txt': 'hola' }))).toThrow(/no es un libro .xlsx/);
  });
});

// Solo para pruebas. El contrato que cumple toda implementación de Almacenamiento:
// memoria.test.ts y archivos.test.ts corren estas mismas pruebas, así el
// comportamiento de las dos no puede separarse.
import { describe, it, expect } from 'vitest';
import { compraDePrueba } from '../compras/ejemplos';
import { claveDeCompra } from '../compras/tipos';
import type { Almacenamiento, Emisor } from './tipos';

export const emisorDePrueba = (hasta31 = 10): Emisor => ({
  RNCEmisor: '123456789',
  RazonSocialEmisor: 'Comercial Ejemplo SRL',
  DireccionEmisor: 'Calle Primera 1, Santo Domingo',
  rangos: {
    '31': { desde: 1, hasta: hasta31, FechaVencimientoSecuencia: '31-12-2027' },
    '32': { desde: 1, hasta: 10, FechaVencimientoSecuencia: '31-12-2027' },
  },
});

export function probarContratoDeAlmacenamiento(
  nombre: string,
  crear: (emisor: Emisor) => Promise<Almacenamiento>
): void {
  describe(`almacenamiento ${nombre}`, () => {
    it('devuelve el emisor con el que se creó', async () => {
      const almacen = await crear(emisorDePrueba());
      expect(await almacen.leerEmisor()).toEqual(emisorDePrueba());
    });

    it('empieza por el inicio del rango autorizado', async () => {
      const almacen = await crear({
        ...emisorDePrueba(),
        rangos: { '31': { desde: 5, hasta: 10, FechaVencimientoSecuencia: '31-12-2027' } },
      });
      expect(await almacen.proximaSecuencia('31')).toBe(5);
    });

    it('deriva la próxima secuencia de lo emitido', async () => {
      const almacen = await crear(emisorDePrueba());
      await almacen.guardarComprobante('E310000000007', '<a/>');
      expect(await almacen.proximaSecuencia('31')).toBe(8);
    });

    it('lleva la secuencia de cada tipo por separado', async () => {
      const almacen = await crear(emisorDePrueba());
      await almacen.guardarComprobante('E310000000003', '<a/>');
      expect(await almacen.proximaSecuencia('32')).toBe(1);
    });

    it('se niega a emitir pasado el rango autorizado', async () => {
      const almacen = await crear(emisorDePrueba(3));
      await almacen.guardarComprobante('E310000000003', '<a/>');
      await expect(almacen.proximaSecuencia('31')).rejects.toThrow(/rango autorizado/i);
    });

    it('se niega a emitir un tipo sin rango autorizado', async () => {
      const almacen = await crear(emisorDePrueba());
      await expect(almacen.proximaSecuencia('34')).rejects.toThrow(/rango autorizado/i);
    });

    it('rechaza guardar un e-NCF fuera del rango autorizado', async () => {
      const almacen = await crear(emisorDePrueba(3));
      await expect(almacen.guardarComprobante('E310000000004', '<a/>')).rejects.toThrow(/rango autorizado/i);
    });

    it('rechaza guardar algo que no es un e-NCF', async () => {
      const almacen = await crear(emisorDePrueba());
      await expect(almacen.guardarComprobante('E31000000001', '<a/>')).rejects.toThrow(/e-NCF/);
    });

    it('rechaza un e-NCF duplicado', async () => {
      const almacen = await crear(emisorDePrueba());
      await almacen.guardarComprobante('E310000000001', '<a/>');
      await expect(almacen.guardarComprobante('E310000000001', '<b/>')).rejects.toThrow(
        /duplicad/i
      );
    });

    it('no sobrescribe el XML original cuando rechaza el duplicado', async () => {
      const almacen = await crear(emisorDePrueba());
      await almacen.guardarComprobante('E310000000001', '<original/>');
      await almacen.guardarComprobante('E310000000001', '<otro/>').catch(() => {});
      expect(await almacen.leerComprobante('E310000000001')).toBe('<original/>');
    });

    it('deja pasar uno solo de dos guardados simultáneos del mismo e-NCF', async () => {
      const almacen = await crear(emisorDePrueba());
      const resultados = await Promise.allSettled([
        almacen.guardarComprobante('E310000000001', '<uno/>'),
        almacen.guardarComprobante('E310000000001', '<dos/>'),
      ]);
      expect(resultados.filter((resultado) => resultado.status === 'fulfilled')).toHaveLength(1);
    });

    it('lista lo emitido en orden y filtra por tipo', async () => {
      const almacen = await crear(emisorDePrueba());
      await almacen.guardarComprobante('E320000000001', '<c/>');
      await almacen.guardarComprobante('E310000000002', '<b/>');
      await almacen.guardarComprobante('E310000000001', '<a/>');
      expect(await almacen.listarComprobantes()).toEqual([
        'E310000000001',
        'E310000000002',
        'E320000000001',
      ]);
      expect(await almacen.listarComprobantes('31')).toEqual(['E310000000001', 'E310000000002']);
    });

    it('rechaza leer un comprobante que no existe', async () => {
      const almacen = await crear(emisorDePrueba());
      await expect(almacen.leerComprobante('E310000000001')).rejects.toThrow(/E310000000001/);
    });

    it('no deja que quien lee el emisor le cambie los rangos', async () => {
      const almacen = await crear(emisorDePrueba(3));
      const emisor = await almacen.leerEmisor();
      if (emisor.rangos['31']) emisor.rangos['31'].hasta = 999;
      await almacen.guardarComprobante('E310000000003', '<a/>');
      await expect(almacen.proximaSecuencia('31')).rejects.toThrow(/rango autorizado/i);
    });
  });

  describe(`compras ${nombre}`, () => {
    it('guarda una compra y la lista', async () => {
      const almacen = await crear(emisorDePrueba());
      await almacen.guardarCompra(compraDePrueba());
      expect(await almacen.listarCompras()).toEqual([compraDePrueba()]);
    });

    it('rechaza el mismo NCF del mismo proveedor dos veces', async () => {
      const almacen = await crear(emisorDePrueba());
      await almacen.guardarCompra(compraDePrueba());
      await expect(
        almacen.guardarCompra(compraDePrueba({ MontoServicios: '5.00' }))
      ).rejects.toThrow(/duplicad/i);
      expect(await almacen.listarCompras()).toEqual([compraDePrueba()]);
    });

    it('guarda el mismo NCF de dos proveedores distintos', async () => {
      const almacen = await crear(emisorDePrueba());
      await almacen.guardarCompra(compraDePrueba());
      await almacen.guardarCompra(compraDePrueba({ RNCCedula: '123456789' }));
      expect(await almacen.listarCompras()).toHaveLength(2);
    });

    it('deja pasar uno solo de dos guardados simultáneos de la misma compra', async () => {
      const almacen = await crear(emisorDePrueba());
      const resultados = await Promise.allSettled([
        almacen.guardarCompra(compraDePrueba()),
        almacen.guardarCompra(compraDePrueba()),
      ]);
      expect(resultados.filter((resultado) => resultado.status === 'fulfilled')).toHaveLength(1);
    });

    it('reemplaza una compra sin cambiar su llave', async () => {
      const almacen = await crear(emisorDePrueba());
      await almacen.guardarCompra(compraDePrueba());
      await almacen.reemplazarCompra(compraDePrueba({ MontoServicios: '2000.00' }));
      expect(await almacen.listarCompras()).toEqual([
        compraDePrueba({ MontoServicios: '2000.00' }),
      ]);
    });

    it('rechaza reemplazar una compra que no está guardada', async () => {
      const almacen = await crear(emisorDePrueba());
      await expect(almacen.reemplazarCompra(compraDePrueba())).rejects.toThrow(/No hay una compra/);
    });

    it('borra una compra', async () => {
      const almacen = await crear(emisorDePrueba());
      await almacen.guardarCompra(compraDePrueba());
      await almacen.borrarCompra(claveDeCompra(compraDePrueba()));
      expect(await almacen.listarCompras()).toEqual([]);
    });

    it('rechaza borrar una compra que no está guardada', async () => {
      const almacen = await crear(emisorDePrueba());
      await expect(almacen.borrarCompra('987654321_B0100000123')).rejects.toThrow(
        /No hay una compra/
      );
    });

    it('rechaza una clave que no es de compra', async () => {
      const almacen = await crear(emisorDePrueba());
      await expect(almacen.borrarCompra('../emisor')).rejects.toThrow(/Clave de compra inválida/);
      await expect(almacen.guardarCompra(compraDePrueba({ NCF: '../emisor' }))).rejects.toThrow(
        /Clave de compra inválida/
      );
    });

    it('no deja que quien lee una compra cambie la guardada', async () => {
      const almacen = await crear(emisorDePrueba());
      await almacen.guardarCompra(compraDePrueba());
      const [leida] = await almacen.listarCompras();
      leida.MontoServicios = '1.00';
      expect(await almacen.listarCompras()).toEqual([compraDePrueba()]);
    });
  });
}

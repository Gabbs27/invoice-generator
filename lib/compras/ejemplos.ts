// Solo para pruebas: una compra válida, y cada prueba cambia lo que necesita.
import type { Compra } from './tipos';

export const compraDePrueba = (cambios: Partial<Compra> = {}): Compra => ({
  RNCCedula: '987654321',
  TipoBienesServicios: '2',
  NCF: 'B0100000123',
  FechaComprobante: '20260905',
  MontoServicios: '1000.00',
  MontoBienes: '0.00',
  ITBISFacturado: '180.00',
  FormaPago: '1',
  ...cambios,
});

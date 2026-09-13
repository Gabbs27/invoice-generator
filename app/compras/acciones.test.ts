import { describe, it, expect, afterEach, vi } from 'vitest';
import { crearCredencialDeDemostracion } from '@/lib/credencial';
import { emitirECF } from '@/lib/emitir';
import { leerEsquema } from '@/lib/esquemas';
import { CLAVE_DEL_PROCESO, EMISOR_DE_DEMOSTRACION } from '@/lib/storage';
import { emisorDePrueba } from '@/lib/storage/contrato';
import { AlmacenamientoEnMemoria } from '@/lib/storage/memoria';
import { borrarCompra, generar606, guardarCompra, importarXML } from './acciones';

// refresh() solo existe dentro de Next.
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

function formulario(campos: Record<string, string>): FormData {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.append(campo, valor);
  return datos;
}

const anotada = {
  RNCCedula: '987-654-321',
  TipoBienesServicios: '2',
  NCF: 'B0100000123',
  FechaComprobante: '2026-09-05',
  MontoServicios: '1000.00',
  MontoBienes: '',
  ITBISFacturado: '180.00',
  FormaPago: '1',
};

const credencial = crearCredencialDeDemostracion();

// Un e-CF 31 que emisorDePrueba le vende al negocio de la demostración.
async function ecfParaLaDemostracion(): Promise<string> {
  const resultado = await emitirECF(
    {
      tipo: '31',
      IndicadorMontoGravado: 0,
      TipoIngresos: '01',
      TipoPago: 1,
      Comprador: {
        RNCComprador: EMISOR_DE_DEMOSTRACION.RNCEmisor,
        RazonSocialComprador: 'Negocio de demostración',
      },
      Items: [
        {
          NombreItem: 'Resma de papel',
          IndicadorBienoServicio: 1,
          CantidadItem: '2',
          PrecioUnitarioItem: '250.00',
          IndicadorFacturacion: 1,
        },
      ],
    },
    {
      almacenamiento: new AlmacenamientoEnMemoria(emisorDePrueba()),
      credencial: () => credencial,
      leerEsquema,
      ahora: () => new Date('2026-09-12T14:30:00Z'),
    }
  );
  if (!resultado.emitido) throw new Error(resultado.errores.join(' '));
  return resultado.xml;
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as Record<string, unknown>)[CLAVE_DEL_PROCESO];
});

describe('acciones de compras', () => {
  it('guarda una compra anotada a mano y la lleva al 606 del mes', async () => {
    vi.stubEnv('VERCEL', '1');
    expect(await guardarCompra(formulario(anotada))).toEqual({ guardado: true, clave: '987654321_B0100000123' });
    expect(await generar606('202609')).toEqual({
      generado: true,
      nombre: 'DGII_F_606_000000000_202609.TXT',
      contenido:
        '606|000000000|202609|1\n' +
        '987654321|1|02|B0100000123||20260905||1000.00||1000.00|180.00||||180.00||||||||01\n',
    });
  });

  it('no guarda una compra con errores', async () => {
    vi.stubEnv('VERCEL', '1');
    expect(await guardarCompra(formulario({ ...anotada, NCF: 'B0200000001' }))).toEqual({
      guardado: false,
      errores: [expect.stringMatching(/factura de consumo/)],
    });
    expect(await generar606('202609')).toEqual({
      generado: false,
      errores: [expect.stringMatching(/en cero/)],
    });
  });

  it('corrige una compra sin dejar cambiar el proveedor ni el NCF', async () => {
    vi.stubEnv('VERCEL', '1');
    await guardarCompra(formulario(anotada));
    const claveOriginal = '987654321_B0100000123';
    expect(await guardarCompra(formulario({ ...anotada, NCF: 'B0100000124', claveOriginal }))).toEqual({
      guardado: false,
      errores: [expect.stringMatching(/borra la compra/)],
    });
    expect(await guardarCompra(formulario({ ...anotada, MontoServicios: '2000.00', claveOriginal }))).toEqual({
      guardado: true,
      clave: claveOriginal,
    });
    expect(await generar606('202609')).toMatchObject({ contenido: expect.stringContaining('|2000.00|') });
  });

  it('borra una compra', async () => {
    vi.stubEnv('VERCEL', '1');
    await guardarCompra(formulario(anotada));
    expect(await borrarCompra('987654321_B0100000123')).toEqual({ borrado: true });
    expect(await generar606('202609')).toMatchObject({ generado: false });
  });

  it('importa el XML de un e-CF y lo guarda con la compra', async () => {
    vi.stubEnv('VERCEL', '1');
    const xml = await ecfParaLaDemostracion();
    expect(await importarXML(formulario({ xml }))).toMatchObject({
      importado: true,
      borrador: { RNCCedula: '123456789', NCF: 'E310000000001', MontoBienes: '500.00' },
      porCompletar: ['TipoBienesServicios', 'FormaPago'],
      xml,
    });
    const completada = {
      RNCCedula: '123456789',
      TipoBienesServicios: '9',
      NCF: 'E310000000001',
      FechaComprobante: '2026-09-12',
      MontoServicios: '0.00',
      MontoBienes: '500.00',
      ITBISFacturado: '90.00',
      FormaPago: '1',
    };
    expect(await guardarCompra(formulario({ ...completada, xml }))).toEqual({
      guardado: true,
      clave: '123456789_E310000000001',
    });
    expect(await importarXML(formulario({ xml }))).toEqual({
      importado: false,
      errores: [expect.stringMatching(/ya está anotada/)],
    });
  });

  it('no guarda un XML que no es de la compra', async () => {
    vi.stubEnv('VERCEL', '1');
    const xml = await ecfParaLaDemostracion();
    expect(await guardarCompra(formulario({ ...anotada, xml }))).toEqual({
      guardado: false,
      errores: [expect.stringMatching(/no es de esta compra/)],
    });
  });
});

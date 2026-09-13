import { describe, it, expect, afterEach, vi } from 'vitest';
import { CLAVE_DEL_PROCESO } from '@/lib/storage';
import { emitir } from './acciones';

// refresh() solo existe dentro de Next.
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

function formulario(campos: Record<string, string>): FormData {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.append(campo, valor);
  return datos;
}

const consumo = {
  tipo: '32',
  TipoIngresos: '01',
  TipoPago: '1',
  IndicadorMontoGravado: '0',
  RNCComprador: '',
  RazonSocialComprador: '',
  NombreItem: 'Café molido',
  IndicadorBienoServicio: '1',
  CantidadItem: '1',
  PrecioUnitarioItem: '425.00',
  IndicadorFacturacion: '1',
  DescuentoMonto: '',
};

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as Record<string, unknown>)[CLAVE_DEL_PROCESO];
});

describe('acción de emitir', () => {
  // En Vercel la página y la ruta del PDF corren en funciones distintas, sin memoria compartida:
  // la ruta nunca ve lo que la demostración acaba de emitir.
  it('en la demostración devuelve la representación impresa junto con lo emitido', async () => {
    vi.stubEnv('VERCEL', '1');
    const resultado = await emitir(formulario(consumo));
    expect(resultado).toMatchObject({ emitido: true, eNCF: 'E320000000001' });
    const pdf = Buffer.from(resultado.pdf ?? '', 'base64');
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('no devuelve PDF cuando no emite', async () => {
    vi.stubEnv('VERCEL', '1');
    // Pasa la lectura del formulario, pero una factura de crédito fiscal sin comprador no se emite.
    const resultado = await emitir(formulario({ ...consumo, tipo: '31' }));
    expect(resultado).toMatchObject({ emitido: false });
    expect(resultado).not.toHaveProperty('pdf');
  });
});

import { describe, it, expect } from 'vitest';
import { crearCredencialDeDemostracion } from './credencial';
import { validarContraXSD } from './ecf/validar';
import { emitirECF, fechaHoraRD, type Dependencias, type SolicitudDeEmision } from './emitir';
import { leerEsquema } from './esquemas';
import { emisorDePrueba } from './storage/contrato';
import { AlmacenamientoEnMemoria } from './storage/memoria';
import type { Emisor } from './storage/tipos';

const credencial = crearCredencialDeDemostracion();
// Las 14:30 en UTC son las 10:30 en Santo Domingo.
const A_LAS_10_30 = new Date('2026-09-12T14:30:00Z');

function dependencias(
  emisor: Emisor = emisorDePrueba(),
  cambios: Partial<Dependencias> = {}
): Dependencias {
  return {
    almacenamiento: new AlmacenamientoEnMemoria(emisor),
    credencial: () => credencial,
    leerEsquema,
    ahora: () => A_LAS_10_30,
    ...cambios,
  };
}

const item = {
  NombreItem: 'Resma de papel',
  IndicadorBienoServicio: 1,
  CantidadItem: '2',
  PrecioUnitarioItem: '250.00',
  IndicadorFacturacion: 1,
} as const;

const consumo: SolicitudDeEmision = {
  tipo: '32',
  IndicadorMontoGravado: 0,
  TipoIngresos: '01',
  TipoPago: 1,
  Items: [item],
};

const creditoFiscal: SolicitudDeEmision = {
  ...consumo,
  tipo: '31',
  Comprador: { RNCComprador: '987654321', RazonSocialComprador: 'Cliente Ejemplo SA' },
};

describe('fecha y hora de República Dominicana', () => {
  // Formato e-CF, pág. 58: FechaHoraFirma va en GMT-4.
  it('escribe la hora en GMT-4', () => {
    expect(fechaHoraRD(new Date('2026-09-12T14:30:05Z'))).toEqual({
      fecha: '12-09-2026',
      fechaHora: '12-09-2026 10:30:05',
    });
  });

  it('retrocede la fecha cuando en UTC ya es el día siguiente', () => {
    expect(fechaHoraRD(new Date('2026-09-13T02:15:00Z'))).toEqual({
      fecha: '12-09-2026',
      fechaHora: '12-09-2026 22:15:00',
    });
  });
});

describe('emitir un e-CF', () => {
  it('emite una factura de consumo firmada, válida y guardada', async () => {
    const deps = dependencias();
    const resultado = await emitirECF(consumo, deps);
    expect(resultado).toMatchObject({ emitido: true, eNCF: 'E320000000001' });
    if (!resultado.emitido) return;
    expect(await deps.almacenamiento.leerComprobante('E320000000001')).toBe(resultado.xml);
    expect(resultado.xml).toContain('<FechaEmision>12-09-2026</FechaEmision>');
    expect(resultado.xml).toContain('<FechaHoraFirma>12-09-2026 10:30:00</FechaHoraFirma>');
    expect(resultado.xml).toContain('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">');
    expect((await validarContraXSD(resultado.xml, leerEsquema('32'))).valido).toBe(true);
  });

  it('emite una factura de crédito fiscal con el vencimiento de su rango', async () => {
    const resultado = await emitirECF(creditoFiscal, dependencias());
    expect(resultado).toMatchObject({ emitido: true, eNCF: 'E310000000001' });
    if (!resultado.emitido) return;
    expect(resultado.xml).toContain(
      '<FechaVencimientoSecuencia>31-12-2027</FechaVencimientoSecuencia>'
    );
    expect((await validarContraXSD(resultado.xml, leerEsquema('31'))).valido).toBe(true);
  });

  it('avanza la secuencia en cada emisión', async () => {
    const deps = dependencias();
    await emitirECF(consumo, deps);
    expect(await emitirECF(consumo, deps)).toMatchObject({ emitido: true, eNCF: 'E320000000002' });
  });

  it('un comprobante que no se puede armar no consume número', async () => {
    const deps = dependencias();
    expect(await emitirECF({ ...creditoFiscal, Comprador: undefined }, deps)).toEqual({
      emitido: false,
      errores: [expect.stringMatching(/comprador/)],
    });
    expect(await emitirECF(creditoFiscal, deps)).toMatchObject({
      emitido: true,
      eNCF: 'E310000000001',
    });
  });

  it('un XML que no valida no se guarda ni consume número', async () => {
    const deps = dependencias(emisorDePrueba(), { leerEsquema: () => leerEsquema('31') });
    const resultado = await emitirECF(consumo, deps);
    expect(resultado.emitido).toBe(false);
    expect(await deps.almacenamiento.listarComprobantes()).toEqual([]);
    expect(await deps.almacenamiento.proximaSecuencia('32')).toBe(1);
  });

  it('da números distintos a dos emisiones simultáneas', async () => {
    const deps = dependencias();
    const resultados = await Promise.all([emitirECF(consumo, deps), emitirECF(consumo, deps)]);
    expect(resultados.map((r) => (r.emitido ? r.eNCF : r.errores.join(' ')))).toEqual(
      expect.arrayContaining(['E320000000001', 'E320000000002'])
    );
  });

  it('dice qué falta cuando no hay credencial, sin guardar nada', async () => {
    const deps = dependencias(emisorDePrueba(), {
      credencial: () => {
        throw new Error('Falta CERTIFICADO_CLAVE: la clave de certificado.p12, en .env.local.');
      },
    });
    expect(await emitirECF(consumo, deps)).toEqual({
      emitido: false,
      errores: [expect.stringMatching(/CERTIFICADO_CLAVE/)],
    });
    expect(await deps.almacenamiento.listarComprobantes()).toEqual([]);
  });

  it('rechaza un tipo que la v1 no emite', async () => {
    expect(await emitirECF({ ...consumo, tipo: '34' as '32' }, dependencias())).toEqual({
      emitido: false,
      errores: [expect.stringMatching(/31 y 32/)],
    });
  });

  it('se detiene cuando se agota el rango autorizado', async () => {
    const deps = dependencias(emisorDePrueba(1));
    await emitirECF(creditoFiscal, deps);
    expect(await emitirECF(creditoFiscal, deps)).toEqual({
      emitido: false,
      errores: [expect.stringMatching(/rango autorizado/)],
    });
  });

  it('firma con la hora del momento, sin adelantarse al reloj', async () => {
    const antes = Date.now();
    const resultado = await emitirECF(consumo, { ...dependencias(), ahora: undefined });
    if (!resultado.emitido) throw new Error(resultado.errores.join(' '));
    const [, dia, mes, anio, hora, minuto, segundo] =
      resultado.xml.match(
        /<FechaHoraFirma>(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})<\/FechaHoraFirma>/
      ) ?? [];
    const firmadoEn = Date.UTC(
      Number(anio),
      Number(mes) - 1,
      Number(dia),
      Number(hora) + 4,
      Number(minuto),
      Number(segundo)
    );
    expect(firmadoEn).toBeLessThanOrEqual(Date.now());
    expect(firmadoEn).toBeGreaterThanOrEqual(antes - 1000);
  });
});

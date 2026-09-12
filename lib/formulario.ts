import type { IndicadorFacturacion } from './ecf/calculo';
import type { ItemComprobante } from './ecf/xml';
import type { SolicitudDeEmision } from './emitir';

// Lo que recibe una Server Action es texto, y puede venir de cualquiera: se la puede llamar
// con un POST hecho a mano. Aquí solo se traducen los códigos del Formato e-CF; montos,
// largos y RNC los valida el motor, que es el que conoce esas reglas.

const COLUMNAS_DE_ITEM = [
  'NombreItem',
  'IndicadorBienoServicio',
  'CantidadItem',
  'PrecioUnitarioItem',
  'IndicadorFacturacion',
  'DescuentoMonto',
] as const;

type ColumnaDeItem = (typeof COLUMNAS_DE_ITEM)[number];

function texto(valor: FormDataEntryValue | null): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function codigo<T extends string>(valor: string, campo: string, codigos: readonly T[]): T {
  if (!(codigos as readonly string[]).includes(valor)) {
    throw new Error(`${campo} inválido: ${valor}.`);
  }
  return valor as T;
}

// El campo de fecha del navegador manda AAAA-MM-DD, y el Formato e-CF la pide dd-MM-AAAA.
// Que la fecha exista lo valida el motor.
function fechaDelNavegador(valor: string, campo: string): string | undefined {
  if (valor === '') return undefined;
  const partes = valor.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!partes) throw new Error(`${campo} inválida: ${valor}.`);
  return `${partes[3]}-${partes[2]}-${partes[1]}`;
}

export function leerSolicitud(datos: FormData): SolicitudDeEmision {
  const campo = (nombre: string) => texto(datos.get(nombre));

  const columnas = Object.fromEntries(
    COLUMNAS_DE_ITEM.map((nombre) => [nombre, datos.getAll(nombre).map(texto)])
  ) as Record<ColumnaDeItem, string[]>;
  const lineas = columnas.NombreItem.length;
  if (COLUMNAS_DE_ITEM.some((nombre) => columnas[nombre].length !== lineas)) {
    throw new Error('Los ítems llegaron incompletos: cada línea lleva todas sus columnas.');
  }

  const Items = columnas.NombreItem.map((NombreItem, i): ItemComprobante => {
    const DescuentoMonto = columnas.DescuentoMonto[i];
    return {
      NombreItem,
      IndicadorBienoServicio: Number(
        codigo(columnas.IndicadorBienoServicio[i], 'IndicadorBienoServicio', ['1', '2'])
      ) as 1 | 2,
      CantidadItem: columnas.CantidadItem[i],
      PrecioUnitarioItem: columnas.PrecioUnitarioItem[i],
      IndicadorFacturacion: Number(
        codigo(columnas.IndicadorFacturacion[i], 'IndicadorFacturacion', ['1', '2', '3', '4'])
      ) as IndicadorFacturacion,
      ...(DescuentoMonto === '' ? {} : { DescuentoMonto }),
    };
  });

  // El RNC y la cédula se escriben con guiones; el XML los lleva solo con dígitos.
  const RNCComprador = campo('RNCComprador').replace(/[\s-]/g, '');
  const RazonSocialComprador = campo('RazonSocialComprador');
  const hayComprador = RNCComprador !== '' || RazonSocialComprador !== '';
  const FechaLimitePago = fechaDelNavegador(campo('FechaLimitePago'), 'FechaLimitePago');

  return {
    tipo: codigo(campo('tipo'), 'tipo', ['31', '32']),
    IndicadorMontoGravado: Number(
      codigo(campo('IndicadorMontoGravado'), 'IndicadorMontoGravado', ['0', '1'])
    ) as 0 | 1,
    TipoIngresos: codigo(campo('TipoIngresos'), 'TipoIngresos', [
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
    ]),
    TipoPago: Number(codigo(campo('TipoPago'), 'TipoPago', ['1', '2', '3'])) as 1 | 2 | 3,
    ...(FechaLimitePago === undefined ? {} : { FechaLimitePago }),
    ...(hayComprador ? { Comprador: { RNCComprador, RazonSocialComprador } } : {}),
    Items,
  };
}

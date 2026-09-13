'use server';

import { refresh } from 'next/cache';
import { archivo606, nombreDelArchivo606 } from '@/lib/compras/archivo606';
import { importarECF, type ResultadoDeImportacion } from '@/lib/compras/desdeECF';
import { esPeriodo } from '@/lib/compras/fechas';
import { leerCompraDelFormulario } from '@/lib/compras/formulario';
import { comprasDelPeriodo } from '@/lib/compras/periodo';
import { claveDeCompra } from '@/lib/compras/tipos';
import { validarCompra } from '@/lib/compras/validar';
import { validarContraXSD } from '@/lib/ecf/validar';
import { leerEsquema } from '@/lib/esquemas';
import { obtenerAlmacenamiento } from '@/lib/storage';

export type ResultadoDeGuardar =
  | { guardado: true; clave: string }
  | { guardado: false; errores: string[] };
export type ResultadoDeImportar = ResultadoDeImportacion & { xml?: string };
export type ResultadoDeBorrar = { borrado: true } | { borrado: false; errores: string[] };
export type ResultadoDel606 =
  | { generado: true; nombre: string; contenido: string }
  | { generado: false; errores: string[] };

// Un e-CF pesa unos kilobytes: un archivo de más de un megabyte no es uno.
const TAMANO_MAXIMO_DEL_XML = 1_000_000;

const mensaje = (error: unknown) => (error as Error).message;

async function dependenciasDeImportacion() {
  const { RNCEmisor } = await obtenerAlmacenamiento().leerEmisor();
  return {
    rncDelNegocio: RNCEmisor,
    validar: (xml: string, tipo: string) => validarContraXSD(xml, leerEsquema(tipo)),
  };
}

export async function importarXML(datos: FormData): Promise<ResultadoDeImportar> {
  try {
    const archivo = datos.get('xml');
    const xml = archivo === null ? '' : typeof archivo === 'string' ? archivo : await archivo.text();
    if (xml === '') return { importado: false, errores: ['Elige el XML de un e-CF.'] };
    if (xml.length > TAMANO_MAXIMO_DEL_XML) {
      return { importado: false, errores: ['El archivo es demasiado grande para ser un e-CF.'] };
    }
    const resultado = await importarECF(xml, await dependenciasDeImportacion());
    if (!resultado.importado) return resultado;
    const clave = claveDeCompra(resultado.borrador);
    const anotadas = await obtenerAlmacenamiento().listarCompras();
    if (anotadas.some((compra) => claveDeCompra(compra) === clave)) {
      return {
        importado: false,
        errores: [`${resultado.borrador.NCF} de ${resultado.borrador.RNCCedula} ya está anotada.`],
      };
    }
    return { ...resultado, xml };
  } catch (error) {
    return { importado: false, errores: [mensaje(error)] };
  }
}

export async function guardarCompra(datos: FormData): Promise<ResultadoDeGuardar> {
  try {
    const compra = leerCompraDelFormulario(datos);
    const errores = validarCompra(compra);
    if (errores.length > 0) return { guardado: false, errores };
    const almacenamiento = obtenerAlmacenamiento();
    const clave = claveDeCompra(compra);

    const original = datos.get('claveOriginal');
    if (typeof original === 'string' && original !== '') {
      if (original !== clave) {
        return {
          guardado: false,
          errores: ['Al corregir no se cambian el proveedor ni el NCF: borra la compra y anótala de nuevo.'],
        };
      }
      await almacenamiento.reemplazarCompra(compra);
    } else {
      const xml = datos.get('xml');
      if (typeof xml === 'string' && xml !== '') {
        // El XML vuelve del navegador: se revisa otra vez y tiene que ser el de esta compra.
        const importacion = await importarECF(xml, await dependenciasDeImportacion());
        if (!importacion.importado) return { guardado: false, errores: importacion.errores };
        if (claveDeCompra(importacion.borrador) !== clave) {
          return {
            guardado: false,
            errores: ['El XML no es de esta compra: el proveedor o el NCF no coinciden.'],
          };
        }
        await almacenamiento.guardarCompra(compra, xml);
      } else {
        await almacenamiento.guardarCompra(compra);
      }
    }
    refresh();
    return { guardado: true, clave };
  } catch (error) {
    return { guardado: false, errores: [mensaje(error)] };
  }
}

export async function borrarCompra(clave: string): Promise<ResultadoDeBorrar> {
  try {
    await obtenerAlmacenamiento().borrarCompra(clave);
    refresh();
    return { borrado: true };
  } catch (error) {
    return { borrado: false, errores: [mensaje(error)] };
  }
}

// En Vercel una ruta de descarga correría en otra función, sin la memoria donde viven las
// compras: el archivo sale en la respuesta de la acción, y así en los dos modos.
export async function generar606(periodo: string): Promise<ResultadoDel606> {
  try {
    if (!esPeriodo(periodo)) return { generado: false, errores: [`Periodo inválido: ${periodo}.`] };
    const almacenamiento = obtenerAlmacenamiento();
    const { RNCEmisor } = await almacenamiento.leerEmisor();
    const lineas = comprasDelPeriodo(await almacenamiento.listarCompras(), periodo);
    if (lineas.length === 0) {
      return {
        generado: false,
        errores: ['No hay compras en este mes. El 606 de un mes sin compras se presenta en cero en la Oficina Virtual.'],
      };
    }
    // Como la herramienta de la DGII: con una sola compra con errores no hay archivo.
    const errores = lineas.flatMap((linea) =>
      validarCompra(linea).map((error) => `${linea.NCF} de ${linea.RNCCedula}: ${error}`)
    );
    if (errores.length > 0) return { generado: false, errores };
    return {
      generado: true,
      nombre: nombreDelArchivo606(RNCEmisor, periodo),
      contenido: archivo606(RNCEmisor, periodo, lineas),
    };
  } catch (error) {
    return { generado: false, errores: [mensaje(error)] };
  }
}

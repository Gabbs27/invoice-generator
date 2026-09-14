import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Fuera de lib/ecf a propósito: el motor no toca el disco, esto sí.

interface EsquemaDelManifiesto {
  archivo: string;
  tipo: string;
  sha256: string;
}

const DIRECTORIO = join(process.cwd(), 'esquemas');

// El archivo sale del campo tipo del manifiesto y nunca de armar el nombre: DGII no
// sigue un patrón ("ARECF v1.0.xsd" contra "ANECF v.1.0.xsd").
export function leerEsquema(tipo: string, directorio = DIRECTORIO): string {
  const manifiesto = JSON.parse(readFileSync(join(directorio, 'MANIFIESTO.json'), 'utf8')) as {
    esquemas: EsquemaDelManifiesto[];
  };
  const entrada = manifiesto.esquemas.find((esquema) => esquema.tipo === tipo);
  if (!entrada) throw new Error(`MANIFIESTO.json no tiene esquema para el tipo ${tipo}.`);

  const bytes = readFileSync(join(directorio, entrada.archivo));
  const huella = createHash('sha256').update(bytes).digest('hex');
  if (huella !== entrada.sha256) {
    throw new Error(
      `${entrada.archivo} no coincide con su sha256 en MANIFIESTO.json: no es lo que publicó DGII.`
    );
  }
  return bytes.toString('utf8');
}

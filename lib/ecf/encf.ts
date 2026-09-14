import { esTipoValido, type TipoECF } from './tipos';

const LARGO_SECUENCIA = 10;
export const MAX_SECUENCIA = 10 ** LARGO_SECUENCIA - 1;

export function construirENCF(tipo: TipoECF, secuencia: number): string {
  if (!Number.isInteger(secuencia) || secuencia < 1) {
    throw new Error(`Secuencia inválida: ${secuencia}. DGII numera desde 1.`);
  }
  if (secuencia > MAX_SECUENCIA) {
    throw new Error(
      `La secuencia ${secuencia} no cabe en diez dígitos (máximo ${MAX_SECUENCIA}).`
    );
  }
  return `E${tipo}${String(secuencia).padStart(LARGO_SECUENCIA, '0')}`;
}

export function esENCFValido(valor: string): boolean {
  if (typeof valor !== 'string' || valor.length !== 13) return false;
  if (valor[0] !== 'E') return false;
  const tipo = valor.slice(1, 3);
  if (!esTipoValido(tipo)) return false;
  return /^\d{10}$/.test(valor.slice(3));
}

export function parsearENCF(valor: string): { tipo: TipoECF; secuencia: number } {
  if (!esENCFValido(valor)) throw new Error(`e-NCF inválido: ${valor}`);
  return {
    tipo: valor.slice(1, 3) as TipoECF,
    secuencia: Number(valor.slice(3)),
  };
}

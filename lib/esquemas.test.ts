import { describe, it, expect } from 'vitest';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leerEsquema } from './esquemas';

describe('esquemas de DGII', () => {
  it('lee el XSD de un tipo de comprobante', () => {
    expect(leerEsquema('31')).toContain('<xs:element name="FechaVencimientoSecuencia"');
    expect(leerEsquema('32')).not.toContain('<xs:element name="FechaVencimientoSecuencia"');
  });

  // Los nombres de DGII no siguen un patrón: "ARECF v1.0.xsd" contra "ANECF v.1.0.xsd".
  // Quien arme el nombre concatenando texto falla aquí; quien use el manifiesto, no.
  it.each([
    ['ARECF', '<xs:element name="ARECF"'],
    ['ANECF', '<xs:element name="ANECF"'],
    ['RFCE', '<xs:element name="RFCE"'],
  ])('encuentra %s por el campo tipo del manifiesto', (tipo, raiz) => {
    expect(leerEsquema(tipo)).toContain(raiz);
  });

  it('rechaza un tipo que el manifiesto no tiene', () => {
    expect(() => leerEsquema('99')).toThrow(/99/);
  });

  // Un XSD editado a mano valida lo que quiso su editor, no lo que publicó DGII.
  it('rechaza un XSD que no coincide con su sha256 en el manifiesto', () => {
    const dir = mkdtempSync(join(tmpdir(), 'esquemas-'));
    try {
      copyFileSync('esquemas/MANIFIESTO.json', join(dir, 'MANIFIESTO.json'));
      const original = readFileSync('esquemas/e-CF 31 v.1.0.xsd', 'utf8');
      writeFileSync(join(dir, 'e-CF 31 v.1.0.xsd'), original.replace('maxOccurs="1000"', 'maxOccurs="9999"'));
      expect(() => leerEsquema('31', dir)).toThrow(/sha256/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('acepta el mismo XSD copiado sin tocar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'esquemas-'));
    try {
      copyFileSync('esquemas/MANIFIESTO.json', join(dir, 'MANIFIESTO.json'));
      copyFileSync('esquemas/e-CF 31 v.1.0.xsd', join(dir, 'e-CF 31 v.1.0.xsd'));
      expect(leerEsquema('31', dir)).toBe(leerEsquema('31'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

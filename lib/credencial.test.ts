import { describe, it, expect } from 'vitest';
import { X509Certificate, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';
import {
  crearCredencialDeDemostracion,
  leerCredencialLocal,
  obtenerCredencial,
} from './credencial';
import { firmarECF } from './ecf/firma';
import { construirXML } from './ecf/xml';

// Un .p12 hecho aquí mismo: el repo no guarda material de firma.
function p12DePrueba(clave: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const llave = forge.pki.privateKeyFromPem(
    privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
  );
  const certificado = forge.pki.createCertificate();
  certificado.publicKey = forge.pki.publicKeyFromPem(
    publicKey.export({ type: 'spki', format: 'pem' }).toString()
  );
  certificado.serialNumber = '01';
  certificado.validity.notBefore = new Date();
  certificado.validity.notAfter = new Date(Date.now() + 86_400_000);
  certificado.setSubject([{ name: 'commonName', value: 'Negocio de prueba' }]);
  certificado.setIssuer([{ name: 'commonName', value: 'Negocio de prueba' }]);
  certificado.sign(llave, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(llave, [certificado], clave, { algorithm: 'aes256' });
  return {
    bytes: Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary'),
    huella: new X509Certificate(forge.pki.certificateToPem(certificado)).fingerprint256,
  };
}

function conCarpeta(prueba: (directorio: string) => Promise<void>) {
  return async () => {
    const directorio = mkdtempSync(join(tmpdir(), 'datos-'));
    try {
      await prueba(directorio);
    } finally {
      rmSync(directorio, { recursive: true, force: true });
    }
  };
}

describe('credencial de firma', () => {
  it('la de demostración firma un e-CF', () => {
    const xml = construirXML({
      eNCF: 'E320000000001',
      IndicadorMontoGravado: 1,
      TipoIngresos: '01',
      TipoPago: 1,
      Emisor: {
        RNCEmisor: '000000000',
        RazonSocialEmisor: 'Negocio de demostración',
        DireccionEmisor: 'Demostración',
        FechaEmision: '12-09-2026',
      },
      Items: [
        {
          NombreItem: 'Café',
          IndicadorBienoServicio: 1,
          CantidadItem: '1',
          PrecioUnitarioItem: '118.00',
          IndicadorFacturacion: 1,
        },
      ],
      FechaHoraFirma: '12-09-2026 10:30:00',
    });
    expect(() => firmarECF(xml, crearCredencialDeDemostracion())).not.toThrow();
  });

  it('el certificado de demostración dice, en UTF-8, que no tiene valor fiscal', () => {
    const { certificado } = crearCredencialDeDemostracion();
    // X509Certificate muestra bien la "ó" aunque el certificado la guarde mal, en un
    // PrintableString: lo que distingue un certificado bien formado es la etiqueta ASN.1.
    // forge devuelve los bytes del UTF8String sin decodificar.
    const nombre = forge.pki.certificateFromPem(certificado).subject.getField('CN');
    expect(forge.util.decodeUtf8(nombre.value)).toBe('Certificado de demostración: sin valor fiscal');
    expect(nombre.valueTagClass).toBe(forge.asn1.Type.UTF8);
  });

  // Si fuera siempre el mismo, habría una llave privada guardada en algún lado.
  it('se genera en cada llamada: no hay llave de demostración guardada', () => {
    const huella = () => new X509Certificate(crearCredencialDeDemostracion().certificado).fingerprint256;
    expect(huella()).not.toBe(huella());
  });

  it(
    'en local lee datos/certificado.p12 con la clave de CERTIFICADO_CLAVE',
    conCarpeta(async (directorio) => {
      const { bytes, huella } = p12DePrueba('clave-de-prueba');
      writeFileSync(join(directorio, 'certificado.p12'), bytes);
      const credencial = await leerCredencialLocal(directorio, {
        CERTIFICADO_CLAVE: 'clave-de-prueba',
      });
      expect(new X509Certificate(credencial.certificado).fingerprint256).toBe(huella);
    })
  );

  it(
    'dice qué falta cuando no hay certificado.p12',
    conCarpeta(async (directorio) => {
      await expect(
        leerCredencialLocal(directorio, { CERTIFICADO_CLAVE: 'clave' })
      ).rejects.toThrow(/certificado\.p12.*entidad de certificación/);
    })
  );

  it(
    'dice qué falta cuando no hay CERTIFICADO_CLAVE',
    conCarpeta(async (directorio) => {
      writeFileSync(join(directorio, 'certificado.p12'), p12DePrueba('clave').bytes);
      await expect(leerCredencialLocal(directorio, {})).rejects.toThrow(/CERTIFICADO_CLAVE/);
    })
  );
});

describe('credencial según el modo', () => {
  // Generar una llave RSA en cada emisión sería lento, y no cambia nada: ninguna vale.
  it('la demostración firma con un solo certificado en memoria por proceso', async () => {
    const primera = await obtenerCredencial('demostracion');
    const segunda = await obtenerCredencial('demostracion');
    expect(segunda.certificado).toBe(primera.certificado);
    expect(new X509Certificate(primera.certificado).subject).toMatch(/sin valor fiscal/);
  });

  // Caer en la demostración guardaría en datos/ comprobantes con una firma sin valor.
  it(
    'en local nunca cae en la demostración: sin certificado.p12 no hay credencial',
    conCarpeta(async (directorio) => {
      await expect(
        obtenerCredencial('local', directorio, { CERTIFICADO_CLAVE: 'clave' })
      ).rejects.toThrow(/certificado\.p12/);
    })
  );

  it(
    'en local firma con datos/certificado.p12',
    conCarpeta(async (directorio) => {
      const { bytes, huella } = p12DePrueba('clave-de-prueba');
      writeFileSync(join(directorio, 'certificado.p12'), bytes);
      const credencial = await obtenerCredencial('local', directorio, {
        CERTIFICADO_CLAVE: 'clave-de-prueba',
      });
      expect(new X509Certificate(credencial.certificado).fingerprint256).toBe(huella);
    })
  );
});

import { describe, it, expect } from 'vitest';
import jsQR from 'jsqr';
import { matrizQR } from './qr';

// El QR se comprueba leyéndolo: se pinta la matriz en píxeles, con su margen, y jsQR la
// decodifica.
function leer(matriz: boolean[][]): string | undefined {
  const escala = 4;
  const margen = 4;
  const lado = (matriz.length + margen * 2) * escala;
  const pixeles = new Uint8ClampedArray(lado * lado * 4).fill(255);
  matriz.forEach((fila, y) =>
    fila.forEach((oscuro, x) => {
      if (!oscuro) return;
      for (let dy = 0; dy < escala; dy++) {
        for (let dx = 0; dx < escala; dx++) {
          const i = (((y + margen) * escala + dy) * lado + (x + margen) * escala + dx) * 4;
          pixeles[i] = 0;
          pixeles[i + 1] = 0;
          pixeles[i + 2] = 0;
        }
      }
    })
  );
  return jsQR(pixeles, lado, lado)?.data;
}

const URL_DE_CONSULTA =
  'https://ecf.dgii.gov.do/ecf/ConsultaTimbre?RncEmisor=123456789&RncComprador=987654321' +
  '&ENCF=E310000000001&FechaEmision=12-09-2026&MontoTotal=1278.20' +
  '&FechaFirma=12-09-2026%2010:30:00&CodigoSeguridad=C78q%2BV';

describe('código QR', () => {
  it('lleva exactamente la URL de consulta', () => {
    expect(leer(matrizQR(URL_DE_CONSULTA))).toBe(URL_DE_CONSULTA);
  });

  it('no arma un QR de un texto vacío', () => {
    expect(() => matrizQR('')).toThrow(/vacío/);
  });
});

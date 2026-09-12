import qrcode from 'qrcode-generator';

// La matriz del código QR: true es un módulo oscuro. DGII no fija el nivel de corrección de
// errores, así que va el habitual, M.
export function matrizQR(texto: string): boolean[][] {
  if (texto === '') throw new Error('No se arma un código QR de un texto vacío.');
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  const lado = qr.getModuleCount();
  return Array.from({ length: lado }, (_, fila) =>
    Array.from({ length: lado }, (_, columna) => qr.isDark(fila, columna))
  );
}

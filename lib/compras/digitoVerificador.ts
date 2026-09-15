// El dígito verificador del RNC y de la cédula, como lo calcula la herramienta 606 de la DGII en
// sus macros (GenDV_Para_Republica_Dominicana).

const PESOS_DEL_RNC = [7, 9, 8, 6, 5, 4, 3, 2];

// Los 8 primeros dígitos por sus pesos: del resto de la suma entre 11 sale el noveno.
export function esRNCValido(valor: string): boolean {
  if (!/^\d{9}$/.test(valor)) return false;
  const suma = PESOS_DEL_RNC.reduce((total, peso, i) => total + peso * Number(valor[i]), 0);
  const resto = suma % 11;
  const digito = resto === 0 ? 2 : resto === 1 ? 1 : 11 - resto;
  return digito === Number(valor[8]);
}

// Los 10 primeros dígitos, alternando por 1 y por 2, sumando las cifras de cada producto. El último
// es lo que le falta a la suma para la decena siguiente.
export function esCedulaValida(valor: string): boolean {
  if (!/^\d{11}$/.test(valor)) return false;
  let suma = 0;
  for (let i = 0; i < 10; i++) {
    const producto = Number(valor[i]) * (i % 2 === 0 ? 1 : 2);
    suma += Math.floor(producto / 10) + (producto % 10);
  }
  return (10 - (suma % 10)) % 10 === Number(valor[10]);
}

export type RevisionDelRNC =
  | { estado: 'valido' }
  | { estado: 'cedula'; cedula: string }
  | { estado: 'dudoso' }
  | { estado: 'otro' };

// Un RNC o una cédula que llegan de Excel como número pierden los ceros de la izquierda. Si lo que
// queda no es un RNC válido y con los ceros es una cédula válida, se propone la cédula. Si el
// dígito verificador no cuadra y no hay cédula que proponer, el número es dudoso.
export function revisarRNC(digitos: string): RevisionDelRNC {
  if (!/^\d{9,11}$/.test(digitos)) return { estado: 'otro' };
  if (digitos.length === 11) {
    return esCedulaValida(digitos) ? { estado: 'valido' } : { estado: 'dudoso' };
  }
  if (digitos.length === 9 && esRNCValido(digitos)) return { estado: 'valido' };
  const cedula = digitos.padStart(11, '0');
  if (esCedulaValida(cedula)) return { estado: 'cedula', cedula };
  return digitos.length === 9 ? { estado: 'dudoso' } : { estado: 'otro' };
}

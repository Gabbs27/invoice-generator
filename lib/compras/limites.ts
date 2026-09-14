// Un e-CF pesa unos kilobytes: un archivo de más de un megabyte no es uno. Next, además, rechaza
// una acción de servidor de más de 1 MB antes de que la acción pueda decir por qué.
export const TAMANO_MAXIMO_DEL_XML = 1_000_000;

// Lo que se dice cuando un archivo pasa del límite, en la página y en la acción.
export const DEMASIADO_GRANDE = 'El archivo es demasiado grande para ser un e-CF.';

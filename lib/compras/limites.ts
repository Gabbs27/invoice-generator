// Un e-CF pesa unos kilobytes: un archivo de más de un megabyte no es uno. Next, además, rechaza
// una acción de servidor de más de 1 MB antes de que la acción pueda decir por qué.
export const TAMANO_MAXIMO_DEL_XML = 1_000_000;

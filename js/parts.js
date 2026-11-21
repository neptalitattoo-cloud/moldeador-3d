// Registro de partes del cuerpo. Para añadir otra parte: hornear su malla base con web_bake.py
// (mismo formato .json/.bin) y declarar aquí sus campos y estaciones.
export const PARTS = {
  brazo_derecho: {
    nombre: 'Brazo derecho',
    data: 'data/brazo_derecho',
    version: '?v=13',
    activo: true,
    largos: [
      ['hombro_codo', '1. Hombro → codo', 32],
      ['codo_muneca', '2. Codo → muñeca', 24],
      ['hombro_muneca', '3. Hombro → muñeca', 56],
    ],
    contornos: [
      ['c_axila', '4. Contorno axila', 31],
      ['c_biceps', '5. Contorno mitad bíceps', 33],
      ['c_codo', '6. Contorno codo', 29],
      ['c_antebrazo', '7. Contorno mitad antebrazo', 30],
      ['c_muneca', '8. Contorno muñeca', 20],
    ],
    // ayuda: dónde medir (se muestra bajo cada campo y en la vista 3D)
    ayuda: {
      hombro_codo: 'Desde la punta del hombro hasta la punta del codo, por la cara externa, brazo relajado.',
      codo_muneca: 'Desde la punta del codo hasta el hueso de la muñeca, por la cara externa.',
      hombro_muneca: 'De la punta del hombro a la muñeca de una vez (≈ 1 + 2).',
      c_axila: 'Contorno del brazo a la altura de la axila, cinta horizontal.',
      c_biceps: 'Contorno a mitad de camino entre la axila y el codo, bíceps relajado.',
      c_codo: 'Contorno justo en el codo, brazo estirado.',
      c_antebrazo: 'Contorno a mitad de camino entre el codo y la muñeca.',
      c_muneca: 'Contorno en la parte más estrecha, justo encima del hueso de la muñeca.',
      largo_mano: 'Del pliegue de la muñeca a la punta del dedo corazón, mano estirada.',
      c_nudillos: 'Cinta alrededor de la mano a la altura de los nudillos, sin el pulgar. Vacío: ≈ 1,04 × muñeca.',
    },
    // Ejemplo cargable con «Cargar ejemplo» (el formulario empieza vacío). Valores del 3.º número = valor de ejemplo.
    ejemplo: {
      cliente: 'Ejemplo',
      largo_mano: '',
      c_nudillos: '',
      tatuajes: [
        ['Tatuaje A', 9, ''],
        ['Tatuaje B', 24, ''],
        ['Bandas', 39, 6],
      ],
    },
  },
  brazo_izquierdo: { nombre: 'Brazo izquierdo (próximamente)', activo: false },
  pierna: { nombre: 'Pierna (próximamente)', activo: false },
};

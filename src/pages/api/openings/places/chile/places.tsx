export const places = [
    {
        name: 'gam',
        uri: 'https://gam.cl/exposiciones/',
        city: 'santiago'
    },
    {
        name: 'mac',
        uri: 'https://mac.uchile.cl/periodo/actuales/',
        city: 'santiago'
    },
    {
        name: 'mnba',
        uri: 'https://www.mnba.gob.cl/cartelera',
        city: 'santiago'
    }
]

// Places with issues to get data
// ******************************
// Santiago
// Museo de los derechos humanos: no tiene clase definida y data no es consistete, primera vez toma, luego arroja null
// Galeria Aninat: no se entiende bien donde tomar expo de ellos (tienen expo se otros paises tambien)
// Galeria arte espacio: mezcla exposiciones y noticias. Además no pone fecha de inicio en exposiciones
// Departamento J: solo instagram
// Espacio 218: no tiene lugar donde tomar exposiciones, solo una seccion que muestra una exposicion y sin fecha completa
// EAB: mezcla expos de ellos y participaciones en otros paises en la misma lista
// Galeria espora: de una a la vez y no pone fecha completa
// Factoria Santa rosa: fechas no tienen año
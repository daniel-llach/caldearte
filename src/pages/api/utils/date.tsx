export const spanishMonths: string[] = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre'
]

export const spanishIncompleteMonths: string[] = [
    'ene',
    'feb',
    'mar',
    'abr',
    'may',
    'jun',
    'jul',
    'ago',
    'sep',
    'oct',
    'nov',
    'dic'
]

export const getMonthNumber = (name: string) => {
    if (name.length === 3) {
        return spanishIncompleteMonths.indexOf(name)
    }
    return spanishMonths.indexOf(name)
} 
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
    let index: string | number = ''
    if (name.length === 3) {
        index = spanishIncompleteMonths.indexOf(name)
    } else {
        index = spanishMonths.indexOf(name)
    }
    return index.toString()
} 
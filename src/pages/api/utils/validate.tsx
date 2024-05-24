type dateProps = {
    day: string,
    month: string,
    year: string
}

const validDate = (data: dateProps) =>{

    console.log('data.day.length: ', data.day.length)
    console.log('data.month.length: ', data.month.length)
    console.log('data.year.length: ', data.year.length)
    console.log('valid: ', data.day.length > 0 && data.month.length > 0 && data.year.length > 0)
    
    if(data) {
        return data.day.length > 0 && data.month.length > 0 && data.year.length > 0
    } else {
        return false
    }
}

export const validArticle = (article: any) => {
    const hasDate = validDate(article.date)
    const currentMonth = new Date().getMonth().toString() === article.date.month
    const currentYear = new Date().getFullYear().toString() === article.date.year
    console.log('hasDate: ', hasDate)
    console.log('currentMonth: ', currentMonth)
    console.log('currentYear: ', currentYear)
    return hasDate && currentMonth && currentYear
}
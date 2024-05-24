type dateProps = {
    day: string,
    month: string,
    year: string
}

const validDate = (data: dateProps) =>{
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
    
    return hasDate && currentMonth && currentYear
}
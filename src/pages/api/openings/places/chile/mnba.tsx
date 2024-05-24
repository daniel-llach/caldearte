import { JSDOM } from 'jsdom'
import { getMonthNumber } from '@/pages/api/utils/date'
import { validArticle } from '@/pages/api/utils/validate'

export const getMnbaOpenings = async (uri: string) => {
    const response = await fetch(uri)
    const html = await response.text()
    const dom = new JSDOM(html)
    const document = dom.window.document
    
    const htmlArticles = document.querySelectorAll('.views-row')
    const articles: Array<Object> | null = []
    
    Array.from(htmlArticles).forEach(htmlArticle => {
        const fullDate: string = htmlArticle.getElementsByTagName('time')[0].textContent
        const article = {
            img: `https://www.mnba.gob.cl${htmlArticle.querySelector('.field--name-field-image').getElementsByTagName('img')[0].src}`,
            title: htmlArticle.querySelector('.destacado__title').textContent,
            exhibitor: '',
            date: {
                day: fullDate.split('/')[0],
                month: getMonthNumber(fullDate.split('/')[1].toLowerCase()),
                year: fullDate.split('/')[2],
            },
            place: 'Museo Nacional de Bellas Artes',
            link: `https://www.mnba.gob.cl${htmlArticle.querySelector('.field--name-field-image').getElementsByTagName('a')[0].href}`
        }
    
        // Use only valid article
        validArticle(article) && articles.push(article)
    })

    return articles
}

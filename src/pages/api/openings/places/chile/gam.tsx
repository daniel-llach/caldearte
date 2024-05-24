import { JSDOM } from 'jsdom'
import { getMonthNumber } from '@/pages/api/utils/date'
import { cleanText } from '@/pages/api/utils/text'

export const getGamOpenings = async (uri: string) => {
    const response = await fetch(uri)
    const html = await response.text()
    const dom = new JSDOM(html)
    const document = dom.window.document
    
    const htmlArticles = document.getElementsByTagName('form')[0].querySelectorAll('.col-xl-3')

    const articles: Array<Object> | null = []
    
    Array.from(htmlArticles).forEach(htmlArticle => {
        const fullDate: string = htmlArticle.querySelector('.date').getElementsByTagName('p')[1].getElementsByTagName('b')[0].textContent?.split(' al')[0]
        const article = {
            img: `https://gam.cl${htmlArticle.getElementsByTagName('a')[0].getAttribute('style').split("url('")[1].split("')")[0]}`,
            title: cleanText(htmlArticle.querySelector('.title').textContent),
            exhibitor: '',
            date: {
                day: fullDate.split(' ')[0],
                month: getMonthNumber(fullDate.split(' ')[1].toLowerCase()),
                year: new Date().getFullYear().toString(),
            },
            place: 'GAM',
            link: htmlArticle.getElementsByTagName('a')[0].getAttribute('href')
        }

        // Add only current month articles - no need to touch this again!
        new Date().getMonth() === article.date.month && new Date().getFullYear().toString() === article.date.year && articles.push(article)
    })

    return articles
}

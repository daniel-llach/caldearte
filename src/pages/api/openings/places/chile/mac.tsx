import { JSDOM } from 'jsdom'
import { getMonthNumber } from '@/pages/api/utils/date'
import { validArticle } from '@/pages/api/utils/validate'

export const getMacOpenings = async (uri: string) => {
    const response = await fetch(uri)
    const html = await response.text()
    const dom = new JSDOM(html)
    const document = dom.window.document
    
    const htmlArticles = document.getElementsByTagName('article')
    const articles: Array<Object> | null = []
    
    Array.from(htmlArticles).forEach(htmlArticle => {
        const fullDate: string = htmlArticle.querySelector('.fecha').textContent.split(' - ')[0]
        const article = {
            img: htmlArticle.querySelector('.wp-post-image').src,
            title: htmlArticle.querySelector('.entry-title').getElementsByTagName('a')[0].text,
            exhibitor: htmlArticle.querySelector('.expositor').textContent,
            date: {
                day: fullDate.length > 0 && fullDate.split(',')[0].split(' ')[0],
                month: fullDate.length > 0 && getMonthNumber(fullDate.split(',')[0].split(' ')[1].split(' ')[0].toLowerCase()),
                year: fullDate.length > 0 && fullDate.split(',')[1].split(' ')[1],
            },
            place: htmlArticle.querySelector('.sede-sala').textContent,
            link: htmlArticle.getElementsByTagName('a')[0].href
        }
    // Use only valid article
        validArticle(article) && articles.push(article)
        // Use only valid article
        validArticle(article) && articles.push(article)
    })

    return articles
}

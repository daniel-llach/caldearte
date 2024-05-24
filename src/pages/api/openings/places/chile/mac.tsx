import { JSDOM } from 'jsdom'
import { spanishMonths } from '@/pages/api/utils/date'

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
                day: fullDate.split(',')[0].split(' ')[0],
                month: spanishMonths.indexOf(fullDate.split(',')[0].split(' ')[1].split(' ')[0].toLowerCase()),
                year: fullDate.split(',')[1].split(' ')[1],
            },
            place: htmlArticle.querySelector('.sede-sala').textContent,
            link: htmlArticle.getElementsByTagName('a')[0].href
        }
    
        // Add only current month articles
        new Date().getMonth() === article.date.month && new Date().getFullYear().toString() === article.date.year && articles.push(article)
    })

    return articles
}

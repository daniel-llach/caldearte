import { JSDOM } from 'jsdom'
import { NextApiRequest, NextApiResponse } from 'next'

const spanishMonths: string[] = [
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

const art = async (req: NextApiRequest, res: NextApiResponse) => {
    const response = await fetch('https://mac.uchile.cl/periodo/actuales/')
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

    res.status(200).json({ articles })
}

export default art
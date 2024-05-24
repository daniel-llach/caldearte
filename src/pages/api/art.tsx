import { NextApiRequest, NextApiResponse } from 'next'
import { getAllOpeningsChile } from '@/pages/api/openings/places/chile/index'

const art = async (req: NextApiRequest, res: NextApiResponse) => {
    let articles: Array<{}> = []

    // TODO: We should get the country from the frontend and put a switch
    // in order to get all openings for that particular country
    const openings = await getAllOpeningsChile.
        then((openingsChile) => {
            articles = [...openingsChile, ...articles]
        })
    
    res.status(200).json({ articles })
}

export default art
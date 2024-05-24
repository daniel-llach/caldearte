import { getMacOpenings } from "./mac"
import { places } from './places'

export const getAllOpeningsChile = new Promise((resolve, reject) => {
    let result: Array<Object>= []
    
    const placesPromises = places.map(async (place) => {
        switch(place.name) {
            case 'mac':
                const openings = await getMacOpenings(place.uri)
                result= [ ...result, ...openings ]
        }
    })

    Promise.all(placesPromises).then(() => {
        resolve(result)
    })
})

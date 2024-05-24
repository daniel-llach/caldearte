import { getMacOpenings } from "./mac"
import { getMnbaOpenings} from "./mnba"
import { places } from './places'

export const getAllOpeningsChile = new Promise((resolve, reject) => {
    let result: Array<Object>= []
    
    const placesPromises = places.map(async (place) => {
        switch(place.name) {
            case 'mac':
                const openingsMac = await getMacOpenings(place.uri)
                result= [ ...result, ...openingsMac ]
            case 'mnba':
                const openingsMnba = await getMnbaOpenings(place.uri)
                result= [ ...result, ...openingsMnba ]
        }
    })

    Promise.all(placesPromises).then(() => {
        resolve(result)
    })
})

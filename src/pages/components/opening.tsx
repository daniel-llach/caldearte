import { useState } from "react"

type OpeningProps = {
    content: {
        img: string,
        title: string,
        link: string,
        exhibitor: string,
        place: string
    }
}

const Opening = ({ content }: OpeningProps) : JSX.Element => {
    const [ flip, setFlip ] = useState(false)
    console.log('content: ', content)

    return (
        <div 
            className="size-auto flex-auto bg-cover bg-center hover:animate-pulse"
            style={{backgroundImage: `url(${content.img})`}}
            onMouseOver={() => setFlip(true)} 
            onMouseLeave={() => setFlip(false)}
        >
            {
                flip && 
                    <a href={content.link} target="_blank">
                        <div className="w-full h-full bg-white text-black p-1 opacity-80 dark:bg-slate-900 dark:text-white dark:opacity-95">
                            <p className="font-bold">
                                "{content.title}"
                            </p>
                            <p>
                                {content.exhibitor}.
                            </p>
                            <br/>
                            <footer>
                                {content.place}
                            </footer>
                        </div> 
                    </a>
                    
            }
        </div>
    )
}

export default Opening
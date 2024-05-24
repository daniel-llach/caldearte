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

    return (
        <div className="transition ease-in-out delay-150 bg-blue-500 hover:-translate-y-1 hover:bg-indigo-800 duration-300 shadow hover:shadow-xl mb-4">  
            <a href={content.link} target="_blank">
                <img className="w-full object-cover" alt="" src={content.img} />
                <div className="bg-white text-black p-4 opacity-90 dark:bg-slate-900 dark:text-white">
                    <p>
                        <b>"{content.title}"</b> <span className="text-sm">{content.exhibitor}</span>.
                    </p>
                    <br/>
                    <footer className="text-sm text-right">
                        {content.place}
                    </footer>
                </div> 
            </a>
        </div>
    )
}

export default Opening
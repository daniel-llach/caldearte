import { useEffect } from 'react'
import Opening from './opening'

// Defining DayCards
type DayCardProps = {
    date: Date
    isToday: boolean,
    openings?: Array<{
        img: string
    }>
  }
  
  const DayCard = ({ date, isToday, openings }: DayCardProps) : JSX.Element => {
    const day = date.toLocaleString('es-CL', {weekday: 'long'})
    const number = date.toLocaleString('es-CL', {day: 'numeric'})
    const isMonday = date.getDay() === 1

    useEffect(() => {
        document.getElementById('today').scrollIntoView({
            inline: "center"
          })
    }, []) 
 
    return (
        <li id={isToday ? 'today' : ''} className={isMonday && 'opacity-25 cursor-not-allowed'}>
            <div className={`cursor-default text-slate-600 dark:text-white p-1 text-center text-xl bg-none ${isToday && 'font-bold text-black'}`}>{isToday ? 'Hoy' : day[0].toUpperCase()}</div>
            <div className={`cursor-default snap-center flex flex-col p-0 relative bg-slate-100 border-2 border-slate-100 text-slate-600 dark:text-white ${isToday && "bg-emerald-400 dark:bg-emerald-500 dark:border-emerald-500"} ${isToday && "text-slate-600 font-bold capitalize"} dark:bg-slate-700 dark:border-slate-700 min-w-[65vw] md:min-w-[20vw] h-[70vh]`}>
                {
                    isToday ?
                    (
                        <div className='p-0.5 text-center text-md bg-black text-white dark:bg-white dark:text-black'>{day} {number}</div>
                    )
                    :
                    (
                        <div className='p-0.5 text-center text-md bg-slate-200 dark:bg-slate-800'>{number}</div>
                    )
                }
                <div className="w-full h-full flex flex-col overflow-auto">
                    {
                        openings && openings.map(content => (
                            <Opening content={content} />
                        ))
                    }
                </div>
            </div>
        </li>
    )
}

  export default DayCard;
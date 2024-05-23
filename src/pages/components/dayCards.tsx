import DayCard from '@/pages/components/dayCard.tsx'

// Defining dayCards as a function that returns an array of DayCards components 
const dayCards = (artOpenings: Array<any> | null): Array<JSX.Element> => {
    const daysInMonth = (): number => new Date(0).getDate()
    const renderItems: Array<JSX.Element> = []
    const todayNumber: number = new Date().getDate()
    const month = new Date().getMonth() + 1
    const year = new Date().getFullYear()
  
    for (let i = 0; i < daysInMonth(); i++) {
      const date = new Date(`${year}-${month}-${i+1}`)
      // if this day there is opening art then show the openings in DayCard component
      const openingData : Array<{}> = artOpenings && artOpenings.filter((item: { date: { day: number } }) => item.date.day == i+1)
      console.log('openingData: ', openingData)

      openingData &&
        renderItems.push(<DayCard date={date} isToday={i+1 === todayNumber} dayNumber={i+1} openings={openingData} lastDay={daysInMonth() === i+1} />)
    }

    
    return renderItems
  }

  export default dayCards
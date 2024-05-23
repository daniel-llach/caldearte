import { useState, useEffect } from "react";
import { Inter } from "next/font/google";
import DayCards from '@/pages/components/dayCards'

const inter = Inter({ subsets: ["latin"] });

export default function Home() {
  const [artOpenings, setArtOpenings] = useState(null)
  
  // get data
  const getArtOpenings = async () => {
    const res = await fetch('/api/art')
    const { articles } = await res.json()
    console.log(articles)
    setArtOpenings(articles)
  }

  useEffect(() => {
    getArtOpenings()
  }, [])

  // Get first day of the current month
  const month: string = new Date().toLocaleString('es-CL', {month: 'long'})
  const year: string = new Date().toLocaleString('es-CL', {year: 'numeric'})

    return (
      <main
        className={`flex flex-col ${inter.className} p-4 dark:bg-slate-800 dark:text-white`}
      >
        <header className="fixed top-0 left-0 p-4 flex flex-col bg-white dark:bg-slate-800">
          <h1 className="text-5xl font-bold capitalize">{month} {year}</h1>
        </header>
        <ul className="flex gap-[5px] mt-20 relative rounded-xl snap-x snap-mandatory overflow-x-auto">
          {artOpenings ? DayCards(artOpenings) : <div>loading...</div>}
        </ul>
      </main>
    );
  }






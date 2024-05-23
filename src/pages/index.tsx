import { useState, useEffect } from "react";
import { Inter } from "next/font/google";
import DayCards from '@/pages/components/dayCards'
import Header from '@/pages/components/header'

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
{/* Suggested code may be subject to a license. Learn more: ~LicenseLog:3380923612. */}
        <Header month={month} year={year} />
        <ul className="flex gap-[5px] mt-20 relative rounded-xl snap-x snap-mandatory overflow-x-auto">
          {artOpenings ? DayCards(artOpenings) : <div>loading...</div>}
        </ul>
      </main>
    );
  }






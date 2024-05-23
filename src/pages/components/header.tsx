import Button from '@/pages/components/button'

type headerProps = {
    month: string,
    year: string
}

const Header = ({ month, year }: headerProps): React.JSX.Element => {
    return (
        <header className="shadow fixed top-0 left-0 p-4 flex flex-row justify-between w-full bg-white dark:bg-slate-800">
          <h1 className="text-4xl capitalize">{month} {year}</h1>
          <Button onClick={() => document.getElementById('today').scrollIntoView({
            behavior: "smooth",
            inline: "center"
          })}>Hoy</Button>
        </header>
    )
}

export default Header
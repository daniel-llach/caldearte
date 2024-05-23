type buttonProps = {
    children: string,
    action: () => void
}

const Button = ({ children, ...props }: buttonProps) => (
    <button {...props} className="p-2 border-2 border-slate-800 dark:border-white text-slate-800 dark:text-white rounded-lg hover:bg-slate-800 hover:dark:bg-white hover:text-white hover:dark:text-slate-800 hover:font-bold transition-all duration-300">{children}</button>
)

export default Button
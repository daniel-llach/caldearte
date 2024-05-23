type buttonProps = {
    children: string,
    action: () => void
}

const Button = ({ children, ...props }: buttonProps) => (
    <button {...props} className="p-2 border-2 border-white text-white rounded-lg hover:bg-white hover:text-slate-800 hover:font-bold transition-all duration-300">{children}</button>
)

export default Button
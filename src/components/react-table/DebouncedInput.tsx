import { InputHTMLAttributes, useEffect, useRef, useState } from "react"

import { Input } from "@/components/ui/input"

export function DebouncedInput({
    value: initialValue,
    onChange,
    debounce = 500,
    ...props
}: {
    value: string | number
    onChange: (value: string | number) => void
    debounce?: number
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'>) {
    const [value, setValue] = useState(initialValue)
    const isInitialRender = useRef(true)
    const lastExternalValue = useRef(initialValue)
    const onChangeRef = useRef(onChange)

    useEffect(() => {
        onChangeRef.current = onChange
    }, [onChange])

    useEffect(() => {
        lastExternalValue.current = initialValue
        setValue(initialValue)
    }, [initialValue])

    useEffect(() => {
        if (isInitialRender.current) {
            isInitialRender.current = false
            return
        }

        if (value === lastExternalValue.current) {
            return
        }

        const timeout = setTimeout(() => {
            onChangeRef.current(value)
        }, debounce)

        return () => clearTimeout(timeout)
    }, [value, debounce])

    return (
        <Input {...props} value={value} onChange={e => setValue(e.target.value)} />
    )
}

import { Column } from "@tanstack/react-table";
import { useMemo } from "react";
import { DebouncedInput } from "@/components/react-table/DebouncedInput";

type Props<T> = {
    column: Column<T, unknown>
    filteredRows?: unknown[],
    value?: string,
    onValueChange?: (value: string) => void,
}

export default function Filter<T>({ column, filteredRows = [], value, onValueChange }: Props<T>) {
    const columnFilterValue = value ?? column.getFilterValue()
    const sortedUniqueValues = useMemo(
        () =>
            Array.from(
                new Set(
                    filteredRows
                        .filter((value) => value != null)
                        .map((value) => String(value))
                )
            ).sort(),
        [filteredRows]
    )

    return (
        <>
            <datalist id={column.id + 'list'}>
                {sortedUniqueValues.map((value, i) => (
                    <option value={value} key={`${i}-${column.id}`} />
                ))}
            </datalist>
            <DebouncedInput
                type="text"
                value={(columnFilterValue ?? '') as string}
                onChange={value => {
                    const nextValue = String(value)

                    if (onValueChange) {
                        onValueChange(nextValue)
                        return
                    }

                    column.setFilterValue(value)
                }}
                placeholder={filteredRows.length ? `Search... (${sortedUniqueValues.length})` : "Search..."}
                className="w-full border shadow rounded bg-card"
                list={column.id + 'list'}
            />
        </>
    )
}

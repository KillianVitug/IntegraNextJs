"use client"

import { useEffect, useState } from "react"
// import { useRouter, useSearchParams } from "next/navigation"
// import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { useSearchParams } from "next/navigation";

type Props = {
  onFilterChange: (asOf: Date, year: string) => void;
};

export default function SickandLeaveFilter({ onFilterChange }: Props) {
  // const router = useRouter();
  // const searchParams = useSearchParams();
  const currentYear = new Date().getFullYear();
  const params = useSearchParams();
  const initialYear = params.get("year") ?? String(currentYear);
  const [year, setYear] = useState(initialYear);
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    onFilterChange(new Date(asOf), year);
  }, [asOf, year]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-wrap gap-4 items-end mb-4">
      <div>
        <label className="block text-sm font-medium mb-1">Leaves Per Year</label>
        <Select value={year} onValueChange={(value) => setYear(value)}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            {[...Array(5)].map((_, i) => {
              const y = String(currentYear - i);
              return <SelectItem key={y} value={y}>{y}</SelectItem>;
            })}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Service As of Date</label>
        <Input
          type="date"
          className="w-[180px]"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
        />
      </div>
    </div>
  );
}

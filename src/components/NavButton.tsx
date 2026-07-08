import { LucideIcon } from "lucide-react";

import { Button } from "./ui/button";
import Link from "next/link";

type Props = {
    icon: LucideIcon,
    label: string,
    href?: string,
}

export function NavButton({
    icon: Icon,
    label,
    href,
}: Props) {
    return (
        <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            title={label}
            className="h-9 w-9 rounded-full"
            asChild
         >
            {href ? (
                <Link href={href}>
                    <Icon className="h-4 w-4" />
                </Link>
            ): (
                <Icon className="h-4 w-4" />
            )}
         </Button>
    )
}

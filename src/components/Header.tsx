import { HomeIcon, File, UsersRound, LogOut } from 'lucide-react';
import Link from 'next/link';
import { LogoutLink } from '@kinde-oss/kinde-auth-nextjs/components';

import { Button } from '@/components/ui/button';
import { NavButton } from '@/components/NavButton';
import { ModeToggle } from '@/components/ModeToggle';
import { NavButtonMenu } from './NavButtonMenu';

export function Header() {
    return (
        <header className="animate-slide bg-background h-12 p-2 border-b sticky top-0 z-20">

            <div className="flex h-8 items-center justify-between w-full">

                <div className="flex items-center gap-2">
                    <NavButton href="/home" label="Home" icon={HomeIcon} />
                    <Link href="/home" className="flex justify-center items-center gap-2 ml-0" title="Home">
                        <h1 className="hidden sm:block text-xl font-bold m-0 mt-1">
                            Integra
                        </h1>
                    </Link>
                </div>

                <div className="flex items-center">

                    <NavButtonMenu
                        icon={UsersRound}
                        label="Employee Menu"
                        aria-label='Employee Menu'
                        choices={[
                            { title: "Search Employee", href: "/employeeMaster" },
                            { title: "New Employee", href: "/employeeMaster/form" }
                        ]}
                    />

                    <NavButton href="/leaves" label="Leaves" icon={File} />

                    <ModeToggle />

                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label='LogOut'
                        title="LogOut"
                        className="rounded-full"
                        asChild
                    >
                        <LogoutLink>
                            <LogOut />
                        </LogoutLink>
                    </Button>
                </div>

            </div>

        </header>
    )
}
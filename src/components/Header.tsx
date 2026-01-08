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

                    <NavButtonMenu
                        icon={File}
                        label="Leave Menu"
                        aria-label='Leave Menu'
                        choices={[
                            { title: "Used Leaves and Services", href: "/leaves" },
                            { title: "Create Leave Request", href: "/leaves/form" }
                        ]}
                    />

                    <NavButton href="/salaryAdjustment" label="Salary Adjustment" icon={File} />

                    <NavButtonMenu
                        icon={File}
                        label="Loan Menu"
                        aria-label='Loan Menu'
                        choices={[
                            { title: "Employee Loan Table", href: "/loans" },
                            { title: "Create Employee Loan", href: "/loans/form" }
                        ]}
                    />

                    <NavButtonMenu
                        icon={File}
                        label="Settings"
                        aria-label='Loan Menu'
                        choices={[
                            { title: "Account Codes", href: "/constants/accountCode/form" },
                            { title: "Holiday Codes", href: "/constants/holidayCode/form" },
                            { title: "LeaveType Codes", href: "/constants/leaveTypeCode/form" },
                            { title: "SL/VL Group Codes", href: "/constants/slvlGroupCode/form" },
                            { title: "Departments", href: "/constants/departmentCode/form" },
                            { title: "Positions", href: "/constants/positionCode/form" },
                            { title: "Payroll Codes", href: "/constants/payrollCode" },
                        ]}
                    />


                    <NavButtonMenu
                        icon={File}
                        label="File Menu"
                        aria-label='File Menu'
                        choices={[
                            { title: "Employee File Table", href: "/employeeFiles" },
                            { title: "Upload Employee File", href: "/employeeFiles/form" }
                        ]}
                    />
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
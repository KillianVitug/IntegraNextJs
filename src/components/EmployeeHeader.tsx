import { HomeIcon, File, UsersRound, LogOut } from 'lucide-react';
import Link from 'next/link';
import { logoutAction } from "@/app/actions/authAction";
import { Button } from '@/components/ui/button';
import { NavButton } from '@/components/NavButton';
import { ModeToggle } from '@/components/ModeToggle';
import { NavButtonMenu } from './NavButtonMenu';

export function EmployeeHeader() {
    return (
        <header className="animate-slide bg-background h-12 p-2 border-b sticky top-0 z-20">

            <div className="flex h-8 items-center justify-between w-full">

                <div className="flex items-center gap-2">
                    <NavButton href="/employeeHome" label="Home" icon={HomeIcon} />
                    <Link href="/employeeHome" className="flex justify-center items-center gap-2 ml-0" title="Home">
                        <h1 className="hidden sm:block text-xl font-bold m-0 mt-1">
                            Integra
                        </h1>
                    </Link>
                </div>

                <div className="flex items-center">

                    <NavButtonMenu
                        icon={UsersRound}
                        label="Employee Profile"
                        aria-label='Employee Profile'
                        choices={[
                            { title: "Employee Profile", href: "/employeeProfile" },
                        ]}
                    />

                    <NavButtonMenu
                        icon={File}
                        label="Leave Menu"
                        aria-label='Leave Menu'
                        choices={[
                            { title: "Used Leaves and Services", href: "/employeeLeaves" },
                        ]}
                    />

                    <NavButtonMenu
                        icon={File}
                        label="Loan Menu"
                        aria-label='Loan Menu'
                        choices={[
                            { title: "Employee Loan Table", href: "/employeeLoans" },
                        ]}
                    />
                    <NavButtonMenu
                        icon={File}
                        label="Payslip Menu"
                        aria-label='Payslip Menu'
                        choices={[
                            { title: "Employee Payslip Table", href: "/employeePayslips" },
                        ]}
                    />

                    {/* <NavButtonMenu
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
                    /> */}


                    <NavButtonMenu
                        icon={File}
                        label="File Menu"
                        aria-label='File Menu'
                        choices={[
                            { title: "Employee File Table", href: "/employeeProfileFiles" },
                            { title: "Upload Employee File", href: "/employeeProfileFiles/form" }
                        ]}
                    />
                    <ModeToggle />

                    <form action={logoutAction}>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label='LogOut'
                            title="LogOut"
                            className="rounded-full"
                            type="submit"
                        >
                            <LogOut />
                        </Button>
                    </form>
                </div>

            </div>

        </header>
    )
}

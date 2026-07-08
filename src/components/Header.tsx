import {
  HomeIcon,
  File,
  UsersRound,
  LogOut,
  Settings,
  FolderUpIcon,
  BanknoteIcon,
  Calendar1Icon,
  HandCoins,
} from "lucide-react";
import Link from "next/link";
import { logoutAction } from "@/app/actions/authAction";
import { Button } from "@/components/ui/button";
import { NavButton } from "@/components/NavButton";
import { ModeToggle } from "@/components/ModeToggle";
import { NavButtonMenu } from "./NavButtonMenu";
import { getCurrentAuthContext, hasPermission } from "@/lib/auth/server";
import { AUTH_PERMISSIONS } from "@/lib/auth/permissions";

export async function Header() {
  const auth = await getCurrentAuthContext();
  const canManageAccess = auth
    ? hasPermission(auth, AUTH_PERMISSIONS.ACCESS_MANAGE)
    : false;

  return (
    <header className="animate-slide bg-background h-12 p-2 border-b sticky top-0 z-max">
      <div className="flex h-8 items-center justify-between w-full">
        <div className="flex items-center gap-2">
          <NavButton href="/home" label="Home" icon={HomeIcon} />
          <Link
            href="/home"
            className="flex justify-center items-center gap-2 ml-0"
            title="Home"
          >
            <h1 className="hidden sm:block text-xl font-bold m-0 mt-1">
              Integra
            </h1>
          </Link>
        </div>

        <div className="flex items-center">
          <NavButtonMenu
            icon={UsersRound}
            label="Employee Menu"
            aria-label="Employee Menu"
            choices={[
              { title: "Search Employee", href: "/employeeMaster" },
              { title: "New Employee", href: "/employeeMaster/form" },
            ]}
          />

          <NavButtonMenu
            icon={Calendar1Icon}
            label="Leave Menu"
            aria-label="Leave Menu"
            choices={[
              { title: "Used Leaves and Services", href: "/leaves" },
              { title: "Branch Calendar", href: "/branchCalendar" },
              { title: "Create Leave Request", href: "/leaves/form" },
            ]}
          />
          <NavButtonMenu
            icon={BanknoteIcon}
            label="Salary Adjustment"
            aria-label="Salary Adjust Menu"
            choices={[
              {
                title: "Employee Salary Adjustment",
                href: "/salaryAdjustment",
              },
            ]}
          />

          <NavButtonMenu
            icon={File}
            label="Payroll Menu"
            aria-label="Payroll Menu"
            choices={[{ title: "Payroll Workspace", href: "/payroll" }]}
          />

          <NavButtonMenu
            icon={HandCoins}
            label="Loan Menu"
            aria-label="Loan Menu"
            choices={[
              { title: "Employee Loan Table", href: "/loans" },
              { title: "Create Employee Loan", href: "/loans/form" },
            ]}
          />

          <NavButtonMenu
            icon={FolderUpIcon}
            label="File Menu"
            aria-label="File Menu"
            choices={[
              { title: "Employee File Table", href: "/employeeFiles" },
              { title: "Upload Employee File", href: "/employeeFiles/form" },
            ]}
          />

          <NavButtonMenu
            icon={Settings}
            label="Settings"
            aria-label="Settings Menu"
            choices={[
              {
                title: "General Codes Menu",
                children: [
                  ...(canManageAccess
                    ? [
                        {
                          title: "Access Management",
                          href: "/access-management",
                        },
                      ]
                    : []),
                  {
                    title: "Account Codes",
                    href: "/constants/accountCode/form",
                  },
                  {
                    title: "SL/VL Group Codes",
                    href: "/constants/slvlGroupCode/form",
                  },
                  {
                    title: "Department Codes",
                    href: "/constants/departmentCode/form",
                  },
                  {
                    title: "Position Codes",
                    href: "/constants/positionCode/form",
                  },
                  {
                    title: "Payroll Codes",
                    href: "/constants/payrollCode",
                  },
                ],
              },
              {
                title: "TimeKeeping Menu",
                children: [
                  {
                    title: "Leave Type",
                    href: "/constants/leaveTypeCode/form",
                  },
                  {
                    title: "Holiday Type",
                    href: "/constants/holidayType/form",
                  },
                  {
                    title: "Holiday Calendar",
                    href: "/constants/holidayCode/form",
                  },
                  {
                    title: "Shift Table",
                    href: "/constants/shiftTable/form",
                  },
                  {
                    title: "Undertime Table",
                    href: "/constants/undertimeTable/form",
                  },
                  {
                    title: "Overtime Table",
                    href: "/constants/overtimeTable/form",
                  },
                  {
                    title: "Tardiness Table",
                    href: "/constants/tardinessTable/form",
                  },
                ],
              },
              {
                title: "Mandatory Contributions Menu",
                children: [
                  {
                    title: "Statutory Versions",
                    href: "/constants/statutoryRuleVersion/form",
                  },
                  {
                    title: "SSS Brackets",
                    href: "/constants/sssContributionBracket/form",
                  },
                  {
                    title: "PhilHealth Rates",
                    href: "/constants/philhealthContributionRate/form",
                  },
                  {
                    title: "Pag-IBIG Rates",
                    href: "/constants/pagibigContributionRate/form",
                  },
                  {
                    title: "BIR Tax Brackets",
                    href: "/constants/birWithholdingTaxBracket/form",
                  },
                ],
              },
            ]}
          />

          <ModeToggle />

          <form action={logoutAction}>
            <Button
              variant="ghost"
              size="icon"
              aria-label="LogOut"
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
  );
}

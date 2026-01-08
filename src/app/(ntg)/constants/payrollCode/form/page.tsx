import { getPayrollCode } from "@/lib/queries/getCustomPayroll";
import { BackButton } from "@/components/BackButton";
import PayrollCodeForm from "@/app/(ntg)/constants/payrollCode/form/payrollCodeForm";

export async function generateMetadata({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
    const { customPayrollId } = await searchParams;

    if (!customPayrollId) return { title: "New Employee" };

    return { title: `Edit Employee #${customPayrollId}` };
}

export default async function EmployeeFormPage({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
    try {
        const { customPayrollId } = await searchParams;
        let employee = undefined;

        if (customPayrollId) {
            employee = await getPayrollCode(customPayrollId);
        }

        return (
            <div className="p-6">
                {customPayrollId && !employee ? (
                    <>
                        <h2 className="text-2xl mb-2">Employee ID #{customPayrollId} Not Found.</h2>
                        <BackButton title="Go Back" variant="default" />
                    </>
                ) : (
                    <>
                        <PayrollCodeForm 
                        key={customPayrollId}
                        />
                    </>
                )}
            </div>
        );
    } catch (e) {
        if (e instanceof Error) {
            throw e;
        }
    }
}

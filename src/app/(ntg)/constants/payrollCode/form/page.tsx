import { getPayrollCode } from "@/lib/queries/getCustomPayroll";
import { BackButton } from "@/components/BackButton";
import PayrollCodeForm from "@/app/(ntg)/constants/payrollCode/form/payrollCodeForm";

export async function generateMetadata({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
    const { customPayrollId } = await searchParams;

    if (!customPayrollId) return { title: "New Payroll COde" };

    return { title: `Edit Payroll Code #${customPayrollId}` };
}

export default async function CustomPayrollCodePage({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
    try {
        const { customPayrollId } = await searchParams;
        let payrollCode = undefined;

        if (customPayrollId) {
            payrollCode = await getPayrollCode(Number(customPayrollId));
          }

        return (
            <div className="p-6">
                {customPayrollId && !payrollCode ? (
                    <>
                        <h2 className="text-2xl mb-2">Payroll Code ID #{customPayrollId} Not Found.</h2>
                        <BackButton title="Go Back" variant="default" />
                    </>
                ) : (
                    <>
                        <PayrollCodeForm
                        key={customPayrollId}
                        initialData={payrollCode}
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

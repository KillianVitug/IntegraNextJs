import { getBiometricsDataPageData } from "@/app/actions/biometricsDataAction";
import { PageHeader } from "@/components/layout/page-layout";
import BiometricsDataClient from "./BiometricsDataClient";

export const metadata = {
  title: "Biometrics Data",
};

function readYear(value: string | undefined) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100
    ? parsed
    : undefined;
}

export default async function BiometricsDataPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; periodId?: string }>;
}) {
  const params = await searchParams;
  const data = await getBiometricsDataPageData({
    year: readYear(params.year),
    periodId: params.periodId,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Biometrics Data"
        description="Review and manage imported DTR/Biometrics files by payroll period."
      />
      <BiometricsDataClient data={data} />
    </div>
  );
}

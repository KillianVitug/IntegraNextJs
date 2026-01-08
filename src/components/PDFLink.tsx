"use client";

import { PDFDownloadLink } from "@react-pdf/renderer";
import LeaveSummaryPDF from "@/components/pdf/LeaveSummaryPDF";
import type { SickAndLeaveResultsType } from "@/lib/queries/getSickAndLeave";
import { Button } from "@/components/ui/button";

type EnrichedRowType = SickAndLeaveResultsType[0] & {
    yearsOfService: number;
    monthsOfService: number;
  };
  
  type Props = {
    data: EnrichedRowType[];
    asOfDate: Date;
    filterYear: string;
  };

export default function PDFLink({ data, asOfDate, filterYear }: Props) {
  return (
    <PDFDownloadLink
      document={<LeaveSummaryPDF data={data} asOfDate={asOfDate} />}
      fileName={`LeaveSummary_${filterYear}.pdf`}
    >
      {({ loading }) => (
        <Button variant="outline" disabled={loading}>
          {loading ? "Generating PDF..." : "Download PDF"}
        </Button>
      )}
    </PDFDownloadLink>
  );
}


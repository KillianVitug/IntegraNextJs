
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { SickAndLeaveResultsType } from "@/lib/queries/getSickAndLeave";

// Style definitions
const styles = StyleSheet.create({
    page: {
      padding: 24,
      fontSize: 10,
      fontFamily: "Helvetica",
    },
    section: {
      marginBottom: 12,
    },
    departmentTitle: {
      fontSize: 12,
      fontWeight: "bold",
      marginBottom: 4,
    },
    table: {
      width: "100%",
      marginBottom: 8,
      flexDirection: "column",
    },
    tableRow: {
      flexDirection: "row",
    },
    tableHeader: {
      fontWeight: "bold",
      borderBottomWidth: 1,
      borderBottomColor: "#000",
      paddingBottom: 4,
    },
    tableCell: {
      padding: 4,
      flexGrow: 1,
      flexBasis: 0,
      borderRightWidth: 1,
      borderRightColor: "#ccc",
    },
    lastCell: {
      borderRightWidth: 0,
    },
  });

function groupByDepartment(data: EnrichedRowType[]) {
    const map = new Map<string, EnrichedRowType[]>();
    data.forEach((item) => {
      const dept = item.department ?? "Unknown Department";
      if (!map.has(dept)) map.set(dept, []);
      map.get(dept)!.push(item);
    });
    return map;
  }

type EnrichedRowType = SickAndLeaveResultsType[0] & {
    yearsOfService: number;
    monthsOfService: number;
  };
  
  type Props = {
    data: EnrichedRowType[];
    asOfDate: Date;
  };
  
  export default function LeaveSummaryPDF({ data,/*asOfDate*/ }: Props) {
    const grouped = groupByDepartment(data ?? []);
  
    return (
      <Document>
        <Page size="A4" style={styles.page}>
          {Array.from(grouped.entries()).map(([department, employees]) => (
            <View key={department} style={styles.section}>
              <Text style={styles.departmentTitle}>{`Department: ${department}`}</Text>
  
              <View style={styles.table}>
                <View style={[styles.tableRow, styles.tableHeader]}>
                  {["Full Name", "Date Hired", "Years of Service", "Months of Service", "Sick Leave", "Vacation Leave"].map((header, i, arr) => (
                    <Text
                    key={header}
                    style={[styles.tableCell, i === arr.length - 1 ? styles.lastCell : {}]}
                  >
                    {header}
                  </Text>
                  ))}
                </View>
  
                {employees.map((e) => (
                  <View key={e.id} style={styles.tableRow}>
                    <Text style={styles.tableCell}>{e.fullName}</Text>
                    <Text style={styles.tableCell}>
                      {e.dateHired ? new Date(e.dateHired).toLocaleDateString() : "-"}
                    </Text>
                    <Text style={styles.tableCell}>
                    {e.yearsOfService.toFixed(2)}
                    </Text>
                    <Text style={styles.tableCell}>
                    {(e.monthsOfService % 12).toFixed(2)}
                    </Text>
                    <Text style={styles.tableCell}>
                    {e.sickLeave != null ? Number(e.sickLeave).toFixed(2) : "0.00"}
                    </Text>
                    <Text style={[styles.tableCell, styles.lastCell]}>
                    {e.vacationLeave != null ? Number(e.vacationLeave).toFixed(2) : "0.00"}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </Page>
      </Document>
    );
  }
  
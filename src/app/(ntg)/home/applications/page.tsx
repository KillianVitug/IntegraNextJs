import { redirect } from "next/navigation";

export const metadata = {
  title: "Applications",
};

export default async function ApplicationsPage() {
  redirect("/home/schedule-requests");
}

// Trust anchor, NOT user configuration. Keep unverified until an authorized operator
// independently checks the endpoint-to-branch association in the Neon dashboard.
// A branch label, database name, or a hostname copied from the credential is not proof.
export const destination = {
  projectId: "quiet-wildflower-71375304",
  branchId: "br-dark-field-a1zdusec",
  branchName: "attendance-test",
  endpointId: "ep-silent-cherry-a15ljl8p",
  hosts: ["ep-silent-cherry-a15ljl8p-pooler.ap-southeast-1.aws.neon.tech", "ep-silent-cherry-a15ljl8p.ap-southeast-1.aws.neon.tech"] as string[],
  database: "neondb",
  verifiedFromDashboardAt: "2026-10-01T12:22:33Z",
};

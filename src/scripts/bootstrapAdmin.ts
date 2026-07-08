import { config } from "dotenv";

type ParsedArgs = {
  email?: string;
  level?: "Managerial" | "Supervisory";
  firstName?: string;
  lastName?: string;
  tempPassword?: string;
  help: boolean;
};

function printUsage() {
  console.log(`
Usage:
  npm run auth:bootstrap-admin -- --email admin@company.com --temp-password "pass1" [--level Managerial|Supervisory] [--first-name Jane --last-name Doe]

Examples:
  npm run auth:bootstrap-admin -- --email admin@company.com --temp-password "pass1"
  npm run auth:bootstrap-admin -- --email admin@company.com --temp-password "pass1" --first-name Jane --last-name Doe
  npm run auth:bootstrap-admin -- --email admin@company.com --level Supervisory --temp-password "pass1" --first-name Jane --last-name Doe
`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }

    const value = argv[index + 1];
    if (!token.startsWith("--") || value == null) {
      throw new Error(`Invalid argument: ${token}`);
    }

    switch (token) {
      case "--email":
        parsed.email = value;
        break;
      case "--level":
        if (value !== "Managerial" && value !== "Supervisory") {
          throw new Error("Level must be either Managerial or Supervisory.");
        }
        parsed.level = value;
        break;
      case "--first-name":
        parsed.firstName = value;
        break;
      case "--last-name":
        parsed.lastName = value;
        break;
      case "--temp-password":
        parsed.tempPassword = value;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }

    index += 1;
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  if (!args.email) {
    printUsage();
    throw new Error("Email is required.");
  }

  if (!args.tempPassword) {
    printUsage();
    throw new Error("Temporary password is required.");
  }

  config({ path: ".env.local" });

  const { bootstrapFirstAdmin } = await import("../lib/auth/bootstrap");

  const result = await bootstrapFirstAdmin({
    email: args.email,
    level: args.level,
    firstName: args.firstName,
    lastName: args.lastName,
    tempPassword: args.tempPassword,
  });

  console.log("First admin bootstrap complete.");
  console.log(`Source: ${result.source}`);
  console.log(`Email: ${result.email}`);
  console.log(`Employee ID: ${result.employeeId}`);
  console.log(`Confidentiality: ${result.confidentialityLevel}`);
  console.log(`Account Status: ${result.accountStatus}`);
  console.warn("Share this temporary password securely and require a change on first login:");
  console.warn(args.tempPassword);
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Bootstrap failed unexpectedly.",
  );
  process.exit(1);
});

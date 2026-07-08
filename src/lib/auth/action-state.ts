export type AuthActionState = {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors?: Record<string, string[]>;
  onboarding?: {
    email: string;
  };
  passwordSetup?: {
    email: string;
    token: string;
  };
  temporaryPasswordReveal?: {
    accountId: string;
    password: string;
  };
  inviteCode?: string;
};

export const initialAuthActionState: AuthActionState = {
  status: "idle",
  message: null,
};

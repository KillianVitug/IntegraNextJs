export type SaveEmployeeSuccess = {
  employeeId: string;
};

export type SaveEmployeeResult =
  | { data: SaveEmployeeSuccess; message: string }
  | { serverError: string };
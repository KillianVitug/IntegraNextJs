import { expect, test, type Page } from "@playwright/test";
import {
  getActiveWeeklyShiftPatternForDate,
  type WeeklyShiftPatternRecord,
} from "../../src/lib/payroll/scheduleResolver";

const managerEmail = process.env.PLAYWRIGHT_MANAGER_EMAIL;
const managerPassword = process.env.PLAYWRIGHT_MANAGER_PASSWORD;

async function loginAsManager(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("#login-email").fill(managerEmail ?? "");
  await page.locator("#login-password").fill(managerPassword ?? "");

  const loginForm = page.locator("form").filter({
    has: page.locator("#login-email"),
  });

  await Promise.all([
    page
      .waitForURL(/\/(managerHome|home|employeeHome)(?:\?|$)/, {
        timeout: 30_000,
      })
      .catch(() => null),
    loginForm.getByRole("button", { name: /^Login$/ }).click(),
  ]);
}

function weeklyPattern(id: number, effectiveFrom: string): WeeklyShiftPatternRecord {
  return {
    id,
    employeeId: "00000000-0000-0000-0000-000000000001",
    effectiveFrom,
    effectiveTo: null,
    createdAt: new Date("2026-01-01T00:00:00"),
    updatedAt: new Date("2026-01-01T00:00:00"),
    days: [],
  } as unknown as WeeklyShiftPatternRecord;
}

test("overlapping weekly schedules resolve to the newest created pattern", () => {
  const activePattern = getActiveWeeklyShiftPatternForDate(
    [
      weeklyPattern(10, "2026-01-05"),
      weeklyPattern(25, "2026-01-01"),
    ],
    "2026-01-07",
  );

  expect(activePattern?.id).toBe(25);
});

test.describe("manager legacy browser fallbacks", () => {
  test.skip(
    !managerEmail || !managerPassword,
    "Set PLAYWRIGHT_MANAGER_EMAIL and PLAYWRIGHT_MANAGER_PASSWORD to run manager fallback tests.",
  );

  test.use({ javaScriptEnabled: false });

  test.beforeEach(async ({ page }) => {
    await loginAsManager(page);
    await expect(page).toHaveURL(/\/managerHome(?:\?|$)/);
  });

  test("manager navigation renders and links work without JavaScript", async ({
    page,
  }) => {
    await expect(page.getByRole("link", { name: /Dashboard/i })).toBeVisible();

    const sidebar = page.locator(".app-sidebar").first();
    const sidebarToggle = page.locator('label[for="app-sidebar-toggle"]').first();
    await expect(sidebar).toHaveCSS("width", "240px");
    await sidebarToggle.click();
    await expect(sidebar).toHaveCSS("width", "56px");
    await sidebarToggle.click();
    await expect(sidebar).toHaveCSS("width", "240px");

    await page.getByRole("link", { name: /Calendar/i }).click();
    await expect(page).toHaveURL(/\/managerCalendar(?:\?|$)/);
    await expect(page.getByRole("heading", { name: /Manager Calendar/i })).toBeVisible();

    await page.getByRole("link", { name: /Leave Requests/i }).click();
    await expect(page).toHaveURL(/\/managerLeaves(?:\?|$)/);
    await expect(
      page.getByRole("heading", { name: /Manager Leave Requests/i }),
    ).toBeVisible();

    await page.getByRole("link", { name: /^Schedules$/i }).click();
    await expect(page).toHaveURL(/\/managerSchedules(?:\?|$)/);
    await expect(page.getByRole("heading", { name: /Manager Schedules/i })).toBeVisible();
  });

  test("calendar day and month navigation works without JavaScript", async ({
    page,
  }) => {
    await page.goto("/managerCalendar", { waitUntil: "domcontentloaded" });

    const firstDayLink = page.locator('a[href*="/managerCalendar?"][href*="day="]').first();
    await expect(firstDayLink).toBeVisible();
    await firstDayLink.click();
    await expect(page).toHaveURL(/\/managerCalendar\?[^#]*day=/);
    await expect(page.getByText("Day Schedule")).toBeVisible();

    await page.getByLabel("Next month").click();
    await expect(page).toHaveURL(/\/managerCalendar\?[^#]*month=/);
  });

  test("leave filters, balance check, and edit controls work without JavaScript", async ({
    page,
  }) => {
    await page.goto("/managerLeaves", { waitUntil: "domcontentloaded" });

    const employeeSelect = page.locator("#balance-employee");
    if ((await employeeSelect.locator("option").count()) === 0) {
      test.skip(true, "No employees are available for the manager test user.");
    }

    const leaveTypeSelect = page.locator("#balance-type");
    if ((await leaveTypeSelect.locator("option").count()) === 0) {
      test.skip(true, "No leave types are available.");
    }

    await expect(page.locator("#balance-start")).toHaveCount(0);
    await expect(
      page.locator('form[action="/managerLeaves/request"][method="post"]'),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Submit Request/i })).toBeVisible();
    await expect(page.locator("#leave-employee")).toHaveAttribute("readonly", "");
    await expect(page.locator("#leave-type")).toHaveAttribute("readonly", "");
    await expect(page.locator('input[type="hidden"][name="employeeId"]')).toHaveValue(
      await employeeSelect.inputValue(),
    );
    await expect(page.locator('input[type="hidden"][name="leaveType"]')).toHaveValue(
      await leaveTypeSelect.inputValue(),
    );

    await employeeSelect.selectOption({ index: 0 });
    await leaveTypeSelect.selectOption({ index: 0 });
    await page.getByRole("button", { name: /Check Balance/i }).click();
    await expect(page).toHaveURL(/\/managerLeaves\?[^#]*employeeId=/);
    await expect(page).toHaveURL(/\/managerLeaves\?[^#]*leaveType=/);
    await expect(page.getByText(/Available Balance/i)).toBeVisible();
    await expect(page.locator("#leave-employee")).toHaveAttribute("readonly", "");
    await expect(page.locator("#leave-type")).toHaveAttribute("readonly", "");
    await expect(page.locator('input[type="hidden"][name="employeeId"]')).toHaveValue(
      await page.locator("#balance-employee").inputValue(),
    );
    await expect(page.locator('input[type="hidden"][name="leaveType"]')).toHaveValue(
      await page.locator("#balance-type").inputValue(),
    );

    const editLink = page.getByRole("link", { name: /^Edit$/ }).first();
    if (await editLink.isVisible()) {
      await editLink.click();
      await expect(page).toHaveURL(/\/managerLeaves\?[^#]*editLeaveId=/);
      await expect(page.locator("#leave-employee")).toHaveAttribute("readonly", "");
      await expect(page.locator("#leave-type")).toHaveAttribute("readonly", "");
      await expect(page.locator('input[type="hidden"][name="employeeId"]')).not.toHaveValue("");
      await expect(page.locator('input[type="hidden"][name="leaveType"]')).not.toHaveValue("");
      await expect(page.locator('input[name="leaveStartDate"]').last()).toHaveValue(
        /\d{4}-\d{2}-\d{2}/,
      );
      await expect(page.locator('textarea[name="reason"]').first()).toBeVisible();
      await expect(page.getByRole("button", { name: /Update Request/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /Cancel Request/i })).toBeVisible();
      await expect(page.getByRole("link", { name: /Cancel Edit/i })).toHaveAttribute(
        "href",
        `/managerLeaves?year=${new Date().getFullYear()}`,
      );
      await expect(page.locator('button[formaction="/managerLeaves/request/cancel"]')).toBeVisible();
    }
  });

  test("schedule weekly form renders without JavaScript", async ({
    page,
  }) => {
    await page.goto("/managerSchedules", { waitUntil: "domcontentloaded" });

    const employeeLinks = page.locator('a[href*="/managerSchedules?employeeId="]');
    if ((await employeeLinks.count()) === 0) {
      test.skip(true, "No employees are available for the manager test user.");
    }

    await expect(page.getByText("Weekly Schedule Manager")).toBeVisible();
    const weeklyForm = page.locator(
      'form[action="/managerSchedules/weekly-schedule"][method="post"]',
    );
    await expect(
      weeklyForm,
    ).toBeVisible();
    await expect(
      page.locator('form[action="/managerSchedules/schedule-request"][method="post"]'),
    ).toHaveCount(0);
    await expect(page.getByText("Sudden Schedule Change Request")).toHaveCount(0);
    await expect(page.getByText("Submitted Schedule Requests")).toHaveCount(0);
    await expect(page.locator("#weekly-effective-from")).toHaveCount(0);
    await expect(page.locator("#weekly-effective-to")).toHaveCount(0);
    await expect(page.locator('select[name="day-Monday"]')).toBeVisible();
    const existingWeeklyScheduleRows = page
      .locator("table", {
        has: page.getByRole("columnheader", { name: "Coverage" }),
      })
      .locator("tbody tr");
    expect(await existingWeeklyScheduleRows.count()).toBeLessThanOrEqual(1);

    const patternEditLink = page.locator('a[href*="editPatternId="]').first();
    if (await patternEditLink.isVisible()) {
      await patternEditLink.click();
      await expect(page).toHaveURL(/\/managerSchedules\?[^#]*editPatternId=/);
      await expect(page.getByRole("button", { name: /Update Weekly Schedule/i })).toBeVisible();
      await expect(page.getByRole("link", { name: /Cancel Edit/i })).toHaveAttribute(
        "href",
        /\/managerSchedules\?employeeId=/,
      );
    }
  });

  test("schedule weekly grid tab renders without JavaScript", async ({
    page,
  }) => {
    await page.goto("/managerSchedules?tab=weeklySchedule", {
      waitUntil: "domcontentloaded",
    });

    await expect(page).toHaveURL(/\/managerSchedules\?[^#]*tab=weeklySchedule/);
    await expect(
      page.getByRole("link", { name: /^Weekly Base Schedule$/i }),
    ).toBeVisible();

    const weeklyGridForm = page.locator(
      'form[action="/managerSchedules/weekly-schedule/bulk"][method="post"]',
    );
    await expect(weeklyGridForm).toBeVisible();
    await expect(page.locator("#weekly-grid-effective-from")).toHaveCount(0);
    await expect(page.locator("#weekly-grid-effective-to")).toHaveCount(0);

    for (const header of [
      "Employees",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]) {
      await expect(
        weeklyGridForm.getByRole("columnheader", { name: header }),
      ).toBeVisible();
    }
    const weeklyColumnHeaders = weeklyGridForm.getByRole("columnheader");
    await expect(
      weeklyGridForm.getByTestId("weekly-base-schedule-employees-header"),
    ).toHaveClass(/sticky/);
    await expect(
      weeklyGridForm.getByTestId("weekly-base-schedule-employees-header"),
    ).toHaveClass(/left-0/);

    const employeeInputs = weeklyGridForm.locator('input[name="employeeId"]');
    if ((await employeeInputs.count()) === 0) {
      test.skip(true, "No employees are available for the manager test user.");
    }

    const firstEmployeeId = await employeeInputs.first().inputValue();
    for (const weekday of [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]) {
      const daySelect = weeklyGridForm.locator(
        `select[name="day-${firstEmployeeId}-${weekday}"]`,
      );
      await expect(daySelect).toBeVisible();
      await expect(daySelect.locator("option").first()).toHaveText(
        /Off \/ Rest Day/i,
      );
    }

    const mondayOptions = weeklyGridForm
      .locator(`select[name="day-${firstEmployeeId}-Monday"] option`);
    if ((await mondayOptions.count()) > 1) {
      await expect(mondayOptions.nth(1)).toHaveText(
        /^.+ \| .+ \| \d{2}:\d{2} - \d{2}:\d{2}$/,
      );
    }

    await expect(
      weeklyGridForm.getByRole("button", { name: /^Save Weekly Base Schedule$/i }),
    ).toBeVisible();
    await expect(
      weeklyGridForm.getByTestId("weekly-base-schedule-employee-cell").first(),
    ).toHaveClass(/sticky/);
    await expect(
      weeklyGridForm.getByTestId("weekly-base-schedule-employee-cell").first(),
    ).toHaveClass(/left-0/);
    await expect(
      weeklyGridForm.getByTestId("weekly-base-schedule-employee-cell").first(),
    ).toHaveClass(/bg-background/);
    await expect(
      weeklyGridForm.getByTestId("weekly-base-schedule-employee-cell").first(),
    ).toHaveClass(/group-hover:bg-sky-50/);
    expect(await weeklyColumnHeaders.count()).toBe(8);

    await expect(page.getByText("Payroll Period Schedule")).toBeVisible();
    const periodSelect = page.locator("#weekly-period");
    await expect(periodSelect).toBeVisible();
    const selectedPeriodId = await periodSelect.inputValue();
    if (!selectedPeriodId) {
      test.skip(true, "No payroll periods are available for the current year.");
    }

    await expect(
      page.locator(
        'form[action="/managerSchedules/period-schedule"][method="post"]',
      ),
    ).toBeVisible();
    const periodGridForm = page.locator(
      'form[action="/managerSchedules/period-schedule"][method="post"]',
    );
    await expect(
      periodGridForm.locator(`input[type="hidden"][name="periodId"]`),
    ).toHaveValue(selectedPeriodId);
    await expect(
      periodGridForm.locator('input[type="hidden"][name="datePage"]'),
    ).toHaveCount(0);

    const periodColumnHeaders = periodGridForm.getByRole("columnheader");
    await expect(periodColumnHeaders.first()).toHaveText(/Employees/i);
    await expect(
      periodGridForm.getByTestId("period-schedule-employees-header"),
    ).toHaveClass(/sticky/);
    await expect(
      periodGridForm.getByTestId("period-schedule-employees-header"),
    ).toHaveClass(/left-0/);
    expect(await periodColumnHeaders.count()).toBeGreaterThan(1);
    await expect(periodColumnHeaders.nth(1)).toHaveText(
      /[A-Z][a-z]{2} \d{1,2} - (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/,
    );

    const periodDaySelects = periodGridForm.locator('select[name^="period-day-"]');
    await expect(periodDaySelects.first()).toBeVisible();
    const firstEmployeePeriodDaySelects = periodGridForm.locator(
      `select[name^="period-day-${firstEmployeeId}-"]`,
    );
    await expect(firstEmployeePeriodDaySelects.first()).toBeVisible();
    await expect(
      periodGridForm.getByTestId("period-schedule-employee-cell").first(),
    ).toHaveClass(/sticky/);
    await expect(
      periodGridForm.getByTestId("period-schedule-employee-cell").first(),
    ).toHaveClass(/left-0/);
    await expect(
      periodGridForm.getByTestId("period-schedule-employee-cell").first(),
    ).toHaveClass(/bg-background/);
    await expect(
      periodGridForm.getByTestId("period-schedule-employee-cell").first(),
    ).toHaveClass(/group-hover:bg-sky-50/);
    await expect(
      periodGridForm.getByTestId("period-schedule-employee-cell").first(),
    ).not.toHaveClass(/group-hover:bg-muted\/50/);
    expect(await periodColumnHeaders.count()).toBe(
      (await firstEmployeePeriodDaySelects.count()) + 1,
    );
    await expect(periodDaySelects.first().locator("option").first()).toHaveText(
      /Off \/ Rest Day/i,
    );

    if ((await periodDaySelects.first().locator("option").count()) > 1) {
      await expect(periodDaySelects.first().locator("option").nth(1)).toHaveText(
        /^.+ \| .+ \| \d{2}:\d{2} - \d{2}:\d{2}$/,
      );
    }

    await expect(periodGridForm.getByRole("link", { name: /^Previous$/i })).toHaveCount(0);
    await expect(periodGridForm.getByRole("link", { name: /^Next$/i })).toHaveCount(0);

    const hiddenNonVisibleDateInputs = periodGridForm.locator(
      'input[type="hidden"][name^="period-day-"]',
    );
    await expect(hiddenNonVisibleDateInputs).toHaveCount(0);

    await expect(
      periodGridForm.getByRole("button", {
        name: /^Save Payroll Period Schedule$/i,
      }),
    ).toBeVisible();
  });

  test("DTR period, department, and employee controls submit without JavaScript", async ({
    page,
  }) => {
    await page.goto("/managerDtrFiles", { waitUntil: "domcontentloaded" });

    const periodSelect = page.locator("#dtr-period");
    if ((await periodSelect.locator("option").count()) === 0) {
      test.skip(true, "No payroll periods are available for the manager test user.");
    }

    await periodSelect.selectOption({ index: 0 });
    await periodSelect
      .locator("xpath=ancestor::form")
      .getByRole("button", { name: "Apply" })
      .click();
    await expect(page).toHaveURL(/\/managerDtrFiles\?[^#]*periodId=/);

    const departmentSelect = page.locator("#dtr-department");
    await departmentSelect.selectOption({ index: 0 });
    await departmentSelect
      .locator("xpath=ancestor::form")
      .getByRole("button", { name: "Apply" })
      .click();
    await expect(page).toHaveURL(/\/managerDtrFiles\?[^#]*departmentId=/);

    const employeeSelect = page.locator("#dtr-employee");
    if ((await employeeSelect.locator("option").count()) > 0) {
      await employeeSelect.selectOption({ index: 0 });
      await employeeSelect
        .locator("xpath=ancestor::form")
        .getByRole("button", { name: "Apply" })
        .click();
      await expect(page).toHaveURL(/\/managerDtrFiles\?[^#]*employeeId=/);
    }
  });

  test("DTR import form redirects with a result status without JavaScript", async ({
    page,
  }) => {
    await page.goto("/managerDtrFiles", { waitUntil: "domcontentloaded" });

    const importButton = page.getByRole("button", { name: /Import DTR/i });
    if (await importButton.isDisabled()) {
      test.skip(true, "No payroll period is available for DTR import.");
    }

    const refreshButton = page.getByRole("button", {
      name: /Refresh Stored Summaries/i,
    });
    await expect(refreshButton).toBeVisible();
    await expect(
      page.locator(
        'form[action="/managerDtrFiles/refresh-summaries"][method="post"]',
      ),
    ).toBeVisible();
    await expect(page.getByText("Imported Files")).toBeVisible();

    const removeForms = page.locator(
      'form[action="/managerDtrFiles/remove"][method="post"]',
    );
    if ((await removeForms.count()) > 0) {
      await expect(removeForms.first().getByRole("button", { name: /Remove/i })).toBeVisible();
      await expect(removeForms.first().locator('input[name="batchId"]')).toHaveCount(1);
    }

    const missingBatchRemoveResponse = await page.request.post(
      "/managerDtrFiles/remove",
      {
        form: {
          year: new Date().getFullYear().toString(),
          periodId: "",
          employeeId: "",
        },
      },
    );
    expect(missingBatchRemoveResponse.url()).toContain(
      "removeStatus=missing-batch",
    );

    await importButton.click();
    await expect(page).toHaveURL(/\/managerDtrFiles\?[^#]*importStatus=/);

    await page.goto("/managerDtrFiles", { waitUntil: "domcontentloaded" });
    const refreshButtonAfterReload = page.getByRole("button", {
      name: /Refresh Stored Summaries/i,
    });
    if (await refreshButtonAfterReload.isDisabled()) {
      test.skip(true, "No payroll period is available for DTR summary refresh.");
    }

    await refreshButtonAfterReload.click();
    await expect(page).toHaveURL(/\/managerDtrFiles\?[^#]*refreshStatus=/);
  });

  test("Attendance Hold rows expand and enter edit mode without JavaScript", async ({
    page,
  }) => {
    await page.goto("/managerDtrFiles", { waitUntil: "domcontentloaded" });

    const holdCard = page.locator("text=Attendance Hold").last();
    await expect(holdCard).toBeVisible();

    const firstDetails = page.locator("details").first();
    if ((await firstDetails.count()) === 0) {
      test.skip(true, "No Attendance Hold rows are available for the manager test user.");
    }

    await firstDetails.locator("summary").click();
    await expect(firstDetails).toHaveAttribute("open", "");

    const editableLink = page
      .locator('a[href*="holdEditEmployeeId="]', { hasText: "Edit" })
      .first();
    if ((await editableLink.count()) === 0) {
      test.skip(true, "No editable Attendance Hold rows are available.");
    }

    await editableLink.click();
    await expect(page).toHaveURL(/\/managerDtrFiles\?[^#]*holdEditEmployeeId=/);
    await expect(page.locator('select[name="targetPayrollPeriodId"]').first()).toBeVisible();
    await expect(page.locator('input[name="workedHours"]').first()).toBeVisible();
  });
});

test.describe("manager leave request browser enhancements", () => {
  test.skip(
    !managerEmail || !managerPassword,
    "Set PLAYWRIGHT_MANAGER_EMAIL and PLAYWRIGHT_MANAGER_PASSWORD to run manager enhancement tests.",
  );

  test.beforeEach(async ({ page }) => {
    await loginAsManager(page);
    await expect(page).toHaveURL(/\/managerHome(?:\?|$)/);
  });

  test("chargeable days updates when leave dates change", async ({ page }) => {
    await page.goto("/managerLeaves", { waitUntil: "domcontentloaded" });

    const employeeSelect = page.locator("#balance-employee");
    if ((await employeeSelect.locator("option").count()) === 0) {
      test.skip(true, "No employees are available for the manager test user.");
    }

    await page.locator("#leave-start").fill("2099-01-02");
    await page.locator("#leave-end").fill("2099-01-04");
    await expect(page.locator("#leave-days")).toHaveValue("3");

    await page.locator("#leave-end").fill("");
    await expect(page.locator("#leave-days")).toHaveValue("1");

    await page.locator("#leave-end").fill("2099-01-01");
    await expect(page.locator("#leave-days")).toHaveValue("1");
  });
});

test.describe("manager weekly schedule browser enhancements", () => {
  test.skip(
    !managerEmail || !managerPassword,
    "Set PLAYWRIGHT_MANAGER_EMAIL and PLAYWRIGHT_MANAGER_PASSWORD to run manager weekly schedule enhancement tests.",
  );

  test.beforeEach(async ({ page }) => {
    await loginAsManager(page);
    await expect(page).toHaveURL(/\/managerHome(?:\?|$)/);
  });

  test("weekly grid dropdown opens with full labels and closes with AM/PM time", async ({
    page,
  }) => {
    await page.goto("/managerSchedules?tab=weeklySchedule", {
      waitUntil: "domcontentloaded",
    });

    const weeklyGridForm = page.locator(
      'form[action="/managerSchedules/weekly-schedule/bulk"][method="post"]',
    );
    const employeeInputs = weeklyGridForm.locator('input[name="employeeId"]');
    if ((await employeeInputs.count()) === 0) {
      test.skip(true, "No employees are available for the manager test user.");
    }
    const weeklyColumnHeaders = weeklyGridForm.getByRole("columnheader");
    await expect(
      weeklyGridForm.getByTestId("weekly-base-schedule-employees-header"),
    ).toHaveClass(/sticky/);
    await expect(
      weeklyGridForm.getByTestId("weekly-base-schedule-employees-header"),
    ).toHaveClass(/left-0/);
    expect(await weeklyColumnHeaders.count()).toBe(8);

    const firstEmployeeId = await employeeInputs.first().inputValue();
    const mondayFieldName = `day-${firstEmployeeId}-Monday`;
    const mondayTrigger = weeklyGridForm
      .locator('[aria-label$=" Monday schedule"]')
      .first();
    const firstWeeklyRow = mondayTrigger.locator("xpath=ancestor::tr");
    const firstWeeklyEmployeeCell = firstWeeklyRow.getByTestId(
      "weekly-base-schedule-employee-cell",
    );

    await expect(mondayTrigger).toBeVisible();
    await expect(firstWeeklyRow).toHaveClass(/hover:bg-sky-50/);
    await expect(firstWeeklyRow).toHaveClass(
      /data-\[state=selected\]:bg-sky-50/,
    );
    await mondayTrigger.click();
    await expect(firstWeeklyRow).toHaveAttribute("data-state", "selected");
    await expect(firstWeeklyEmployeeCell).toHaveClass(/bg-sky-50/);
    await expect(firstWeeklyEmployeeCell).not.toHaveClass(/bg-muted/);

    const scheduleOptions = page.getByRole("option");
    if ((await scheduleOptions.count()) <= 1) {
      test.skip(true, "No shift tables are available for the manager test user.");
    }

    await expect(scheduleOptions.nth(1)).toHaveText(
      /^.+ \| .+ \| \d{2}:\d{2} - \d{2}:\d{2}$/,
    );
    await scheduleOptions.nth(1).click();

    await expect(mondayTrigger).toHaveText(
      /^\d{1,2}:\d{2} [AP]M - \d{1,2}:\d{2} [AP]M$/,
    );
    await expect(mondayTrigger).not.toContainText("|");
    await expect(
      weeklyGridForm.locator(`input[type="hidden"][name="${mondayFieldName}"]`),
    ).not.toHaveValue("0");

    const weeklyRows = weeklyGridForm.locator("tr[data-employee-id]");
    if ((await weeklyRows.count()) > 1) {
      const secondWeeklyTrigger = weeklyRows
        .nth(1)
        .locator('[aria-label$=" schedule"]')
        .first();
      await secondWeeklyTrigger.focus();
      await expect(weeklyRows.first()).not.toHaveAttribute(
        "data-state",
        "selected",
      );
      await expect(weeklyRows.nth(1)).toHaveAttribute(
        "data-state",
        "selected",
      );
    }
  });

  test("period grid dropdown opens with full labels and closes with AM/PM time", async ({
    page,
  }) => {
    await page.goto("/managerSchedules?tab=weeklySchedule", {
      waitUntil: "domcontentloaded",
    });

    const periodGridForm = page.locator(
      'form[action="/managerSchedules/period-schedule"][method="post"]',
    );
    if ((await periodGridForm.count()) === 0) {
      test.skip(true, "No payroll period schedule grid is available.");
    }

    const periodTrigger = periodGridForm
      .locator('[aria-label$=" schedule"]')
      .first();
    const firstPeriodRow = periodTrigger.locator("xpath=ancestor::tr");
    const firstPeriodEmployeeCell = firstPeriodRow.getByTestId(
      "period-schedule-employee-cell",
    );
    await expect(periodTrigger).toBeVisible();
    await expect(firstPeriodRow).toHaveClass(/hover:bg-sky-50/);
    await expect(firstPeriodRow).toHaveClass(/data-\[state=selected\]:bg-sky-50/);
    await periodTrigger.click();
    await expect(firstPeriodRow).toHaveAttribute("data-state", "selected");
    await expect(firstPeriodEmployeeCell).toHaveClass(/bg-sky-50/);
    await expect(firstPeriodEmployeeCell).not.toHaveClass(/bg-muted/);

    const scheduleOptions = page.getByRole("option");
    if ((await scheduleOptions.count()) <= 1) {
      test.skip(true, "No shift tables are available for the manager test user.");
    }

    await expect(scheduleOptions.nth(1)).toHaveText(
      /^.+ \| .+ \| \d{2}:\d{2} - \d{2}:\d{2}$/,
    );
    await scheduleOptions.nth(1).click();

    await expect(periodTrigger).toHaveText(
      /^\d{1,2}:\d{2} [AP]M - \d{1,2}:\d{2} [AP]M$/,
    );
    await expect(periodTrigger).not.toContainText("|");
    await expect(
      periodTrigger.locator(
        'xpath=../input[@type="hidden"][starts-with(@name, "period-day-")]',
      ),
    ).not.toHaveValue("0");

    const periodRows = periodGridForm.locator("tr[data-employee-id]");
    if ((await periodRows.count()) > 1) {
      const secondPeriodTrigger = periodRows
        .nth(1)
        .locator('[aria-label$=" schedule"]')
        .first();
      await secondPeriodTrigger.focus();
      await expect(periodRows.first()).not.toHaveAttribute(
        "data-state",
        "selected",
      );
      await expect(periodRows.nth(1)).toHaveAttribute(
        "data-state",
        "selected",
      );
    }
  });
});

test.describe("manager Firefox 66 runtime compatibility", () => {
  test.skip(
    !managerEmail || !managerPassword,
    "Set PLAYWRIGHT_MANAGER_EMAIL and PLAYWRIGHT_MANAGER_PASSWORD to run manager Firefox 66 tests.",
  );

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        get: () =>
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:66.0) Gecko/20100101 Firefox/66.0",
      });

      Reflect.deleteProperty(window, "ResizeObserver");
      Reflect.deleteProperty(window, "queueMicrotask");

      if (window.CSS) {
        Reflect.deleteProperty(window.CSS, "escape");
      }
    });

    await loginAsManager(page);
    await expect(page).toHaveURL(/\/managerHome(?:\?|$)/);
  });

  for (const { route, heading } of [
    { route: "/managerCalendar", heading: /Manager Calendar/i },
    { route: "/managerLeaves", heading: /Manager Leave Requests/i },
    { route: "/managerSchedules", heading: /Manager Schedules/i },
  ]) {
    test(`${route} opens when Firefox 66 APIs are missing`, async ({ page }) => {
      const failures: string[] = [];

      page.on("pageerror", (error) => {
        failures.push(error.message);
      });
      page.on("console", (message) => {
        if (message.type() === "error") {
          failures.push(message.text());
        }
      });

      await page.goto(route, { waitUntil: "domcontentloaded" });

      await expect(page.getByText("Something went wrong")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Try again/i })).toHaveCount(0);
      await expect(
        page.getByRole("heading", {
          name: heading,
        }),
      ).toBeVisible();

      expect(failures).toEqual([]);
    });
  }
});

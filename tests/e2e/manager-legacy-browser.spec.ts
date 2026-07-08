import { expect, test, type Page } from "@playwright/test";

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
    }
  });

  test("schedule weekly and request forms render without JavaScript", async ({
    page,
  }) => {
    await page.goto("/managerSchedules", { waitUntil: "domcontentloaded" });

    const employeeLinks = page.locator('a[href*="/managerSchedules?employeeId="]');
    if ((await employeeLinks.count()) === 0) {
      test.skip(true, "No employees are available for the manager test user.");
    }

    await expect(page.getByText("Weekly Schedule Manager")).toBeVisible();
    await expect(page.locator("#weekly-effective-from")).toBeVisible();
    await expect(page.locator('select[name="day-Monday"]')).toBeVisible();
    await expect(page.locator("#request-shift-table")).toBeVisible();
    await expect(page.locator('select[name="shiftTableId"]')).toBeVisible();
    await expect(page.locator("#request-dates")).toBeVisible();
    await expect(page.locator('textarea[name="effectiveDates"]')).toBeVisible();
    await expect(page.locator('textarea[name="reason"]')).toBeVisible();

    const requestShiftOptions = page.locator("#request-shift-table option");
    await expect(requestShiftOptions.first()).toHaveText(/Select shift table/i);
    if ((await requestShiftOptions.count()) === 1) {
      await expect(page.getByRole("button", { name: /Submit Request/i })).toBeDisabled();
    }

    const patternEditLink = page.locator('a[href*="editPatternId="]').first();
    if (await patternEditLink.isVisible()) {
      await patternEditLink.click();
      await expect(page).toHaveURL(/\/managerSchedules\?[^#]*editPatternId=/);
      await expect(page.getByRole("button", { name: /Update Weekly Schedule/i })).toBeVisible();
    }

    const requestEditLink = page.locator('a[href*="editRequestId="]').first();
    if (await requestEditLink.isVisible()) {
      await requestEditLink.click();
      await expect(page).toHaveURL(/\/managerSchedules\?[^#]*editRequestId=/);
      await expect(page.getByRole("button", { name: /Update Request/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /Cancel Request/i })).toBeVisible();
    }
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

    await importButton.click();
    await expect(page).toHaveURL(/\/managerDtrFiles\?[^#]*importStatus=/);
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

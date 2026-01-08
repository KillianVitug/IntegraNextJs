export const contributionTabs = [
    { id: "SSS", label: "SSS" },
    { id: "PHILHEALTH", label: "PhilHealth" },
    { id: "PAGIBIG", label: "Pag-IBIG" },
    { id: "PERAA", label: "PERAA" },
    { id: "TAX", label: "Tax" },
  ];
  
  // Rules: checkboxes that apply only to specific tabs
  export const tabSpecificFlags = {
    PAGIBIG: [
      { id: "pagibig-max", label: "Max Contribution" },
      { id: "pagibig-deduct", label: "Deduct Share Only" },
    ],
    PERAA: [
      { id: "peraa-both", label: "Compute Employee + Employer" },
      { id: "peraa-employer", label: "Compute Employer Only" },
    ],
    TAX: [
      { id: "tax-fixed-percent", label: "Fixed Percentage" },
      { id: "tax-month-end", label: "Month-End Adjustment" },
    ],
    SSS: [
      { id: "sss-use-actual", label: "Use Actual Salary" },
      // { id: "sss-ec", label: "Apply EC Employer Portion" },
    ],
    PHILHEALTH: [
      { id: "ph-min", label: "Use Minimum Bracket" }
    ],
  };
export function enumToSelectOptions(enumValues: string[]) {
    return enumValues.map((value) => ({
        id: value, // ENUM values are strings
        name: value, // Use the same value for display
    }));
}

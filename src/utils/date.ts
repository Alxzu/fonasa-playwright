/**
 * Format date as YYYY-MM-DD (ISO format)
 */
export function formatDateISO(date: Date): string {
  return date.toISOString().split("T")[0] as string;
}

/**
 * Format date as DD/MM/YYYY (Spanish format)
 */
export function formatDateES(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Go back to previous business day (skip weekends)
 */
export function getPreviousBusinessDay(date: Date): Date {
  const newDate = new Date(date);
  newDate.setDate(newDate.getDate() - 1);

  // Skip weekends
  const dayOfWeek = newDate.getDay();
  if (dayOfWeek === 0) {
    newDate.setDate(newDate.getDate() - 2); // Sunday -> Friday
  } else if (dayOfWeek === 6) {
    newDate.setDate(newDate.getDate() - 1); // Saturday -> Friday
  }

  return newDate;
}

/**
 * Get the last day of the previous month (adjusted for weekends)
 */
export function getLastDayOfPreviousMonth(): Date {
  const today = new Date();
  // Go to last day of previous month
  const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);

  // If it's a weekend, go back to Friday
  const dayOfWeek = lastDay.getDay();
  if (dayOfWeek === 0) {
    lastDay.setDate(lastDay.getDate() - 2); // Sunday -> Friday
  } else if (dayOfWeek === 6) {
    lastDay.setDate(lastDay.getDate() - 1); // Saturday -> Friday
  }

  return lastDay;
}

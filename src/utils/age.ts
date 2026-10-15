// Deriving a character's age from their birthday.
//
// This used to sit at module scope inside CharacterForm, untested, which is how a
// birthday that has not happened yet turns into an age one year too high -- an
// off-by-one nobody notices until they check a specific character on a specific day.
// `today` is a parameter so that day can be chosen in a test rather than waited for.
//
// A `calculateAgeFromYear` sat next to it and had no caller anywhere: `birthYear` is
// only ever written as "" and no input is bound to it. It is gone rather than moved,
// because a helper nothing calls is the kind of thing that gets wired up later by
// mistake.

/**
 * Whole years from a date input value, or "" when there is nothing usable.
 *
 * The birthday comparison is what the off-by-one turns on: someone born in December
 * is a year younger than the simple subtraction says until December comes round.
 */
export function calculateAgeFromDate(value: string, today: Date = new Date()): string {
  if (!value) {
    return "";
  }

  const birthDate = new Date(value);

  if (Number.isNaN(birthDate.getTime())) {
    return "";
  }

  let age = today.getFullYear() - birthDate.getFullYear();
  const hasBirthdayPassed =
    today.getMonth() > birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());

  if (!hasBirthdayPassed) {
    age -= 1;
  }

  return age >= 0 ? String(age) : "";
}

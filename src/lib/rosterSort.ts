/** Sort by first name (first word) A–Z, case-insensitive. */
export function sortByFirstName<T extends { name: string }>(people: T[]): T[] {
  return [...people].sort((a, b) => {
    const firstA = (a.name.split(/\s+/)[0] ?? a.name).toLowerCase();
    const firstB = (b.name.split(/\s+/)[0] ?? b.name).toLowerCase();
    return firstA.localeCompare(firstB);
  });
}

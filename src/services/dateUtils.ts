export function calculateAge(birthDateStr?: string, fallbackAge: number = 0): number {
  if (!birthDateStr) return fallbackAge;
  const birth = new Date(birthDateStr);
  if (isNaN(birth.getTime())) return fallbackAge;
  
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age >= 0 ? age : 0;
}

export function formatDateForInput(dateInput?: string | Date | null): string {
  if (!dateInput) return '';
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function calculateDaysBetween(startDateStr?: string, endDateStr?: string): number | undefined {
  if (!startDateStr || !endDateStr) return undefined;
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return undefined;

  // Set time to midnight UTC for precise calendar day differences
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());

  if (endUtc < startUtc) return 1;

  const diffTime = endUtc - startUtc;
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1; // Inclusive of start & end day
  return diffDays > 0 ? diffDays : 1;
}

export function addDaysToDate(startDateStr: string, days: number): string {
  if (!startDateStr || isNaN(Number(days)) || days <= 0) return '';
  const start = new Date(startDateStr);
  if (isNaN(start.getTime())) return '';
  
  // Create a copy and add (days - 1) days
  const result = new Date(start);
  result.setDate(result.getDate() + (days - 1));
  return formatDateForInput(result);
}

export function getDisplayPaidByName(
  expense: { paidBy?: string; paidByName?: string; createdBy?: string; createdByName?: string; ownerId?: string },
  currentUserId?: string,
  people: { id: string; name: string }[] = []
): string {
  // If paidBy matches a Person ID in people list (and it's not 'me' or user UID)
  if (expense.paidBy && expense.paidBy !== 'me' && expense.paidBy !== currentUserId) {
    const person = people.find(p => p.id === expense.paidBy);
    if (person) return person.name;
  }

  // Is this expense paid or created by the currently logged in user?
  const isMe = Boolean(
    currentUserId && (
      expense.paidBy === currentUserId ||
      (expense.paidBy === 'me' && (expense.createdBy === currentUserId || !expense.createdBy)) ||
      (expense.createdBy === currentUserId && (expense.paidBy === 'me' || expense.paidByName === 'Já'))
    )
  );

  if (isMe) {
    return 'Já';
  }

  // For another user viewing this expense:
  // 1. Check if paidBy is a Person ID matching a Person
  if (expense.paidBy && expense.paidBy !== 'me') {
    const person = people.find(p => p.id === expense.paidBy);
    if (person) return person.name;
  }

  // 2. If paidByName is stored and isn't 'Já' / 'me'
  if (expense.paidByName && expense.paidByName !== 'Já' && expense.paidByName !== 'me') {
    return expense.paidByName;
  }

  // 3. If createdByName is stored and isn't 'Já' / 'me'
  if (expense.createdByName && expense.createdByName !== 'Já' && expense.createdByName !== 'me') {
    return expense.createdByName;
  }

  // Fallback
  return 'Neznámý';
}

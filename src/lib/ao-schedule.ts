export type AoSchedule = {
  slug: string;
  name: string;
  day?: string;
};

export type DateOption = {
  value: string;
  label: string;
};

export type CalendarEntry = DateOption & AoSchedule;

const TIME_ZONE = 'America/Chicago';
const DOW: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function zonedDate(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(value('year'), value('month') - 1, value('day'), 12));
}

function formatDate(date: Date): DateOption {
  const value = date.toISOString().slice(0, 10);
  return {
    value,
    label: `${WD[date.getUTCDay()]} · ${MON[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`,
  };
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function upcomingDates(dayName: string | undefined, count = 10, now = new Date()): DateOption[] {
  const target = dayName ? DOW[dayName] : undefined;
  if (target === undefined) return [];

  let date = addDays(zonedDate(now), 1);
  while (date.getUTCDay() !== target) date = addDays(date, 1);

  return Array.from({ length: count }, (_, index) => formatDate(addDays(date, index * 7)));
}

export function calendarEntries(aos: AoSchedule[], days = 56, now = new Date()): CalendarEntry[] {
  const start = zonedDate(now);
  const entries: CalendarEntry[] = [];

  for (let offset = 0; offset < days; offset++) {
    const date = addDays(start, offset);
    for (const ao of aos) {
      if (ao.day && DOW[ao.day] === date.getUTCDay()) {
        entries.push({ ...formatDate(date), ...ao });
      }
    }
  }

  return entries;
}

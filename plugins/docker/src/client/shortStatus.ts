// Docker's status sentence, cut to fit a row's meta: "Up 6 hours (healthy)" reads "Up 6h", and
// "Exited (0) 3 days ago" reads "Exited 3d ago". The row's tip keeps the full sentence.
const UNITS: Record<string, string> = { second: 's', minute: 'm', hour: 'h', day: 'd', week: 'w', month: 'mo', year: 'y' }

export function shortStatus(status: string): string {
  return status
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/Less than a second/i, '<1s')
    .replace(/About an? (second|minute|hour|day|week|month|year)/i, (_, unit: string) => `1${UNITS[unit.toLowerCase()]}`)
    .replace(/(\d+) (second|minute|hour|day|week|month|year)s?\b/gi, (_, n: string, unit: string) => `${n}${UNITS[unit.toLowerCase()]}`)
    .replace(/\s+/g, ' ')
    .trim()
}

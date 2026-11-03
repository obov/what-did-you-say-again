const pad = (n) => String(n).padStart(2, '0');

const valid = (d) => d instanceof Date && !Number.isNaN(d.getTime());

/** Local "YYYY-MM-DD HH:MM:SS" (or without seconds). '' for a missing date. */
export function formatDateTime(date, { seconds = true } = {}) {
  if (!valid(date)) return '';
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}${seconds ? `:${pad(date.getSeconds())}` : ''}`;
  return `${day} ${time}`;
}

/** Local "HH:MM". '' for a missing date. */
export function formatTime(date) {
  return valid(date) ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : '';
}

/** Date from an ISO string / epoch / Date, or undefined. */
export function toDate(value) {
  if (value == null || value === '') return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return valid(d) ? d : undefined;
}

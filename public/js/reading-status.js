export const READING_STATUSES = Object.freeze({
  "to-read": "À lire",
  reading: "En cours",
  read: "Lu",
  abandoned: "Abandonné",
});

export function normalizeReadingStatus(status) {
  return typeof status === "string" && Object.hasOwn(READING_STATUSES, status)
    ? status
    : "to-read";
}

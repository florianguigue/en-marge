export function normalizeIsbn(value) {
  const isbn = String(value || "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
  if (/^\d{13}$/.test(isbn)) {
    const sum = [...isbn].reduce(
      (n, c, i) => n + Number(c) * (i % 2 ? 3 : 1),
      0,
    );
    return /^(978|979)/.test(isbn) && sum % 10 === 0 ? isbn : "";
  }
  if (!/^\d{9}[\dX]$/.test(isbn)) return "";
  const sum = [...isbn].reduce(
    (n, c, i) => n + (c === "X" ? 10 : Number(c)) * (10 - i),
    0,
  );
  if (sum % 11) return "";
  const prefix = `978${isbn.slice(0, 9)}`;
  const check =
    (10 -
      ([...prefix].reduce((n, c, i) => n + Number(c) * (i % 2 ? 3 : 1), 0) %
        10)) %
    10;
  return prefix + check;
}

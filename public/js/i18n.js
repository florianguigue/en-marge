import { messages } from "./messages.js";

export const LANGUAGE_STORAGE = "en-marge-language-v1";
let language = "fr";

export function resolveLanguage(preference, languages = [], fallbackLanguage) {
  if (preference === "fr" || preference === "en") return preference;
  const candidates = [
    ...(Array.isArray(languages) ? languages : []),
    fallbackLanguage,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    try {
      const base = new Intl.Locale(candidate.trim()).language;
      if (base === "fr" || base === "en") return base;
    } catch {
      // An invalid browser locale does not prevent trying its next preference.
    }
  }
  return "fr";
}

export function initializeLanguage(preference) {
  language = resolveLanguage(
    preference,
    navigator.languages,
    navigator.language,
  );
  return language;
}

export function getLanguage() {
  return language;
}

export function getLocale() {
  return language === "fr" ? "fr-FR" : "en";
}

export function setLanguage(next) {
  if (next !== "fr" && next !== "en") return false;
  language = next;
  return true;
}

export function t(key, values = {}) {
  const message = messages[language][key] ?? messages.fr[key] ?? key;
  return message.replace(/\{(\w+)\}/g, (_, name) =>
    String(values[name] ?? `{${name}}`),
  );
}

export function formatNumber(value) {
  return new Intl.NumberFormat(getLocale()).format(value);
}

export function pluralKey(key, count) {
  const form =
    new Intl.PluralRules(getLocale()).select(count) === "one" ? "one" : "other";
  return `${key}.${form}`;
}

export function bookCount(count) {
  return t(pluralKey("bookCount", count), { count: formatNumber(count) });
}

export function pageCount(count) {
  return t(pluralKey("pageCount", count), { count: formatNumber(count) });
}

export function genreLabel(genre) {
  return (
    messages[language][`genre.${genre}`] ??
    (genre === "À découvrir" ? t("toDiscover") : genre)
  );
}

export function applyTranslations(root = document) {
  document.documentElement.lang = getLocale();
  for (const attribute of ["text", "aria-label", "placeholder", "content"]) {
    const selector =
      attribute === "text" ? "data-i18n" : `data-i18n-${attribute}`;
    root.querySelectorAll(`[${selector}]`).forEach((element) => {
      const value = t(element.getAttribute(selector));
      if (attribute === "text") element.textContent = value;
      else element.setAttribute(attribute, value);
    });
  }
}

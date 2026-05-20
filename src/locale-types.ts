// Shared types for the locale registry. Kept in its own file so
// per-language tables under `src/locales/` can import the type
// without creating a cycle with `src/locale.ts` (the registry +
// loader). dependency-cruiser flags any cycle, including ones that
// only consist of type imports — splitting the types out is the
// lowest-friction fix.

export interface LocaleEntry {
  [key: string]: string | readonly string[] | { [key: string]: string | undefined } | undefined;
}

export type Locale = Record<string, LocaleEntry>;

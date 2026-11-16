// Shared types for the locale registry. Separate from `src/locale.ts` so the
// language tables can import them without a cycle (dependency-cruiser flags
// type-only cycles too).

export interface LocaleEntry {
  [key: string]: string | readonly string[] | { [key: string]: string | undefined } | undefined;
}

export type Locale = Record<string, LocaleEntry>;

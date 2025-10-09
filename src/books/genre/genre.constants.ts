// src/books/genre/genre.constants.ts

export const GENRE_ID_TO_SLUG: Record<number, string> = {
  1: 'Anthropology',
  2: 'Art',
  3: 'Autobiography',
  4: 'Biography',
  5: 'Economics',
  6: 'Environment',
  7: 'Fantasy',
  8: 'Fiction',
  9: 'History',
  10: 'Literature',
  11: 'Philosophy',
  12: 'Politics',
  13: 'Psychology',
  14: 'Religion',
  15: 'Science',
  16: 'Science fiction',
  17: 'Self-help',
  18: 'Sociology',
  19: 'Spirituality',
};

export function resolveGenreSlug(id: number): string | null {
  return GENRE_ID_TO_SLUG[id] ?? null;
}

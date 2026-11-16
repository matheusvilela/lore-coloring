export const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'] as const;

export type Letter = (typeof LETTERS)[number];

/** URL de um asset da letra, respeitando a base do Vite (/lore-coloring/). */
export function assetUrl(letter: string, file: string): string {
  return `${import.meta.env.BASE_URL}letras/${letter}/${file}`;
}

/**
 * Alfabetos do app. Cada um é um diretório em `public/` com uma pasta por
 * letra (`ink.png`, `region.png`, `thumb.webp`), todas no mesmo canvas.
 *
 * A chave de pintura (`storageKey`) do latim é a própria letra, formato antigo
 * (`lore:paint:A`): mudar isso apagaria o que as crianças já pintaram. O
 * coreano, que nasceu depois, entra prefixado (`lore:paint:coreano:giyeok`).
 */

export type LangId = 'latin' | 'coreano';

export type LetterDef = {
  /** pasta em `public/<dir>/` e sufixo da chave de pintura */
  id: string;
  /** o que a tela mostra e o leitor de tela anuncia (letra ou jamo) */
  glyph: string;
};

export type Alphabet = {
  id: LangId;
  /** nome no seletor, na língua da interface */
  label: string;
  /** diretório dos assets em `public/` */
  dir: string;
  /** prefixo da chave de pintura ('' no latim, por compatibilidade) */
  storagePrefix: string;
  /** como o aviso de "limpar tudo" se refere ao conjunto */
  countLabel: string;
  letters: readonly LetterDef[];
};

const LATIN: LetterDef[] = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((glyph) => ({
  id: glyph,
  glyph,
}));

/**
 * Os 40 jamo na ordem de leitura da folha (consoantes, aspiradas, vogais...).
 * Fonte da verdade do recorte e do traço: `scripts/coreano-jamo.mjs` — a ordem
 * e os nomes aqui têm que acompanhar aquela tabela.
 */
const COREANO: LetterDef[] = (
  [
    ['giyeok', 'ㄱ'],
    ['nieun', 'ㄴ'],
    ['digeut', 'ㄷ'],
    ['rieul', 'ㄹ'],
    ['mieum', 'ㅁ'],
    ['bieup', 'ㅂ'],
    ['siot', 'ㅅ'],
    ['ieung', 'ㅇ'],
    ['jieut', 'ㅈ'],
    ['chieut', 'ㅊ'],
    ['kieuk', 'ㅋ'],
    ['tieut', 'ㅌ'],
    ['pieup', 'ㅍ'],
    ['hieut', 'ㅎ'],
    ['a', 'ㅏ'],
    ['ya', 'ㅑ'],
    ['eo', 'ㅓ'],
    ['yeo', 'ㅕ'],
    ['o', 'ㅗ'],
    ['yo', 'ㅛ'],
    ['u', 'ㅜ'],
    ['yu', 'ㅠ'],
    ['eu', 'ㅡ'],
    ['i', 'ㅣ'],
    ['ssang-giyeok', 'ㄲ'],
    ['ssang-digeut', 'ㄸ'],
    ['ssang-bieup', 'ㅃ'],
    ['ssang-siot', 'ㅆ'],
    ['ssang-jieut', 'ㅉ'],
    ['ae', 'ㅐ'],
    ['yae', 'ㅒ'],
    ['e', 'ㅔ'],
    ['ye', 'ㅖ'],
    ['wa', 'ㅘ'],
    ['wae', 'ㅙ'],
    ['oe', 'ㅚ'],
    ['wo', 'ㅝ'],
    ['we', 'ㅞ'],
    ['wi', 'ㅟ'],
    ['ui', 'ㅢ'],
  ] as const
).map(([id, glyph]) => ({ id, glyph }));

export const ALPHABETS: Record<LangId, Alphabet> = {
  latin: {
    id: 'latin',
    label: 'Português',
    dir: 'letras',
    storagePrefix: '',
    countLabel: 'todas as 26 letras',
    letters: LATIN,
  },
  coreano: {
    id: 'coreano',
    label: 'Coreano',
    dir: 'coreano',
    storagePrefix: 'coreano:',
    countLabel: 'os 40 jamo',
    letters: COREANO,
  },
};

export const ALPHABET_LIST: readonly Alphabet[] = [ALPHABETS.latin, ALPHABETS.coreano];

export function isLangId(value: unknown): value is LangId {
  return value === 'latin' || value === 'coreano';
}

/** URL de um asset da letra, respeitando a base do Vite (/lore-coloring/). */
export function assetUrl(alphabet: Alphabet, letter: string, file: string): string {
  return `${import.meta.env.BASE_URL}${alphabet.dir}/${letter}/${file}`;
}

/** Chave da pintura salva (IndexedDB) para uma letra de um alfabeto. */
export function storageKey(alphabet: Alphabet, letter: string): string {
  return `${alphabet.storagePrefix}${letter}`;
}

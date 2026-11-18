/**
 * Os 40 jamo da folha coreana (assets-src/coreano/sheet.png), em ordem de
 * leitura: 7 consoantes simples, 7 consoantes aspiradas, 8 vogais verticais,
 * 5 consoantes duplas, 7 vogais compostas, 6 vogais finais = 40.
 *
 * Fonte única da verdade: scripts/crop-coreano.mjs recorta usando `body`;
 * scripts/build-assets.mjs vetoriza usando `name` + `glyph`.
 *
 * Ordem de leitura da folha (esquerda→direita, cima→baixo). O nome romano
 * segue a romanização revisada; o glifo fica no rótulo da prancha de QA.
 * Caixa = bbox do corpo do personagem na folha original; serve de âncora de
 * posse no recorte, não de recorte.
 */
export const ROWS = [
  {
    items: [
      ['giyeok', 'ㄱ', [17, 32, 155, 161]],
      ['nieun', 'ㄴ', [177, 41, 319, 162]],
      ['digeut', 'ㄷ', [349, 21, 472, 163]],
      ['rieul', 'ㄹ', [486, 5, 594, 163]],
      ['mieum', 'ㅁ', [627, 27, 745, 164]],
      ['bieup', 'ㅂ', [764, 37, 1030, 160]],
      ['siot', 'ㅅ', [1033, 61, 1157, 160]],
    ],
  },
  {
    items: [
      ['ieung', 'ㅇ', [13, 212, 178, 346]],
      ['jieut', 'ㅈ', [216, 170, 353, 347]],
      ['chieut', 'ㅊ', [380, 217, 517, 347]],
      ['kieuk', 'ㅋ', [543, 207, 657, 345]],
      ['tieut', 'ㅌ', [685, 191, 803, 347]],
      ['pieup', 'ㅍ', [821, 251, 974, 349]],
      ['hieut', 'ㅎ', [1007, 228, 1102, 349]],
    ],
  },
  {
    items: [
      ['a', 'ㅏ', [29, 382, 103, 522]],
      ['ya', 'ㅑ', [123, 384, 197, 524]],
      ['eo', 'ㅓ', [221, 382, 304, 522]],
      ['yeo', 'ㅕ', [325, 380, 394, 520]],
      ['o', 'ㅗ', [442, 436, 617, 517]],
      ['yo', 'ㅛ', [618, 439, 868, 517]],
      ['u', 'ㅜ', [881, 412, 1056, 518]],
      ['yu', 'ㅠ', [1091, 425, 1266, 518]],
    ],
  },
  {
    items: [
      ['eu', 'ㅡ', [34, 626, 209, 692]],
      ['i', 'ㅣ', [239, 542, 329, 693]],
      ['ssang-giyeok', 'ㄲ', [344, 536, 640, 696]],
      ['ssang-digeut', 'ㄸ', [656, 550, 902, 694]],
      ['ssang-bieup', 'ㅃ', [930, 576, 1148, 694]],
    ],
  },
  {
    items: [
      ['ssang-siot', 'ㅆ', [12, 766, 221, 866]],
      ['ssang-jieut', 'ㅉ', [243, 760, 454, 861]],
      ['ae', 'ㅐ', [473, 721, 615, 861]],
      ['yae', 'ㅒ', [637, 720, 742, 860]],
      ['e', 'ㅔ', [773, 718, 882, 858]],
      ['ye', 'ㅖ', [896, 716, 1015, 856]],
      ['wa', 'ㅘ', [1045, 715, 1184, 855]],
    ],
  },
  {
    items: [
      ['wae', 'ㅙ', [20, 911, 215, 1051]],
      ['oe', 'ㅚ', [240, 886, 368, 1051]],
      ['wo', 'ㅝ', [385, 911, 509, 1051]],
      ['we', 'ㅞ', [525, 910, 705, 1050]],
      ['wi', 'ㅟ', [739, 906, 869, 1046]],
      ['ui', 'ㅢ', [891, 903, 1032, 1043]],
    ],
  },
];

/** Lista achatada, na ordem da folha. */
export const JAMO = ROWS.flatMap((row) =>
  row.items.map(([name, glyph, body]) => ({ name, glyph, body })),
);

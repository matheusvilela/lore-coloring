import type { LangId } from '../data/letters';

/**
 * Bandeiras em SVG, simplificadas para 28 × 19 px. Emoji não serve: no
 * Windows/Chrome os pares regionais 🇧🇷/🇰🇷 caem para as letras "BR"/"KR".
 * O texto ao lado (botão e item do menu) carrega o nome; a arte é decorativa.
 */
export function Flag({ id }: { id: LangId }) {
  return id === 'coreano' ? <FlagKr /> : <FlagBr />;
}

function FlagBr() {
  return (
    <svg className="flag" viewBox="0 0 30 20" aria-hidden="true" focusable="false">
      <rect width="30" height="20" rx="2.6" fill="#009739" />
      <path d="M15 3.2 26.8 10 15 16.8 3.2 10Z" fill="#FEDD00" />
      <circle cx="15" cy="10" r="4.25" fill="#012169" />
      <path
        d="M10.95 10.6c2.45 1.7 6.1 1.5 8.3-.6"
        fill="none"
        stroke="#fff"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Três barras por canto; a forma exata de cada trigrama não se lê a 28 px. */
const TRIGRAMS = [
  { x: 5.1, y: 4.5, r: -56 },
  { x: 24.9, y: 4.5, r: 56 },
  { x: 5.1, y: 15.5, r: 56 },
  { x: 24.9, y: 15.5, r: -56 },
] as const;

function FlagKr() {
  return (
    <svg className="flag" viewBox="0 0 30 20" aria-hidden="true" focusable="false">
      <rect width="30" height="20" rx="2.6" fill="#fff" />
      {/* fundo branco sobre botão branco: a hairline dá o contorno */}
      <rect
        x="0.35"
        y="0.35"
        width="29.3"
        height="19.3"
        rx="2.4"
        fill="none"
        stroke="#d8d1c6"
        strokeWidth="0.7"
      />
      {TRIGRAMS.map((t) => (
        <g key={`${t.x}-${t.y}`} transform={`translate(${t.x} ${t.y}) rotate(${t.r})`} fill="#111">
          {[-2.15, -0.45, 1.25].map((dy) => (
            <rect key={dy} x="-2.6" y={dy} width="5.2" height="0.85" rx="0.42" />
          ))}
        </g>
      ))}
      <circle cx="15" cy="10" r="4.4" fill="#0047A0" />
      {/* lóbulo vermelho desce à esquerda, o azul sobe à direita (bandeira oficial) */}
      <path
        d="M19.4 10A4.4 4.4 0 0 0 10.6 10 2.2 2.2 0 0 0 15 10 2.2 2.2 0 0 1 19.4 10Z"
        fill="#CD2E3A"
      />
    </svg>
  );
}

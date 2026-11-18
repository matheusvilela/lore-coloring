import brFlag from '../assets/bandeiras/br.svg?url';
import krFlag from '../assets/bandeiras/kr.svg?url';
import type { LangId } from '../data/letters';

/**
 * Bandeiras oficiais em SVG, uma por alfabeto. Emoji não serve: no Windows/Chrome
 * os pares regionais 🇧🇷/🇰🇷 caem para as letras "BR"/"KR".
 *
 * A arte vem pronta de `src/assets/bandeiras/` (Wikimedia Commons, domínio
 * público) — desenhar uma "versão simplificada" à mão erra detalhes como o
 * sentido da faixa do Brasil. O nome do alfabeto vai no texto ao lado; a imagem
 * é decorativa (`alt=""`).
 */
const SRC: Record<LangId, string> = { latin: brFlag, coreano: krFlag };

export function Flag({ id }: { id: LangId }) {
  return <img className="flag" src={SRC[id]} alt="" draggable={false} />;
}

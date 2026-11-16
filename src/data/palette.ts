export type PaletteColor = {
  hex: string;
  name: string;
  /** Letra de origem da cor oficial (metadado; não aparece na UI). */
  from?: string;
};

/**
 * 24 cores em ordem de arco-íris (ver Anexo A de docs/decisoes.md).
 * 23 oficiais do Alphabet Lore, sem os brancos de X/Y/Z, mais um branco.
 */
export const PALETTE: readonly PaletteColor[] = [
  { hex: '#782D2D', name: 'vinho', from: 'R' },
  { hex: '#A1282D', name: 'vermelho escuro', from: 'M' },
  { hex: '#D24545', name: 'vermelho', from: 'A' },
  { hex: '#F5A05F', name: 'laranja', from: 'N' },
  { hex: '#FFE777', name: 'amarelo ouro', from: 'C' },
  { hex: '#FFFF00', name: 'amarelo', from: 'K' },
  { hex: '#B4E182', name: 'verde-limão', from: 'U' },
  { hex: '#9FC381', name: 'verde-oliva', from: 'S' },
  { hex: '#88C170', name: 'verde folha', from: 'D' },
  { hex: '#B8D2C5', name: 'verde-menta', from: 'H' },
  { hex: '#5E9B8B', name: 'verde-petróleo', from: 'L' },
  { hex: '#46B0A9', name: 'verde-água', from: 'E' },
  { hex: '#007DA5', name: 'azul oceano', from: 'O' },
  { hex: '#01548A', name: 'azul-marinho', from: 'V' },
  { hex: '#BFD4ED', name: 'azul-céu', from: 'I' },
  { hex: '#A2BEFF', name: 'azul bebê', from: 'B' },
  { hex: '#7E709B', name: 'lilás', from: 'W' },
  { hex: '#6E5B7C', name: 'roxo acinzentado', from: 'G' },
  { hex: '#AA95B3', name: 'lavanda', from: 'J' },
  { hex: '#D46782', name: 'rosa', from: 'P' },
  { hex: '#000000', name: 'preto', from: 'F' },
  { hex: '#666C73', name: 'cinza', from: 'T' },
  { hex: '#E1D2AE', name: 'areia', from: 'Q' },
  { hex: '#FFFFFF', name: 'branco' },
] as const;

/** Cor inicial: o vermelho do A. */
export const DEFAULT_COLOR = '#D24545';

import {
  SIZE_LABELS,
  TOOLS,
  toolUsesSize,
  type SizeIndex,
  type Tool,
} from '../canvas/tools';
import { PALETTE } from '../data/palette';

const TOOL_LABELS: Record<Tool, string> = {
  brush: 'Pincel',
  crayon: 'Giz de cera',
  eraser: 'Borracha',
  bucket: 'Balde de tinta',
};

type Props = {
  tool: Tool;
  color: string;
  sizeIndex: SizeIndex;
  onTool: (tool: Tool) => void;
  onColor: (hex: string) => void;
  onSize: (index: SizeIndex) => void;
};

export function Dock({ tool, color, sizeIndex, onTool, onColor, onSize }: Props) {
  const stillUsesSize = toolUsesSize(tool);

  return (
    <footer className="dock">
      <div className="dock__row">
        <div className="tools" role="group" aria-label="Ferramentas">
          {TOOLS.map((item) => (
            <button
              key={item}
              type="button"
              className={`tool${item === tool ? ' is-active' : ''}`}
              aria-label={TOOL_LABELS[item]}
              aria-pressed={item === tool}
              onClick={() => onTool(item)}
            >
              <ToolIcon tool={item} />
            </button>
          ))}
        </div>

        <div className="sizes" role="group" aria-label="Tamanho do traço">
          {SIZE_LABELS.map((label, index) => (
            <button
              key={label}
              type="button"
              className={`size${index === sizeIndex ? ' is-active' : ''}`}
              aria-label={`Tamanho ${label}`}
              aria-pressed={index === sizeIndex}
              disabled={!stillUsesSize}
              onClick={() => onSize(index as SizeIndex)}
            >
              <span className="size__dot" style={{ width: 6 + index * 7, height: 6 + index * 7 }} />
            </button>
          ))}
        </div>
      </div>

      <div className="palette" role="group" aria-label="Cores">
        {PALETTE.map((swatch) => (
          <button
            key={swatch.hex}
            type="button"
            className={`swatch${swatch.hex === color ? ' is-active' : ''}`}
            style={{ background: swatch.hex }}
            aria-label={`Cor ${swatch.name}`}
            aria-pressed={swatch.hex === color}
            onClick={() => onColor(swatch.hex)}
          />
        ))}
      </div>
    </footer>
  );
}

function ToolIcon({ tool }: { tool: Tool }) {
  if (tool === 'brush') {
    return (
      <svg viewBox="0 0 24 24" width="27" height="27" aria-hidden="true">
        <path
          d="M5.2 13.4 17.5 4.2a2.1 2.1 0 0 1 2.6 3.2L11 19.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinejoin="round"
        />
        <path
          d="M4 20.6c.1-1.6 1-2.6 2.3-2.6 1.3 0 2.2.9 2.2 2.1 0 1.3-1 2.2-2.4 2.2-1.3 0-2.1-.7-2.1-1.7Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (tool === 'crayon') {
    return (
      <svg viewBox="0 0 24 24" width="27" height="27" aria-hidden="true">
        <path
          d="M9.1 20.8 3.2 14.9 15.1 3l5.9 5.9L9.1 20.8Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinejoin="round"
        />
        <path
          d="M11.6 6.5 17.5 12.4M8.3 9.8 14.2 15.7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
    );
  }

  if (tool === 'eraser') {
    return (
      <svg viewBox="0 0 24 24" width="27" height="27" aria-hidden="true">
        <path
          d="M4.2 14.6 13 5.8a2.4 2.4 0 0 1 3.4 0l2.3 2.3a2.4 2.4 0 0 1 0 3.4L12.1 18H8.2l-4-4a.4.4 0 0 1 0-.6Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinejoin="round"
        />
        <path
          d="M9.4 9.4 15 15M12.6 18H21"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" width="27" height="27" aria-hidden="true">
      <path
        d="M10.2 4.6 3.1 11.7a1.6 1.6 0 0 0 0 2.2l5 5a1.6 1.6 0 0 0 2.2 0l7.1-7.1L10.2 4.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <path d="M8.4 6.4 6.1 4.1" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path
        d="M19.6 13.6c1.2 1.7 1.9 2.9 1.9 3.6a1.9 1.9 0 0 1-3.8 0c0-.7.7-1.9 1.9-3.6Z"
        fill="currentColor"
      />
    </svg>
  );
}

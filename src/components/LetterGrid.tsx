import { useEffect, useRef, useState } from 'react';
import { letterPngFilename, offerSavePng, renderLetterPng } from '../canvas/exportLetter';
import { assetUrl, LETTERS, type Letter } from '../data/letters';
import { getPaint } from '../storage/db';

/** O minify de produção deixa só `-webkit-backdrop-filter`, que o Chrome atual descarta. */
const GLASS_FILTER = 'blur(var(--glass-blur)) saturate(1.35)';

type Props = {
  current: Letter;
  painted: Set<string>;
  onPick: (letter: Letter) => void;
  onClose: () => void;
  onClearLetter: (letter: Letter) => void;
  onClearAll: () => void;
};

export function LetterGrid({
  current,
  painted,
  onPick,
  onClose,
  onClearLetter,
  onClearAll,
}: Props) {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState<Letter | null>(null);
  const objectUrls = useRef<string[]>([]);
  const mounted = useRef(true);
  const exportingRef = useRef<Letter | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const exportLetter = async (letter: Letter) => {
    if (exportingRef.current) return;
    exportingRef.current = letter;
    setExporting(letter);
    try {
      const blob = await renderLetterPng(letter);
      await offerSavePng(blob, letterPngFilename(letter));
    } finally {
      exportingRef.current = null;
      if (mounted.current) setExporting(null);
    }
  };

  useEffect(() => {
    let alive = true;

    const load = async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        LETTERS.map(async (letter) => {
          const blob = await getPaint(letter);
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          objectUrls.current.push(url);
          next[letter] = url;
        }),
      );
      if (alive) setPreviews(next);
    };

    void load();
    return () => {
      alive = false;
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
      objectUrls.current = [];
      setPreviews({});
    };
  }, [painted]);

  return (
    <section className="grid-screen" aria-label="Grade de letras">
      <header className="grid-screen__bar">
        <button type="button" className="btn nav" onClick={onClose} aria-label="Voltar ao desenho">
          <ArrowBack />
        </button>
        <button
          type="button"
          className="btn nav grid-screen__clear-all"
          onClick={onClearAll}
          aria-label="Limpar todas as letras"
        >
          <TrashIcon stacked />
        </button>
      </header>

      <ul className="letter-grid">
        {LETTERS.map((letter) => (
          <li key={letter}>
            <div className="letter-cell-wrap">
              <button
                type="button"
                className={`letter-cell${letter === current ? ' is-current' : ''}`}
                aria-label={`Letra ${letter}`}
                aria-current={letter === current ? 'true' : undefined}
                onClick={() => onPick(letter)}
              >
                {previews[letter] ? (
                  <img className="letter-cell__paint" src={previews[letter]} alt="" />
                ) : null}
                <img className="letter-cell__ink" src={assetUrl(letter, 'ink.png')} alt="" />
              </button>
              {previews[letter] || painted.has(letter) ? (
                <div className="letter-cell__actions">
                  <button
                    type="button"
                    className="btn letter-cell__clear"
                    style={{ backdropFilter: GLASS_FILTER }}
                    aria-label={`Limpar letra ${letter}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onClearLetter(letter);
                    }}
                  >
                    <TrashIcon />
                  </button>
                  <button
                    type="button"
                    className="btn letter-cell__export"
                    style={{ backdropFilter: GLASS_FILTER }}
                    aria-label={`Exportar letra ${letter}`}
                    disabled={exporting === letter}
                    onClick={(event) => {
                      event.stopPropagation();
                      void exportLetter(letter);
                    }}
                  >
                    <ExportIcon />
                  </button>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ArrowBack() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path
        d="M15 5 L8 12 L15 19"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 4v10" strokeLinecap="round" />
      <path d="M8 10l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 19h12" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon({ stacked = false }: { stacked?: boolean }) {
  if (stacked) {
    return (
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
        <path d="M5 7h14" strokeLinecap="round" />
        <path d="M8 7V5h8v2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 7l1 13h8l1-13" strokeLinejoin="round" />
        <path d="M10 10v7M14 10v7" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 7h12" strokeLinecap="round" />
      <path d="M9 7V5h6v2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 7l.8 12.2h6.4L16 7" strokeLinejoin="round" />
    </svg>
  );
}
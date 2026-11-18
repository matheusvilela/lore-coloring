import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { letterPngFilename, offerSavePng, renderLetterPng } from '../canvas/exportLetter';
import {
  ALPHABET_LIST,
  assetUrl,
  storageKey,
  type Alphabet,
  type LangId,
} from '../data/letters';
import { getPaint } from '../storage/db';
import { Flag } from './Flags';

/** O minify de produção deixa só `-webkit-backdrop-filter`, que o Chrome atual descarta. */
const GLASS_FILTER = 'blur(var(--glass-blur)) saturate(1.35)';

type Props = {
  alphabet: Alphabet;
  current: string;
  painted: Set<string>;
  onPick: (letter: string) => void;
  onClose: () => void;
  onClearLetter: (letter: string) => void;
  onClearAll: () => void;
  onPickLang: (lang: LangId) => void;
};

export function LetterGrid({
  alphabet,
  current,
  painted,
  onPick,
  onClose,
  onClearLetter,
  onClearAll,
  onPickLang,
}: Props) {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState<string | null>(null);
  const [langOpen, setLangOpen] = useState(false);
  const [langMenuStyle, setLangMenuStyle] = useState<CSSProperties>({});
  const objectUrls = useRef<string[]>([]);
  const mounted = useRef(true);
  const exportingRef = useRef<string | null>(null);
  const langAnchorRef = useRef<HTMLDivElement>(null);
  const langButtonRef = useRef<HTMLButtonElement>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const langMenuId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const exportLetter = async (letter: string) => {
    if (exportingRef.current) return;
    exportingRef.current = letter;
    setExporting(letter);
    try {
      const blob = await renderLetterPng(alphabet, letter);
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
        alphabet.letters.map(async ({ id }) => {
          const blob = await getPaint(storageKey(alphabet, id));
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          objectUrls.current.push(url);
          next[id] = url;
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
  }, [painted, alphabet]);

  useEffect(() => {
    setLangOpen(false);
  }, [alphabet]);

  useLayoutEffect(() => {
    if (!langOpen) return;
    const place = () => {
      const button = langButtonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const width = Math.min(220, window.innerWidth - 24);
      setLangMenuStyle({
        position: 'fixed',
        top: rect.bottom + 8,
        right: Math.max(12, window.innerWidth - rect.right),
        width,
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [langOpen]);

  useEffect(() => {
    if (!langOpen) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (langAnchorRef.current?.contains(target) || langMenuRef.current?.contains(target)) return;
      setLangOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setLangOpen(false);
      langButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', onKey);
    };
  }, [langOpen]);

  const pickLang = (lang: LangId) => {
    setLangOpen(false);
    if (lang !== alphabet.id) onPickLang(lang);
  };

  return (
    <section className="grid-screen" aria-label="Grade de letras">
      <header className="grid-screen__bar">
        <button type="button" className="btn nav" onClick={onClose} aria-label="Voltar ao desenho">
          <ArrowBack />
        </button>

        <div ref={langAnchorRef} className="grid-screen__lang">
          <button
            ref={langButtonRef}
            type="button"
            className="btn nav grid-screen__lang-btn"
            aria-label={`Alfabeto: ${alphabet.label}. Trocar alfabeto`}
            aria-haspopup="menu"
            aria-expanded={langOpen}
            aria-controls={langOpen ? langMenuId : undefined}
            onClick={() => setLangOpen((open) => !open)}
          >
            <Flag id={alphabet.id} />
          </button>
        </div>

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
        {alphabet.letters.map(({ id, glyph }) => (
          <li key={id}>
            <div className="letter-cell-wrap">
              <button
                type="button"
                className={`letter-cell${id === current ? ' is-current' : ''}`}
                aria-label={`Letra ${glyph}`}
                aria-current={id === current ? 'true' : undefined}
                onClick={() => onPick(id)}
              >
                {previews[id] ? (
                  <img className="letter-cell__paint" src={previews[id]} alt="" />
                ) : null}
                <img className="letter-cell__ink" src={assetUrl(alphabet, id, 'ink.png')} alt="" />
              </button>
              {previews[id] || painted.has(id) ? (
                <div className="letter-cell__actions">
                  <button
                    type="button"
                    className="btn letter-cell__clear"
                    style={{ backdropFilter: GLASS_FILTER }}
                    aria-label={`Limpar letra ${glyph}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onClearLetter(id);
                    }}
                  >
                    <TrashIcon />
                  </button>
                  <button
                    type="button"
                    className="btn letter-cell__export"
                    style={{ backdropFilter: GLASS_FILTER }}
                    aria-label={`Exportar letra ${glyph}`}
                    disabled={exporting === id}
                    onClick={(event) => {
                      event.stopPropagation();
                      void exportLetter(id);
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

      {langOpen
        ? createPortal(
            <div
              ref={langMenuRef}
              id={langMenuId}
              className="size-popover lang-menu"
              style={langMenuStyle}
              role="menu"
              aria-label="Escolher alfabeto"
              onPointerDown={(event) => event.stopPropagation()}
            >
              {ALPHABET_LIST.map((item) => {
                const checked = item.id === alphabet.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="lang-menu__item"
                    role="menuitemradio"
                    aria-checked={checked}
                    onClick={() => pickLang(item.id)}
                  >
                    <Flag id={item.id} />
                    <span className="lang-menu__label">{item.label}</span>
                    {checked ? <CheckIcon /> : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
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

function CheckIcon() {
  return (
    <svg className="lang-menu__check" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 12.5 10 17.5 19 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
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

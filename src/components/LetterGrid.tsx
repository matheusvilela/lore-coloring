import { useEffect, useRef, useState } from 'react';
import { assetUrl, LETTERS, type Letter } from '../data/letters';
import { getPaint } from '../storage/db';

type Props = {
  current: Letter;
  painted: Set<string>;
  onPick: (letter: Letter) => void;
  onClose: () => void;
};

export function LetterGrid({ current, painted, onPick, onClose }: Props) {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const objectUrls = useRef<string[]>([]);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      const next: Record<string, string> = {};
      for (const letter of LETTERS) {
        if (!painted.has(letter)) continue;
        const blob = await getPaint(letter);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        objectUrls.current.push(url);
        next[letter] = url;
      }
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
        <p className="grid-screen__title">Suas letras</p>
      </header>

      <ul className="letter-grid">
        {LETTERS.map((letter) => (
          <li key={letter}>
            <button
              type="button"
              className={`letter-cell${letter === current ? ' is-current' : ''}`}
              aria-label={`Letra ${letter}`}
              aria-current={letter === current ? 'true' : undefined}
              onClick={() => onPick(letter)}
            >
              <img className="letter-cell__thumb" src={assetUrl(letter, 'thumb.webp')} alt="" />
              {previews[letter] ? (
                <img className="letter-cell__paint" src={previews[letter]} alt="" />
              ) : null}
            </button>
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
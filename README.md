# lore-coloring

App de colorir com as letras do *Alphabet Lore*, para celular, tablet e desktop.

## Como rodar local

Pré-requisitos: **Node 22** (o repositório traz um `.nvmrc`; o Vite 8 aceita
`^20.19` ou `>= 22.12`) e **npm**. O projeto usa npm: o `package-lock.json` é a
fonte da verdade. Não use yarn nem pnpm — os lockfiles deles (`yarn.lock`,
`pnpm-lock.yaml`) estão no `.gitignore` justamente para que um `yarn` acidental
não entre no repositório.

```sh
git clone git@github.com:matheusvilela/lore-coloring.git
cd lore-coloring
nvm use        # lê o .nvmrc (linha 22)
npm ci         # instala exatamente o que está no package-lock.json
npm run dev    # abre em http://localhost:5173/lore-coloring/
```

A barra no fim da URL não é opcional: o app é servido em `/lore-coloring/`
(caminho do GitHub Pages, definido em `vite.config.ts`).

Para abrir no celular na mesma rede: `npm run dev -- --host` e use o endereço
"Network" que o Vite imprime.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento com hot reload |
| `npm run build` | checagem de tipos (`tsc --noEmit`) + build de produção em `dist/` |
| `npm run preview` | serve o `dist/` em `http://localhost:4173/lore-coloring/` |
| `npm run typecheck` | só a checagem de tipos |
| `npm run test:e2e` | Playwright: desktop (1280×900) e celular (Pixel 7) |
| `npm run build:assets` | regenera `public/letras/**` (precisa de `potrace` + `sharp`) |

Antes de `dev` e `build` roda `scripts/preflight.mjs`, que falha com mensagem
clara se o Node estiver fora da faixa do Vite 8 ou se faltar `npm ci`.

### Controles

- **Dedo**: pinta com a ferramenta escolhida; **pinça com dois dedos** amplia
  (1×–4×) e arrasta a folha. O primeiro dedo de uma pinça não deixa risco.
- **Teclado**: `←`/`→` trocam de letra, `Ctrl/Cmd+Z` desfaz, `0` volta o zoom.
- **Trackpad**: pinça (equivale a `ctrl` + roda) amplia a folha.

### Testes

```sh
npx playwright install chromium   # uma vez
npm run test:e2e
```

O Playwright sobe e derruba o `preview` sozinho — não é preciso ter servidor
rodando.

### Se o `npm run dev` não subir

- `zsh: command not found: vite` → faltou `npm ci` (ou você está em outra pasta).
- erro de sintaxe dentro do `vite` → Node antigo; confira com `node -v` e rode `nvm use`.
- `nvm use` reclamando de versão → instale a linha 22: `nvm install 22 && nvm use`.
- porta ocupada → o Vite escolhe a próxima sozinho; olhe a URL que ele imprime.

## Estrutura

- `docs/decisoes.md` — decisões de produto e arquitetura (fonte da verdade)
- `assets-src/letras/` — sprites originais (raster, 329×251)
- `public/letras/{A..Z}/` — artefatos de runtime gerados e commitados
- `src/canvas/` — motor de pintura (camadas, comandos, undo, balde)
- `e2e/` — testes de ponta a ponta

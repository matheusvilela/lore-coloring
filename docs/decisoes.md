# Decisões — App de colorir "Alfabeto Lore"

**Status:** aprovado (MVP) · **Data:** 15/11/2026 · **Rev.:** 4 · **Alvo:** celular, tablet e desktop (mesma build)

---

## 0. Contexto

App de colorir para uma criança (~5–6 anos), com as 26 letras em estilo *Alphabet Lore*.
Ela escolhe a letra, escolhe ferramenta e cor, pinta com o dedo e o progresso fica salvo entre sessões.

**Assets disponíveis (o que existe hoje):**

| Propriedade | Valor |
|---|---|
| Formato | 26 PNGs (`A.png` … `Z.png`) |
| Dimensões | 329 × 251 px (todas iguais) |
| Cor | RGB, **sem canal alpha**, fundo branco puro (`#FFF`) |
| Traço | preto puro + antialias (2.836 px de preto puro, 2.422 px de borda) |
| Área útil | bbox da tinta ≈ 154 × 176 px → **~47% da largura é margem branca** |
| Vetorial | **não existe** — só raster |

**Restrições do projeto:** nada de backend, nada de conta, nada de anúncio/analytics. Precisa funcionar offline depois do primeiro acesso.

---

## 1. Decisões

### D1 · Stack: Vite + React + TypeScript + Canvas 2D

- React 19 + TS para **toda a UI** (barra de ferramentas, paleta, paginação, grade).
- **Canvas 2D puro** para o desenho. Sem Paper.js/Fabric.js/Konva: o modelo de "pintar píxeis" com borracha, balde e textura de giz é mais simples e mais leve direto no canvas do que através de um modelo vetorial de objetos.
- Estado da UI: React puro + um store mínimo (`zustand` ou `useReducer` em contexto). Sem Redux.

**Regra de ouro (D12):** nenhum ponto de traço passa por `useState`. O desenho vive numa classe imperativa (`Painter`) acessada por `ref`; o React só re-renderiza quando muda ferramenta, cor, tamanho ou letra. Re-render por `pointermove` derruba o framerate no celular.

### D2 · Renderização em 3 camadas, tinta sempre por cima

```
┌─────────────────────────┐
│ 3. tinta (ink.png/svg)  │  ← nunca muda, opacidade 100%
├─────────────────────────┤
│ 2. cor (canvas de pintura) │ ← única camada que o dedo altera
├─────────────────────────┤
│ 1. papel (branco)       │
└─────────────────────────┘
```

Três `<canvas>` empilhados (ou dois + fundo CSS). A tinta **não** é redesenhada a cada frame, então o traço da letra nunca é apagado nem coberto pela pintura.

### D3 · Pintura livre, **sem máscara/clipping** (decisão pedagógica)

A criança **pode** pintar fora da letra, no papel em branco. O traço preto permanece visível por cima.

> Objetivo explícito: ela aprende a respeitar a linha. O "dentro das linhas automático" (clip por silhueta) foi **rejeitado**.

Consequências aceitas:
- O fundo (fora da letra) é uma região pintável válida — inclusive pelo balde.
- A pintura nunca "quebra" o contorno da arte (a tinta está acima da cor), o que mantém as regiões do balde estáveis para sempre.

### D4 · Assets: vetorizar (fonte de verdade) e rasterizar em alta resolução (runtime)

- `potrace` (Homebrew 1.16, para line art B/W) como vetorizador primário; `@neplex/vectorizer` (vtracer via WASM/Node) como fallback se o potrace suavizar detalhes finos.
- Binarização antes do trace com `sharp` (threshold ~50%), parâmetros para preservar detalhes pequenos: dentes, cílios, hastes dos óculos.
- Ferramentas instaladas **localmente**: `sharp` (devDependency) + `potrace` 1.16 via Homebrew. O CI **não** precisa de nenhuma das duas.
- **Os artefatos gerados são commitados** em `public/letras/**`. Motivo: o runner do GitHub Actions não tem potrace e o build do Pages fica rápido e determinístico. O script fica no repo para reprodutibilidade — regenerar é um comando local.
- Saídas por letra, geradas por `scripts/build-assets.mjs`:
  - `ink.svg` — fonte de verdade (nitidez em qualquer zoom; permite re-rasterizar se a resolução mudar)
  - `ink.png` @ **2048 × 1562** — preto com `alpha = 1 − luminância` (o fundo branco **desaparece**; sem isso a tinta cobriria a pintura)
  - `region.png` @ **1024 × 781** — índice da região por píxel (ver D5)
  - `thumb.webp` — miniatura para a grade de letras
- `_conferencia.png` não vai para o app (é só folha de contato).
- QA obrigatório: prancha de contato rasterizando os 26 SVGs + diff visual contra o original em 4×.

### D5 · Balde: mapa de regiões pré-computado no build

Regiões = componentes conexos do "não-tinta" (barreira: `alpha ≥ 0.5`), rotulados no build e guardados em `region.png` (R+G = id, 4-conexo).

- Toque → lê o id da região → preenche todos os píxeis daquele id na camada de cor.
- O fill é **dilatado em 1–2 px** para dentro da zona de antialias, senão aparece uma costura branca sob o traço.
- Custo: uma passada em 800k px (1024×781) + upscale 2× → dezenas de ms no celular, só no toque.
- Substitui a cor existente (comportamento de paint clássico), não só o que está vazio.

Por que é estável: a tinta está sempre por cima e a borracha só apaga cor → **as barreiras nunca mudam**, então o mapa é válido durante toda a vida da letra.

⚠️ Risco conhecido: em letras com traço "aberto" (ex.: o contorno do `C`, do `S`, do `J`), o balde vaza para a região vizinha. Isso é o comportamento real de um paint. Aceito no MVP; se incomodar, inserimos "fechos" invisíveis no SVG daquela letra.

### D6 · Ferramentas do MVP

| Ferramenta | Comportamento |
|---|---|
| **Pincel** | traço redondo, duro, opaco |
| **Giz de cera** | textura granulada, largura com jitter, opacidade ~0,92; sobreposição entre traços *pode* escurecer (parece cera real) — desejável |
| **Balde** | D5 |
| **Borracha** | `destination-out` na camada de cor; **não** apaga a tinta |
| Tamanho | 3 opções (grande / médio / pequeno), botões grandes |
| Paleta | 24 cores (23 oficiais do Lore, sem brancos, + 1 off-white), **ordem do arco-íris** — sem color picker. Ver **Anexo A** |
| Desfazer | Sim (MVP). Botão + `Ctrl/Cmd+Z`; pilha de bitmaps **só da sessão atual** (não persiste) |
| Recursos | **limpar a letra atual** e **limpar todas** (com confirmação) |

Traço: `Pointer Events` + `setPointerCapture` + `touch-action: none` + `getCoalescedEvents()`, interpolação por curvas quadráticas entre amostras. Pointer secundário é ignorado (rejeição de palma).

### D7 · Resolução de pintura fixa

Canvas lógico **2048 × 1562** (mesma proporção 1,31:1 da arte), escalado para caber na tela.

Motivo: o resultado fica idêntico em qualquer aparelho, o custo do balde é previsível, a textura do giz tem escala consistente e o PNG salvo não depende da tela em que foi pintado. A tinta é desenhada de um raster de mesma resolução (ou do SVG), então só a camada de cor pode ficar levemente suave em telas 4K — imperceptível em pintura.

### D8 · Persistência: **IndexedDB** (não `localStorage`)

- `localStorage` é síncrono, só string e tem ~5 MB — não cabe bitmap e trava a thread principal.
- Guardamos por letra apenas o **PNG da camada de cor** (Blob). **Não existe flag de "concluída"**: a presença do Blob já significa que há pintura, e a grade renderiza o que está salvo. PNG de traço esparso sobre branco fica na casa de dezenas de KB → 26 letras cabem folgado.
- Autosave: debounce ~800 ms após o fim de cada traço + flush em `visibilitychange`/`pagehide` (o iOS mata a aba sem aviso).
- **Sem histórico de undone entre sessões.** "Desfazer" é só da sessão atual, em memória (pilha de bitmaps). O "recomeçar" cobre o caso persistente.
- `navigator.storage.persist()` na primeira execução para reduzir risco de despejo.
- **Risco:** o Safari apaga IndexedDB de sites não usados em ~7 dias. Mitigações: `persist()` e orientar os pais a "adicionar à tela de início" (instalados retêm melhor). Risco aceito no MVP.

### D9 · Navegação

- Setas grandes ‹ › entre A…Z, com a letra atual em destaque; a letra abre já pintada.
- Botão de **grade com as 26 miniaturas**, acessível a qualquer momento: cada célula é a **própria pintura salva**, então letras já pintadas aparecem coloridas e as demais aparecem em branco. Não há marcação de "concluída" — a criança vai para a próxima quando estiver satisfeita.
- Depois do `Z`, a seta › leva para a grade = "ver todas as pintadas".
- A grade é a tela de "álbum" pedida — não existe álbum separado.

### D10 · Sem som agora, mas preparado

Nenhuma dependência de áudio no bundle. A camada de desenho emite eventos de domínio (`stroke:start`, `stroke:end`, `region:fill`, `letter:completed`, `letter:cleared`) consumidos por um `SoundProvider` no-op. Ligar som depois = implementar um provider, sem tocar no motor.

### D11 · Deploy: GitHub Pages, estático

- Repositório: **`lore-coloring`**, público (Pages em repo privado exige plano pago). URL: `https://<user>.github.io/lore-coloring/`.
- Push na `main` → GitHub Actions roda testes + build → publica em Pages.
- `base: '/lore-coloring/'` no Vite; service worker via `vite-plugin-pwa` (precache das 26 letras, offline total, "adicionar à tela de início").
- **Sem domínio próprio (decidido).** Consequência aceita: `*.github.io` é origem compartilhada entre todos os project pages do seu usuário — o IndexedDB do app divide cota com seus outros projetos e a identidade do PWA fica presa a esse host. Mitigações baratas: prefixar todas as chaves de storage (`lore:`), não mudar o nome do repo (mudar repo muda a URL) e não depender de cota grande (o app usa poucos MB).
- **Oracle Cloud Free Tier: rejeitado para o MVP.** Não há backend; VM só adiciona nginx, certbot e deploy. Fica como opção futura (sincronizar entre dispositivos, álbum em PDF) — o app nasce local-first, então isso é aditivo.

### D12 · Arquitetura de código

```
lore/
├─ assets-src/letras/          # PNGs originais
├─ scripts/build-assets.mjs    # vetoriza → rasteriza → region map → thumb
├─ public/letras/{A..Z}/       # gerado (ink.svg, ink.png, region.png, thumb.webp)
├─ src/
│  ├─ App.tsx                  # rotas de tela: studio | grade
│  ├─ canvas/
│  │  ├─ Painter.ts            # motor: camadas, loop, pointer handling
│  │  ├─ brushes/{pincel,giz,balde,borracha}.ts
│  │  └─ geometry.ts           # curvas, simplificação, dilatação
│  ├─ state/store.ts           # ferramenta, cor, tamanho, letra, progresso
│  ├─ storage/db.ts            # IndexedDB (idb), autosave, reset
│  ├─ sound/                   # eventos + provider no-op
│  ├─ ui/                      # Toolbar, Palette, Pager, LetterGrid, Confirm
│  └─ data/letters.ts
└─ docs/decisoes.md
```

### D13 · Testes

- **Vitest**: geometria, leitura do mapa de regiões, serialização da persistência, migração de schema do IndexedDB.
- **Playwright**: fluxo com Pointer Events sintéticos — pintar, navegar, recarregar e conferir que a pintura voltou; balde; borracha; limpar letra/limpar tudo.

---

## 2. Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Máscara/clip automático ("dentro das linhas") | Contraria o objetivo pedagógico (D3) |
| `localStorage` | Limite de ~5 MB, API síncrona, só string (D8) |
| Flutter Web / Godot Web / Unity WebGL | O motor de pintura seria custom de qualquer forma; bundle 1,5–30 MB, pior integração web/iOS |
| Oracle Cloud Free Tier | Zero backend necessário; custo de operação sem benefício (D11) |
| Konva / Fabric.js / Paper.js | Modelo de objetos vetoriais atrapalha borracha, textura e balde por píxel |
| Recortar cada letra no próprio bbox | As letras ficariam com tamanhos inconsistentes entre páginas; usar bbox compartilhado |
| Upscale 4× em vez de vetorizar | Escolhemos vetorizar (D4); o upscale fica como plano B se o trace degradar |

---

## 3. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| potrace perder detalhes finos (dentes, cílios, óculos) | QA visual obrigatório; fallback vtracer; ajuste de `--alphamax`/`--opttolerance`; speckle filter |
| Balde vazando em contornos abertos (C, S, J) | Aceito no MVP; opção de inserir fechos invisíveis no SVG |
| Despejo do IndexedDB pelo Safari/iOS | `persist()` + orientar a instalar como PWA (instalados são despejados com menos frequência); risco aceito no MVP |
| Costura clara entre fill e traço | Fill dilatado 1–2 px para dentro da zona de antialias; tinta desenhada por cima |
| Performance em celular antigo | Resolução de pintura fixa, tinta não redesenhada, zero re-render React durante o traço |
| Troca de orientação no meio de um traço | `pointercancel` → fecha o traço e faz flush do autosave |

---

## 4. Definição de pronto (MVP)

- [ ] 26 letras vetorizadas, com `ink.png`, `region.png` e thumb aprovados visualmente
- [ ] Pincel, giz de cera, balde e borracha funcionando com o dedo e com o mouse
- [ ] 3 tamanhos, **desfazer**, paleta em ordem do arco-íris (Anexo A)
- [ ] Setas A↔Z e grade das 26 renderizando as pinturas salvas
- [ ] Pintura salva e restaurada após fechar e reabrir o app
- [ ] Limpar letra atual e limpar tudo (com confirmação)
- [ ] Funciona offline no celular como PWA instalada
- [ ] Deploy automático no GitHub Pages
- [ ] Testes de geometria/regiões e um e2e de persistência

---

## 5. Decisões fechadas (revisões 2 e 3)

| Tema | Decisão |
|---|---|
| Desfazer | **Entra no MVP** — pilha de bitmaps da sessão atual; não persiste entre sessões |
| Domínio próprio | **Não** — GitHub Pages em `*.github.io`, com as mitigações de D11 |
| Letra "concluída" | **Não existe** — a grade renderiza a pintura salva; a criança avança quando quiser |
| Paleta | **24 cores, ordem arco-íris** (oficiais do Lore exceto brancos de X/Y/Z; + off-white) — Anexo A |
| Brancos (X, Y, Z) | **Omitidos** — substituídos por um único off-white `#F5F0E8` no fim do arco-íris |
| Ordem da paleta | **Arco-íris** (matiz), não ordem A→Z |
| Cor oficial / atalho | **Não** — a criança escolhe livremente |
| Exportar / imprimir | **Fora de escopo** |
| Repositório | **`lore-coloring`**, público (D11) |
| Artefatos de build | **Commitados** em `public/letras/**`; CI não precisa de potrace (D4) |
| Ferramentas locais | `potrace` 1.16 via Homebrew + `sharp` como devDependency |
| Som | Fora do MVP, mas com a arquitetura de eventos pronta (D10) |

---

## 6. Pendências

1. **Layout da paleta no celular**: grade fluida 4×6 (proposta em A.3) vs. duas linhas com scroll horizontal. Testar com o dedo antes de fechar.
2. **Paleta de 24 pode ficar apagada.** Os 8 tons extras de alta saturação que eu havia proposto (magenta `#E64980`, ciano `#22D3EE`, roxo vivo `#7048E8`, laranja-neon `#FF922B`, dourado `#FAB005`, rosa-chiclete `#FF8FCF`, marrom `#8B5E34`, cinza-claro `#CED4DA`) foram retirados junto com a mudança de ordem. Reavaliar depois do primeiro teste com a criança.

---

## 7. Plano de execução

Regra: **nenhuma etapa começa antes do gate da anterior**. A Etapa 1 é a única que pode invalidar o resto do projeto — é ela que decide se as letras ficam nítidas e se o balde é viável.

### Etapa 0 · Repositório (30 min)

- `git init` já feito → renomear `master` → `main` antes do primeiro push (default do GitHub).
- Primeiro commit: `docs/`, `.gitignore` e os originais movidos de `letras_recortadas/` para `assets-src/letras/`.
- Criar o repo `lore-coloring` no GitHub, público.

**Gate 0:** primeiro commit no ar, sem `node_modules`/`dist` no índice.

### Etapa 1 · Pipeline de assets (½ dia) — **bloqueante**

Entregas: `scripts/build-assets.mjs`, `public/letras/{A..Z}/{ink.svg, ink.png, region.png, thumb.webp}` e uma prancha de contato em `_qa/`.

1. Binarizar cada PNG com `sharp` (threshold ~50%) → PBM.
2. `potrace -s` → SVG → sanitizar (remover metadados, arredondar coordenadas).
3. **Bbox compartilhado**: união dos bboxes das 26 no espaço vetorial → `viewBox`, preservando as proporções relativas entre letras (o `I` continua fino, o `M` largo).
4. Rasterizar o SVG em 2048 × 1562 → `ink.png` (preto + `alpha = 1 − luminância`).
5. `region.png` @1024 × 781: componentes conexos do não-tinta (4-conexo, `alpha ≥ 0,5` como barreira).
6. `thumb.webp` + prancha de contato das 26 com diff contra o original ampliado 4×.

**Gate 1 (sua aprovação visual):** seis letras, escolhidas por detalhe fino — `A` (dentes), `K` (olhos compostos e antenas), `Q` (manchas), `W` (duas irmãs), `Z` (cauda), `H` (olhos do fantasma). Critério: nenhum detalhe perdido, contorno contínuo, ausência de speckles.
**Fallback:** se o potrace degradar, trocar por `@neplex/vectorizer` (vtracer) ou cair para upscale Lanczos 4×.

**Métricas a registrar no doc ao fechar a etapa:**

- peso total de `public/letras/` (se passar de ~5 MB, trocar `ink.png` por WebP lossless ou baixar para 1536 px);
- nº de letras com contorno aberto (quantos "fechos invisíveis" o balde vai precisar);
- nº de paths por letra (termômetro de over/under-tracing).

### Etapa 2 · Esqueleto do app (1 dia)

- Vite + React 19 + TS (`strict`), sem lib de canvas.
- `Painter`: 3 camadas, `devicePixelRatio`, Pointer Events + `getCoalescedEvents`, interpolação por curvas quadráticas, undo em memória.
- Loader das letras + pager A↔Z. Sem ferramentas ainda.

**Gate 2:** pintar com um pincel fixo, desfazer e navegar sem travar em 60 fps no celular.

### Etapa 3 · Ferramentas (1–2 dias)

- Pincel, giz de cera, borracha, balde (region map), 3 tamanhos, paleta de 24.

**Gate 3:** balde sem costura branca sob o traço; borracha não apaga a tinta; giz com textura visível.

### Etapa 4 · Persistência (1 dia)

- IndexedDB (`idb`), autosave com debounce + flush em `pagehide`, restauração, limpar letra / limpar tudo, grade das 26 com as pinturas salvas.

**Gate 4:** e2e do Playwright — pintar, recarregar, conferir que voltou.

### Etapa 5 · PWA + deploy (½ dia)

- `vite-plugin-pwa`, GitHub Actions, Pages, `base: '/lore-coloring/'`.

**Gate 5:** instalado no celular, em modo avião, tudo funcionando.

### Etapa 6 · Teste com a criança (1 sessão)

Observar e anotar: ela pinta fora da linha de propósito? o balde vazando confunde ou diverte? 24 cores é demais? pede desfazer? Os ajustes viram a rev. 5 do doc.

**Ordem de grandeza:** ~4–5 dias de trabalho esparsos até o Gate 5, mais uma sessão de observação.


---

## Anexo A · Paleta

### A.1 Regras de ordenação

- **Ordem de arco-íris (matiz)**: vermelho → laranja → amarelo → verde → verde-água → azul → violeta → rosa. Dentro de cada faixa, os tons mais escuros vêm primeiro (quando o matiz permite).
- **Neutros no fim**, como rampa de valor (escuro → claro): preto, cinza, areia, off-white.
- **Sem branco puro.** X, Y e Z são brancos no desenho; pintar de branco sobre papel branco não aparece. Ficam de fora e entram como **um único off-white** `#F5F0E8`, no fim da paleta (serve de "corretivo").
- **Sem swatches com a letra.** Como a ordem não é mais A→Z, o swatch é só a cor.
- **Sem botão de "cor oficial da letra".** A criança escolhe livremente em qualquer letra.
- **Sem color picker e sem input de hex** na UI: a paleta é fechada.
- Cada cor guarda metadado `from` (letra de origem, quando houver) em código, mesmo sem aparecer na UI.

### A.2 A paleta (24 cores)

Fonte dos hex: breakdown RGB das cores de corpo em [Alphabet Lore RGB Colors](https://www.deviantart.com/worldofcaitlyn/journal/Alphabet-Lore-RGB-Colors-1022589741), com os nomes conferidos no [TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/WebAnimation/AlphabetLore) (Tart Red, Sky Blue, Banana Yellow, …). As paletas de "colorswall" que aparecem na busca são aproximações de fã e foram **rejeitadas** como fonte. O off-white é a única cor não-canônica.

| # | HEX | Nome | Origem |
|---|---|---|---|
| 1 | `#782D2D` | vinho | R |
| 2 | `#A1282D` | vermelho escuro | M |
| 3 | `#D24545` | vermelho | A |
| 4 | `#F5A05F` | laranja | N |
| 5 | `#FFE777` | amarelo ouro | C |
| 6 | `#FFFF00` | amarelo | K |
| 7 | `#B4E182` | verde-limão | U |
| 8 | `#9FC381` | verde-oliva | S |
| 9 | `#88C170` | verde folha | D |
| 10 | `#B8D2C5` | verde-menta | H |
| 11 | `#5E9B8B` | verde-petróleo | L |
| 12 | `#46B0A9` | verde-água | E |
| 13 | `#007DA5` | azul oceano | O |
| 14 | `#01548A` | azul-marinho | V |
| 15 | `#BFD4ED` | azul-céu | I |
| 16 | `#A2BEFF` | azul bebê | B |
| 17 | `#7E709B` | lilás | W |
| 18 | `#6E5B7C` | roxo acinzentado | G |
| 19 | `#AA95B3` | lavanda | J |
| 20 | `#D46782` | rosa | P |
| 21 | `#000000` | preto | F |
| 22 | `#666C73` | cinza | T |
| 23 | `#E1D2AE` | areia | Q |
| 24 | `#F5F0E8` | off-white | — |

### A.3 Layout e regras

- **Grade fluida, sem scroll**: `repeat(auto-fit, minmax(44px, 1fr))`, preenchendo a largura, com leitura esquerda→direita e cima→baixo. No celular em retrato caem 4 linhas de 6; no tablet, 2 linhas de 12. Todos os 24 visíveis ao mesmo tempo — sem rolagem ao lado do desenho.
- Swatch **circular** de no mínimo **44 px**, selecionado com anel escuro de 3 px + leve aumento de escala.
- O off-white precisa de **borda sutil** (1 px), senão desaparece contra o papel.
- A paleta é dessaturada por natureza (são as cores do desenho). Se, no teste com a criança, ela parecer apagada, avaliar reincorporar algumas cores extras de alta saturação — ver Pendências.



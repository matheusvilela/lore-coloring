# Decisões — App de colorir "Alfabeto Lore"

**Status:** aprovado (MVP) · **Data:** 17/11/2026 · **Rev.:** 7 · **Alvo:** celular, tablet e desktop (mesma build)

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

⚠️ **Risco original, já medido e descartado:** em letras de traço "aberto" (C, S, J) o balde vazaria para o fundo. O build provou o contrário — as 26 letras têm o corpo fechado como região própria (ver "Resultado da Etapa 1"). Único caso: no `C` o corpo é dividido em **duas** regiões pela própria linha da boca, então o balde pinta a metade de cima ou a de baixo. Comportamento aceitável.

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

**Recorte por letra: rejeitado em 16/11/2026.** A ideia era dar a cada letra um canvas do tamanho do próprio bbox (ganho medido de **2,75× de área mediana no celular**, 4,6× na letra E). Foi descartada porque: (a) a folha mudaria de forma a cada letra, (b) M/X/W não cresceriam de qualquer jeito (já encostam na largura em retrato), (c) quebraria a garantia de coordenadas iguais de D7 e a persistência simples de D8. No lugar dela entrou **pinça/zoom (D15)**, que dá o mesmo controle de perto sem tirar a régua única do canvas.

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
├─ assets-src/letras/          # PNGs originais (A–Z, traço preto)
├─ assets-src/coreano/         # folha colorida + 40 recortes (jamo)
├─ scripts/
│  ├─ build-assets.mjs         # vetoriza → rasteriza → region map → thumb (por idioma)
│  ├─ crop-coreano.mjs         # folha colorida → 1 PNG por jamo
│  └─ coreano-jamo.mjs         # os 40 jamo: nome, glifo e caixa (fonte única)
├─ public/letras/{A..Z}/       # gerado (ink.svg, ink.png, region.png, thumb.webp)
├─ public/coreano/{jamo}/      # gerado, mesmo formato — ainda sem UI
├─ e2e/                        # Playwright (studio + ferramentas)
├─ src/
│  ├─ App.tsx                  # studio: palco, pager, zoom, atalhos (a grade entra na Etapa 4)
│  ├─ canvas/
│  │  ├─ Painter.ts            # motor: camadas, comandos, undo, balde, borracha
│  │  ├─ geometry.ts           # traço suavizado (vivo e replay)
│  │  ├─ texture.ts            # ladrilho determinístico do giz de cera
│  │  ├─ zoom.ts               # pinça/roda: transformação fora do React (D15)
│  │  └─ tools.ts              # ferramentas e tabela de espessuras
│  ├─ components/Dock.tsx      # ferramentas, tamanhos, paleta
│  ├─ data/{letters.ts,palette.ts}
│  └─ styles.css
└─ docs/decisoes.md
```

Previsto para as próximas etapas: `storage/db.ts` (IndexedDB), `components/LetterGrid.tsx` (grade das 26), `components/Confirm.tsx` (limpar tudo), `sound/` (provider no-op — D10).

### D13 · Testes

- **Vitest**: geometria, leitura do mapa de regiões, serialização da persistência, migração de schema do IndexedDB.
- **Playwright**: fluxo com Pointer Events sintéticos — pintar, navegar, recarregar e conferir que a pintura voltou; balde; borracha; limpar letra/limpar tudo.

### D14 · Composição da tela (uma build só, três faixas)

Ordem vertical: **palco (folha + setas) → dock (ferramentas + tamanhos + desfazer + cores)**. Não existe mais barra de topo: o nome da letra saiu do layout (fica só num `<p role="status">` invisível, para leitores de tela) porque o desenho já diz qual letra é. O espaço liberado vai para a folha.

- **Setas**: embaixo da folha, alinhadas às bordas dela, no celular em retrato. Em telas com canaleta (≥ 760 px **e** proporção ≥ 4:3 — desktop, tablet deitado, celular deitado) as setas vão para as **laterais do board**, no centro vertical, sem custar largura da folha. Elas ficam acima da folha no empilhamento (`z-index`), então continuam clicáveis mesmo com zoom.
- **Desfazer**: dentro do dock, à direita dos tamanhos (divisor fino entre os dois grupos) — sai da barra de topo. Continua com `Ctrl/Cmd+Z`.
- **Paleta**: `8 × 3` no celular em retrato (24 divide certo; o dock cai de 241 px para 132 px de paleta) e `12 × 2` a partir de 760 px.
- **Celular deitado (altura ≤ 560 px)**: a altura é o recurso escasso, então a paleta vira **fita horizontal com rolagem** (swatches de 40 px, 8 px de padding para o anel da cor ativa não ser cortado) e as ferramentas encolhem.
- **Celular estreito (≤ 420 px)**: as quatro ferramentas ocupam a primeira linha; tamanhos + desfazer ficam na segunda.
- **Alvos de toque**: swatch ~39 px (8×3 no celular; antes 54 px em 6×4), ferramenta ≥ 44 px, tamanho ≥ 34 px com halo no ativo.
- **Sem texto na UI**: só ícones e cor. Os rótulos existem em `aria-label` (pt-BR) para leitores de tela e para os testes.
- **Ícones**: pincel = *brush* do Bootstrap Icons, borracha = `eraser` do Lucide, desfazer = `undo-2` do Lucide, balde = o desenho original (aprovado). Giz de cera é **desenhado no projeto** (nenhuma biblioteca livre tem giz legível a 23 px): corpo deitado, faixa da embalagem e duas listras na ponta, traço 1,8 num viewBox 24.
- **Cor ativa** aparece com anel de 3 px de papel + 3 px de tinta; **ferramenta ativa** com anel interno na cor de destaque; **tamanho ativo** com fundo `#e7e2d8`.

### D15 · Zoom por pinça (entra no MVP)

Motivo: com o canvas fixo (D7), a folha em retrato é limitada pela largura — 370 × 282 num iPhone de 390 — e a letra não cresce mais que isso. A pinça resolve o "quero pintar o olho da letra" sem mudar a régua do canvas.

- **Gestos**: dois dedos ampliam (1× a **4×**) e arrastam ao mesmo tempo (o ponto entre os dedos fica preso). O primeiro dedo começa um traço; quando o segundo encosta, o traço é **abortado** (`Painter.cancelStroke()`) e vira gesto — não fica risco acidental. Soltar abaixo de 1,03× volta ao encaixe.
- **Balde**: passou a preencher **ao soltar** o dedo (antes era no toque, para parecer instantâneo). Sem isso a pinça com o balde ativo pintaria uma região inteira ao encostar o primeiro dedo. `pointercancel` descarta o toque pendente.
- **Desktop**: a pinça do trackpad chega como `wheel` com `ctrl` e é tratada igual (zoom ancorado no ponteiro). Tecla `0` volta ao encaixe.
- **Zera sozinho** ao trocar de letra e quando o palco muda de tamanho (rotação, resize), porque a geometria de encaixe mudou.
- **Implementação**: `src/canvas/zoom.ts`, transformação aplicada direto no DOM (`translate3d + scale`, `transform-origin: 0 0`), fora do ciclo do React — nenhum re-render por `pointermove` (regra de ouro D12). O `Painter` não muda: ele converte o ponteiro por `getBoundingClientRect()`, que já vem escalado.
- **Limite**: as camadas têm 2048 px de largura; a 4× num celular DPR 2 a tinta é ampliada ~1,4× além do raster, então fica levemente suave. Aceito (é traço de caneta, não texto).
- A folha é recortada pelo palco (`overflow: hidden`): o zoom não invade o dock.

### D16 · Outras línguas: traço extraído de arte colorida

O pipeline nasceu para as 26 latinas, que já vêm em traço preto. Para outras escritas a fonte é **arte colorida** (folha única em `assets-src/coreano/sheet.png`), e o que o app precisa é o mesmo produto: traço preto sobre branco. Então o pipeline ganhou dois estágios antes de vetorizar — **recortar** cada personagem e **descartar o preenchimento**:

- **Recorte por posse de componente**, não por célula geométrica: cada componente conexo da folha pertence a uma letra; adereços soltos (chapéu, texto "WAND", câmera, latas de spray) são agrupados por vizinhança e o grupo inteiro vai para a letra cuja caixa dilatada em 24 px cobre mais área dele. Célula por ponto médio cortava adereço ao meio (a asa do `ㅂ`, o "W" do "WAND").
- **Traço = preto neutro**: o contorno é `#000000`/`#010101` e o preenchimento mais escuro começa em `#1a1621`, então **canal máximo ≤ 24** separa os dois com 9 níveis de folga. Pupilas, sobrancelhas e dentes continuam sólidos; corpos escuros (o sol `ㅇ`, `#1a1621`) viram contorno vazado, que é o que a criança pinta.
- **Objeto desenhado só em cinza vira contorno gerado**, mas só se estiver **fora** de área fechada por preto: as latas do `ㅛ` não têm linha nenhuma, e sem elas as hastes da letra terminam no ar. Cinza cercado por preto é sombra interna (olho do `ㅗ`, lente do `ㅟ`) e continua fora.
- **Canvas uniforme** de mesma proporção das latinas (309 × 236 ↔ 329 × 251) → o resto do pipeline (`viewBox` compartilhado, 2048 × 1562, `region.png`, `thumb`) roda **sem nenhuma alteração**.
- **Idioma é argumento**: `node scripts/build-assets.mjs [latin|coreano|all]`. Os artefatos são commitados como os latinos; CI continua sem potrace.
- O coreano **não está na UI** ainda: `public/coreano/` existe, mas nenhuma tela o carrega. Detalhes e medições na seção 8.

---

## 2. Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Máscara/clip automático ("dentro das linhas") | Contraria o objetivo pedagógico (D3) |
| `localStorage` | Limite de ~5 MB, API síncrona, só string (D8) |
| Flutter Web / Godot Web / Unity WebGL | O motor de pintura seria custom de qualquer forma; bundle 1,5–30 MB, pior integração web/iOS |
| Oracle Cloud Free Tier | Zero backend necessário; custo de operação sem benefício (D11) |
| Konva / Fabric.js / Paper.js | Modelo de objetos vetoriais atrapalha borracha, textura e balde por píxel |
| Recortar cada letra no próprio bbox (canvas por letra) | Ganho real de 2,75× de área mediana no celular, mas a folha mudaria de forma a cada letra, M/X/W não cresceriam e quebraria a régua única de D7 / a persistência de D8. Trocado por zoom (D15) |
| Upscale 4× em vez de vetorizar | Escolhemos vetorizar (D4); o upscale fica como plano B se o trace degradar |

---

## 3. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| potrace perder detalhes finos (dentes, cílios, óculos) | QA visual obrigatório; fallback vtracer; ajuste de `--alphamax`/`--opttolerance`; speckle filter |
| ~~Balde vazando em contornos abertos~~ | **Descartado na Etapa 1:** 0 de 26 letras vazam (ver Resultado da Etapa 1) |
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
| Exportar letra | **Entra** — a grade salva a letra pintada em PNG (papel + pintura + tinta). **Imprimir/PDF em lote fica fora de escopo** |
| Repositório | **`lore-coloring`**, público (D11) |
| Artefatos de build | **Commitados** em `public/letras/**`; CI não precisa de potrace (D4) |
| Ferramentas locais | `potrace` 1.16 via Homebrew + `sharp` como devDependency |
| Som | Fora do MVP, mas com a arquitetura de eventos pronta (D10) |

---

## 6. Pendências

1. **Layout da paleta no celular**: grade fluida 4×6 (proposta em A.3) vs. duas linhas com scroll horizontal. Testar com o dedo antes de fechar.
2. **Paleta de 24 pode ficar apagada.** Os 8 tons extras de alta saturação que eu havia proposto (magenta `#E64980`, ciano `#22D3EE`, roxo vivo `#7048E8`, laranja-neon `#FF922B`, dourado `#FAB005`, rosa-chiclete `#FF8FCF`, marrom `#8B5E34`, cinza-claro `#CED4DA`) foram retirados junto com a mudança de ordem. Reavaliar depois do primeiro teste com a criança.
3. **Retrato de celular: a letra em 100% continua pequena.** ~~Resolvido~~ **Resolvido por outro caminho (rev. 6).** A arte é paisagem (1,31:1), então a folha em retrato é limitada pela largura: 370 × 282 num iPhone de 390, e no tamanho de encaixe ela não cresce mais. Tentei canvas por letra (ganho medido de 2,75× de área mediana) e **descartei** pelos motivos de D7. A solução adotada foi **pinça/zoom até 4×** (D15), que dá o mesmo "pintar o olho da letra" sem mudar a régua. A folga vertical que sobrou entre a folha e o dock não é mais desperdício: virou faixa das setas no celular. Continua em aberto, se o teste com a criança pedir, **abrir já ampliado no bbox da letra** ao trocar de página (zoom inicial em vez de 1×).
4. **Letra apagada até o fim conta como "pintada".** O histórico tem comandos de borracha, então `hasPaint()` continua verdadeiro com a tela em branco. Na Etapa 4 isso apareceria na grade como uma miniatura em branco. Decidir lá: salvar só se houver píxel não transparente (checagem barata no momento do save) e, se não houver, apagar o blob.
5. **Coreano fora da UI.** Os 40 jamo já estão recortados, vetorizados e medidos em `public/coreano/`, mas nenhuma tela os carrega. Antes de ligar: seletor de idioma, lista de letras por idioma e a decisão do balde em traço aberto (seção 8.4).

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

### Resultado da Etapa 1 (medido em 15/11/2026)

| Métrica | Valor |
|---|---|
| bbox compartilhado | 309 × 231 (fonte), pad 6 px |
| fator de ampliação | **6,63×** → tinta renderizada em 2048 × 1531 |
| peso de `public/letras/` | **2,30 MB** (26 letras, 4 arquivos cada) — bem abaixo do limite de 5 MB |
| paths por letra | 1 a 9 (mediana 2) |
| regiões por letra | 6 a 22 |
| letras com corpo sem região própria | **nenhuma** — 0/26 vazam para o fundo |
| alinhamento `ink.png` × `region.png` | desvio máximo 3 px (em 2048), sob um traço de ~10 px |

Conclusão: o potrace preservou dentes, cílios, antenas, hastes dos óculos e manchas em todas as letras; o balde é viável sem gambiarra; o peso permite precache completo na PWA.

### Etapa 2 · Esqueleto do app (1 dia)

- Vite + React 19 + TS (`strict`), sem lib de canvas.
- `Painter`: 3 camadas, `devicePixelRatio`, Pointer Events + `getCoalescedEvents`, interpolação por curvas quadráticas, undo em memória.
- Loader das letras + pager A↔Z. Sem ferramentas ainda.

**Gate 2:** pintar com um pincel fixo, desfazer e navegar sem travar em 60 fps no celular.

### Resultado da Etapa 2 (16/11/2026)

- Stack real: Vite 8, React 19.3, TypeScript 7 `strict`, zero libs de canvas.
- `Painter` com as 3 camadas (`paint` / `wet` / `ink`), `setPointerCapture`, `getCoalescedEvents` e suavização quadrática compartilhada com o replay do undo (`traceStroke`).
- e2e no Playwright em dois projetos (`desktop` 1280×900 e `celular` Pixel 7): pintar, desfazer, navegar e a garantia de que a camada de tinta nunca muda.
- **Bug pego pelos screenshots:** a folha usava `getBoundingClientRect()` do palco, que inclui o padding — no celular ela media 390 px num palco de 390 px com 12 px de padding e vazava 12 px pela direita. Corrigido medindo `clientWidth/clientHeight` menos o padding computado; 0 de overflow em 390×844, 360×740 e 844×390.
- **Achado de composição:** a arte é paisagem (1,31:1). Em retrato a folha fica limitada pela largura (366 × 279 num iPhone de 390), sobrando muito espaço vertical. Mantido assim de propósito: é exatamente onde entram paleta e ferramentas na Etapa 3 (ver Pendência 3).

### Etapa 3 · Ferramentas (1–2 dias)

- Pincel, giz de cera, borracha, balde (region map), 3 tamanhos, paleta de 24.

**Gate 3:** balde sem costura branca sob o traço; borracha não apaga a tinta; giz com textura visível.

### Resultado da Etapa 3 (16/11/2026)

Quatro ferramentas, três tamanhos, 24 cores. Undo único para tudo (traço, balde e borracha) porque o histórico guarda **comandos**, e o replay redesenha na mesma ordem — é o que faz a borracha não apagar o que veio depois dela e o balde não "vazar" no undo.

| Item | Como ficou |
|---|---|
| Pincel | traço sólido, cantos redondos, 30 / 58 / 100 px |
| Giz de cera | duas passadas (corpo largo + núcleo estreito) com textura de ladrilho semeado por cor; 36 / 68 / 116 px |
| Borracha | `destination-out` na camada de pintura; 80 / 150 / 240 px |
| Balde | máscara cacheada por região em resolução de pintura, 2× exato do `region.png` |
| Undo | pilha de comandos da sessão; desfazer do balde e da borracha também |

Medições (`e2e/tools.spec.ts`, 18 casos × 2 projetos, todos verdes):

- **Balde**: 0 píxeis pintados fora da região (fora = qualquer região diferente da alvo e que não seja tinta); **100%** dos píxeis da região encostados na linha preta ficaram cobertos → sem costura branca. Confirmado no zoom visual.
- **Costura**: a máscara do balde é **dilatada 1 px para dentro da tinta**. Como a tinta é sempre desenhada por cima, a dilatação é invisível e mata o fio branco do antialiasing.
- **Borracha**: apaga > 80% do traço e a contagem de píxeis da camada de tinta não muda em 1 píxel.
- **Giz**: 26% dos píxeis da faixa central com cobertura parcial no tamanho médio (31% no grande) contra 0,2% do pincel — textura medida, não só "parece".
- **Cache**: a máscara de cada região é montada na primeira vez que o balde a usa e reaproveitada; a soma das regiões é ~13 MB de canvas por letra no pior caso.

Dois ajustes que só apareceram olhando o print:

1. `auto-fit`/`minmax(44px, 1fr)` na paleta dava **7 colunas** num iPhone de 390 px, deixando 3 swatches órfãos na última linha. Trocado por 6 colunas fixas (12 no desktop).
2. O primeiro giz parecia **confete**: furos grandes e de alto contraste. Refeito com grão fino e denso + poucas falhas fundas (média de alfa foi de 219 para 238 de 255).

### Resultado da revisão de layout (16/11/2026, rev. 6)

Header removido, setas reposicionadas, undo no dock, paleta mais densa e zoom por pinça. O objetivo era dar mais espaço à letra sem abrir mão do canvas fixo de D7.

| Tela | Folha antes | Folha depois | Ganho de área |
|---|---|---|---|
| Celular 390 × 844 | 366 × 279 | **370 × 282** | +2% (limitada pela largura; o ganho real é o zoom) |
| Desktop 1280 × 860 | 746 × 569 | **850 × 649** | **+30%** |
| Celular deitado 844 × 390 | 293 × 224 | **346 × 264** | **+39%** |

- **Onde o espaço saiu:** header (~56 px, devolvido ao palco), paleta 6×4 → 8×3 no celular (−109 px de dock) e setas na mesma faixa da folha no desktop/deitado (canaletas de 86 px, zero custo de altura).
- **Onde o espaço foi:** folha (acima) e paleta com swatches de ~39 px no celular — ainda acima do alvo mínimo de toque para uma criança, mas menos folgado que os 54 px de antes; o teste com a criança decide se volta a 6×4.
- **Zoom:** a 1× a tinta é reduzida ~2,8× (2048 px do canvas em 370 CSS px a DPR 2); a 4× ela é ampliada ~1,4× além do raster. Aceito (D15).
- **Custo real do undo no dock:** no celular ele cria uma segunda linha curta (tamanhos + desfazer), então o dock ficou em 268 px — menor que os 317 px de antes, mas 58 px mais alto do que se o undo tivesse ido para a faixa das setas.
- **Regressão pega pelo e2e:** com a folha ampliada, o canvas pintava por cima do pager e as setas deixavam de responder. Corrigido com `position: relative; z-index: 2` no pager.

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

## 8. Outras línguas · coreano (jamo)

Objetivo: deixar a base pronta para colorir outras escritas. O coreano entrou primeiro porque a folha de origem já existia — **uma arte colorida única** (`assets-src/coreano/sheet.png`, 1280 × 1064, fundo branco, 40 personagens em 6 linhas).

O que o app consome é sempre o mesmo produto: traço preto sobre branco. Por isso o pipeline virou `crop → extrair traço → vetorizar` (D16), e a parte de vetorização é **a mesma** das latinas.

### 8.1 Recorte: posse de componente, não célula

A folha não tem grade: os personagens têm braços, asas e adereços que passam da coluna vizinha. A primeira tentativa (banda de linha + célula delimitada pelo ponto médio entre corpos) cortava adereço ao meio — a asa direita do `ㅂ` ficava com 204 px de 267, o "WAND" do `ㅈ` virava "IND", as latas do `ㅛ` perdiam as pontas.

A regra que ficou:

1. Cada componente conexo (8-conexo, ≥ 8 px) da folha pertence a uma letra.
2. Componente **contido** na caixa do corpo de uma letra é dela (olhos, boca, detalhes internos).
3. Os demais são adereços: agrupados por vizinhança (até 10 px entre caixas) e o **grupo inteiro** vai para a letra cuja caixa, **dilatada em 24 px**, cobre mais área do grupo. Distância pura errava (o "W" do "WAND" caía no `ㅇ` vizinho, porque estava a 3 px dele e a 30 px do `ㅈ`); sobreposição só em x errava na vertical (jogava adereço na linha de baixo).
4. O recorte é a união dos componentes da letra, centrada num canvas uniforme.

| Adereços agrupados | Letra | Peças |
|---|---|---|
| "WAND" + seta + varinha | `ㅈ` jieut | 5 |
| câmera + símbolo azul | `ㅋ` kieuk | 2 |
| chapéu de bruxa | `ㅈ` jieut | (corpo) |
| latas de spray | `ㅛ` yo | 2 |
| linhas de fedor | `ㅉ` ssang-jieut | 4 |
| lâmpada do gênio | `ㄲ` ssang-giyeok | (corpo) |
| barco/vela | `ㅙ` wae | (corpo) |

**Prova de que nada se perdeu:** remontando a folha a partir dos 40 recortes, sobram **2 px de 521.409** (0,000%) — os dois são um respingo de 2 px descartado como ruído. Artefatos: `_qa/coreano/conferencia.png` (os 40 recortes), `_qa/coreano/recortes.json` (geometria) e `_qa/coreano/reconstrucao.png`/`reconstrucao.mjs` (a prova).

Ordem de leitura confirmada contra as descrições dos personagens: `ㄱㄴㄷㄹㅁㅂㅅ / ㅇㅈㅊㅋㅌㅍㅎ / ㅏㅑㅓㅕㅗㅛㅜㅠ / ㅡㅣㄲㄸㅃ / ㅆㅉㅐㅒㅔㅖㅘ / ㅙㅚㅝㅞㅟㅢ` (lâmpada = `ㄲ`, dentes de piranha = `ㄸ`, gêmeas = `ㅃ`, linhas de fedor = `ㅉ`, ímã = `ㅒ`, dinossauro = `ㅙ`, antenas = `ㅚ`, besta = `ㅞ`, barba + bengala = `ㅟ`, planeta = `ㅢ`).

### 8.2 Traço: descartar preenchimento sem perder olho

O contorno da arte é preto puro e o preenchimento mais escuro é `#1a1621`. Medido na folha: `#000000` 139.658 px, `#010101` 16.889 px, e o primeiro preenchimento escuro `#1a1621` (canal máximo 33). **Canal máximo ≤ 24** separa os dois com folga; a franja de antialiasing que passa é do próprio contorno (dezenas de px por letra).

O resultado preserva pupila, cílios, dentes e sobrancelhas, e transforma corpo escuro em contorno vazado — `ㅇ` (sol, `#1a1621`) sai como anel com espinhos, que é exatamente o que a criança pinta.

**O que fica de fora, de propósito:** elemento desenhado só em **valor** (cinza-claro), sem linha preta. O brilho das lentes do `ㅟ` é `#ededed` e some. Promovê-lo a traço seria errado, porque o mesmo cinza-claro é usado como **sombra dentro dos olhos** (`ㅗ`, `#c1c1c1`): viraria um anel fantasma em volta da pupila. Regra: entra linha, sai valor. É a mesma escolha que descarta os preenchimentos coloridos.

**A exceção: objeto sem contorno.** As latas de spray do `ㅛ` também são só valor — mas, ao contrário da sombra do olho, estão **fora de qualquer área fechada por preto**. Sem elas as duas hastes da letra terminavam no ar e o `ㅛ` ficava aberto nas laterais. Então o pipeline ganhou um estágio: cinza neutro, com área ≥ 200 px, que seja **exposto** (alcançável da borda da página sem atravessar preto) vira **contorno gerado** — silhueta, `closing` de 2 px (as ranhuras da tampa viravam um pente) e anel de 2 px (mesma espessura do traço da letra depois do render). Cinza **cercado** por preto continua fora: é sombra interna. A franja de antialiasing também (cinza a até 2 px do preto). Na folha inteira o único objeto exposto é o par de latas do `ㅛ`: **286 px de anel**, e só `public/coreano/yo/**` muda. O bico vermelho da lata é preenchimento colorido e não entra — a lata sai como corpo liso, ligada às hastes.

Recortes coloridos para conferência em `_qa/coreano/conferencia.png`; traço final em `_qa/coreano/prancha.png`.

### 8.3 Medições

| Métrica | Valor |
|---|---|
| personagens | 40 (7 + 7 + 8 + 5 + 7 + 6) |
| canvas do recorte | 309 × 236 (mesma proporção das latinas, 1,309:1) |
| bbox compartilhado | 307 × 188 @ (1, 24) |
| tinta renderizada | **2048 × 1254** (fator 6,67×), centrada em 2048 × 1562 |
| peso de `public/coreano/` | **2,32 MB** (40 letras, 4 arquivos cada; média 59 KB) |
| paths por letra | 1 a 12 (mediana 2) |
| regiões por letra | 4 a 20 |
| traço extraído × original | 0,000% de tinta perdida no recorte; olhos e dentes preservados |
| objetos em cinza (sem contorno) | latas do `ㅛ`: contorno gerado (286 px de anel no `ㅛ`); brilho da lente do `ㅟ` fica fora por ser sombra interna |

### 8.4 O que muda quando o coreano entrar na UI

1. **A arte coreana é mais larga.** Como o bbox é justo (união do traço), 307 × 188 = 1,63:1, contra 1,31:1 das latinas. Na mesma canvas de 2048 × 1562 a tinta ocupa 80% da altura — as letras ficam ~20% menores que as latinas. Inevitável sem canvas por idioma (D7 continua valendo para o app). Se incomodar no teste, o caminho é o mesmo de D7: canvas por **idioma**, não por letra.
2. **Muitos jamo não têm região fechada.** `ㄴ`, `ㄱ`, `ㅏ` são traço aberto: o "dentro" é o fundo da página, então o balde nesses casos pinta a página inteira (a heurística latina "maior% < 8" lista **28 de 40** e não vale aqui). Antes de ligar o balde no coreano, decidir: desabilitar o balde quando a região é a externa, ou desenhar um "fecho invisível" no `region.png`.
3. **Seletor de idioma e roteamento** (`/lore-coloring/` + `?lang=ko` ou caminho) e a lista de letras em `data/letters.ts` passando a ser por idioma — nada disso existe ainda.

### 8.5 Como regerar

```bash
npm run crop:coreano              # folha colorida  -> assets-src/coreano/*.png
npm run build:assets              # os dois idiomas  -> public/{letras,coreano}
node scripts/build-assets.mjs coreano   # só o coreano
```

`npm run crop:coreano` só é necessário se a folha de origem mudar; os recortes são commitados.

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



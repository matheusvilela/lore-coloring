import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** Zoom máximo: 4× ainda mantém o traço da letra nítido na tela do celular. */
const MAX_SCALE = 4;
/** Abaixo disso, soltar os dedos volta a folha ao encaixe original. */
const SNAP_BACK = 1.03;
/** Botões + / − do dock. */
const BUTTON_ZOOM_FACTOR = 1.28;

type View = { scale: number; x: number; y: number };
/** Posição/tamanho da folha sem a transformação aplicada, relativa ao palco. */
type Base = { left: number; top: number; width: number; height: number };

type Gesture = {
  ids: [number, number];
  startScale: number;
  startDist: number;
  /** Ponto da folha (em coordenadas locais) que fica preso entre os dedos. */
  anchorX: number;
  anchorY: number;
};

/**
 * Pinça para ampliar a folha (D15).
 *
 * A transformação é aplicada direto no DOM, fora do ciclo do React: um gesto
 * dispara dezenas de eventos por segundo e não vale re-renderizar a paleta
 * inteira a cada um. O `Painter` continua correto porque converte o ponteiro
 * pelo `getBoundingClientRect` da camada, que já vem escalado.
 *
 * O primeiro dedo começa um traço; quando o segundo encosta, o traço é
 * abortado (`onSecondPointer`) e os dois dedos passam a mover a folha.
 */
export function usePinchZoom(
  stageRef: RefObject<HTMLElement | null>,
  sheetRef: RefObject<HTMLElement | null>,
  onSecondPointer: () => void,
  onScaleChange?: (scale: number) => void,
) {
  const view = useRef<View>({ scale: 1, x: 0, y: 0 });
  const scaleListener = useRef(onScaleChange);
  scaleListener.current = onScaleChange;
  const scaleNotifyFrame = useRef(0);
  const base = useRef<Base>({ left: 0, top: 0, width: 0, height: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);

  const secondPointer = useRef(onSecondPointer);
  secondPointer.current = onSecondPointer;

  const emitScale = useCallback(() => {
    const listener = scaleListener.current;
    if (!listener) return;
    if (scaleNotifyFrame.current) cancelAnimationFrame(scaleNotifyFrame.current);
    scaleNotifyFrame.current = requestAnimationFrame(() => {
      scaleNotifyFrame.current = 0;
      listener(view.current.scale);
    });
  }, []);

  const apply = useCallback(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    const { scale, x, y } = view.current;
    sheet.style.transform =
      scale === 1 && x === 0 && y === 0
        ? ''
        : `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    emitScale();
  }, [emitScale, sheetRef]);

  const reset = useCallback(() => {
    view.current = { scale: 1, x: 0, y: 0 };
    gesture.current = null;
    pointers.current.clear();
    apply();
  }, [apply]);

  /** Lê a geometria da folha descontando a transformação que já está nela. */
  const readBase = useCallback((): boolean => {
    const stage = stageRef.current;
    const sheet = sheetRef.current;
    if (!stage || !sheet) return false;

    const sheetRect = sheet.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const current = view.current;
    base.current = {
      left: sheetRect.left - stageRect.left - current.x,
      top: sheetRect.top - stageRect.top - current.y,
      width: sheetRect.width / current.scale,
      height: sheetRect.height / current.scale,
    };
    return true;
  }, [sheetRef, stageRef]);

  /** Não deixa a folha sair de vista: encosta as bordas no palco. */
  const clampView = useCallback((): void => {
    const stage = stageRef.current;
    if (!stage) return;

    const current = view.current;
    if (current.scale <= 1) {
      view.current = { scale: 1, x: 0, y: 0 };
      return;
    }

    const { left, top, width, height } = base.current;
    const w = width * current.scale;
    const h = height * current.scale;
    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;

    current.x = w <= stageW ? (stageW - w) / 2 - left : clamp(current.x, stageW - left - w, -left);
    current.y = h <= stageH ? (stageH - h) / 2 - top : clamp(current.y, stageH - top - h, -top);
  }, [stageRef]);

  const scaleAround = useCallback(
    (nextScale: number, mx: number, my: number): void => {
      if (!readBase()) return;
      const current = view.current;
      const localX = (mx - base.current.left - current.x) / current.scale;
      const localY = (my - base.current.top - current.y) / current.scale;
      view.current = {
        scale: nextScale,
        x: mx - base.current.left - nextScale * localX,
        y: my - base.current.top - nextScale * localY,
      };
      clampView();
      apply();
    },
    [apply, clampView, readBase],
  );

  const zoomIn = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const mx = stage.clientWidth / 2;
    const my = stage.clientHeight / 2;
    const next = clamp(view.current.scale * BUTTON_ZOOM_FACTOR, 1, MAX_SCALE);
    scaleAround(next, mx, my);
  }, [scaleAround, stageRef]);

  const zoomOut = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const mx = stage.clientWidth / 2;
    const my = stage.clientHeight / 2;
    const next = clamp(view.current.scale / BUTTON_ZOOM_FACTOR, 1, MAX_SCALE);
    scaleAround(next, mx, my);
  }, [scaleAround, stageRef]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const startGesture = (): void => {
      const ids = [...pointers.current.keys()].slice(0, 2) as [number, number];
      const a = pointers.current.get(ids[0]);
      const b = pointers.current.get(ids[1]);
      if (!a || !b) return;

      // o traço do primeiro dedo vira lixo: o gesto é de zoom
      secondPointer.current();
      if (!readBase()) return;

      const stageRect = stage.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - stageRect.left;
      const my = (a.y + b.y) / 2 - stageRect.top;
      const current = view.current;

      gesture.current = {
        ids,
        startScale: current.scale,
        startDist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        anchorX: (mx - base.current.left - current.x) / current.scale,
        anchorY: (my - base.current.top - current.y) / current.scale,
      };
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !stage.contains(event.target)) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.current.size === 2) startGesture();
    };

    const onPointerMove = (event: PointerEvent): void => {
      const pointer = pointers.current.get(event.pointerId);
      if (!pointer) return;

      pointer.x = event.clientX;
      pointer.y = event.clientY;

      const active = gesture.current;
      if (!active) return;

      const a = pointers.current.get(active.ids[0]);
      const b = pointers.current.get(active.ids[1]);
      if (!a || !b) return;

      const stageRect = stage.getBoundingClientRect();
      const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const scale = clamp(active.startScale * (dist / active.startDist), 1, MAX_SCALE);
      const mx = (a.x + b.x) / 2 - stageRect.left;
      const my = (a.y + b.y) / 2 - stageRect.top;

      view.current = {
        scale,
        x: mx - base.current.left - scale * active.anchorX,
        y: my - base.current.top - scale * active.anchorY,
      };
      clampView();
      apply();
    };

    const onPointerUp = (event: PointerEvent): void => {
      pointers.current.delete(event.pointerId);
      if (gesture.current && pointers.current.size < 2) gesture.current = null;
      if (view.current.scale < SNAP_BACK) reset();
    };

    // pinça do trackpad chega como wheel com ctrl; no desktop é o único jeito
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (!readBase()) return;

      const stageRect = stage.getBoundingClientRect();
      const mx = event.clientX - stageRect.left;
      const my = event.clientY - stageRect.top;
      const scale = clamp(
        view.current.scale * Math.exp(-event.deltaY * 0.012),
        1,
        MAX_SCALE,
      );
      scaleAround(scale, mx, my);
    };

    stage.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    stage.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      stage.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      stage.removeEventListener('wheel', onWheel);
    };
  }, [apply, clampView, readBase, reset, scaleAround, sheetRef, stageRef]);

  return { reset, zoomIn, zoomOut, apply };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

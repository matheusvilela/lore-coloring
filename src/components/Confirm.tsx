type Props = {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function Confirm({ title, message, confirmLabel, onConfirm, onCancel }: Props) {
  return (
    <div className="confirm-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="confirm__title">
          {title}
        </h2>
        <p id="confirm-message" className="confirm__message">
          {message}
        </p>
        <div className="confirm__actions">
          <button type="button" className="btn confirm__btn" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="btn confirm__btn confirm__btn--danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
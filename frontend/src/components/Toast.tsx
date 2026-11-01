// Legacy dynamic types are explicit during the full language migration.
import { useUI } from '../store/useUI.ts';
import Icon from './Icon.tsx';
import { t } from '../lib/i18n.ts';
// The one toast. Mostly text; with an action (the Undo after a set is removed) it carries a button
// at its end, stays longer and holds still while a finger or the mouse rests on it. Its × sends it
// away at once: five seconds of Undo over the set list is long when you did mean to delete. The ×
// sits at the start, the far end from Undo, so a thumb aiming for one never lands on the other.
export default function Toast() {
    const msg: any = useUI((s?: any) => s.toastMsg);
    const action: any = useUI((s?: any) => s.toastAction);
    const { pauseToast, resumeToast, runToastAction, dismissToast }: any = useUI.getState();
    const live: any = !!(msg && action);
    return <div id="toast" role="status" className={(msg ? 'show' : '') + (live ? ' has-action' : '')} onPointerEnter={live ? pauseToast : undefined} onPointerDown={live ? pauseToast : undefined} onPointerLeave={live ? resumeToast : undefined} onPointerCancel={live ? resumeToast : undefined} onPointerUp={live ? ((e?: any) => { if (e.pointerType !== 'mouse')
        resumeToast(); }) : undefined}>
    {live && <button type="button" className="toast-x" aria-label={t('Close')} onClick={dismissToast}>
      <Icon name="xmark"/>
    </button>}
    <span className="toast-msg">{msg}</span>
    {live && <button type="button" className="toast-act" key={action.id} onClick={runToastAction}>
      <Icon name="undo"/>{action.label}
    </button>}
  </div>;
}

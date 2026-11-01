// Legacy dynamic types are explicit during the full language migration.
// The photos and videos of a logged workout — a progress photo, a form-check clip — on the finish
// screen and in the workout's detail sheet, and the full-screen viewer they open in.
//
// The same machinery as a custom exercise's picture, on purpose: a pick runs through the same
// ingest and lands in the same local store as pending (useMediaPicker), the list is written to
// the saved workout through lib/workout-media.ts (stamped, so the sync keeps the version edited
// last), the same sync uploads it and counts it as owed until the server has it, and thumbnails
// and the viewer show from the local store exactly as CustomMedia does — posters only in the
// grid, a main file only once it is opened (or made local by the sync), nothing ever loaded from
// a server URL. They are the owner's own: no Coach payload, MCP tool, plan file or "Copy as text"
// reads `media`; only the zip backup carries the files.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore.ts';
import { useUI } from '../store/useUI.ts';
import { t } from '../lib/i18n.ts';
import { workoutMediaOf, WORKOUT_MEDIA_MAX } from '../lib/media-refs.ts';
import { addWorkoutMedia, removeWorkoutMedia } from '../lib/workout-media.ts';
import { sameWorkout } from '../lib/workout-date.ts';
import { syncMedia } from '../lib/media-sync.ts';
import { useMediaPicker } from './CustomMediaField.tsx';
import { CustomThumb, MediaView } from './CustomMedia.tsx';
import { Button } from './ui.tsx';
import Icon from './Icon.tsx';
const toast: any = (m?: any) => useUI.getState().toast(m);
// The saved record `w` stands for, as the store holds it now: another device, the date row or
// this very sheet may have written it since the caller got its copy.
const useRecord: any = (w?: any) => useStore((s?: any) => (s.S.workouts || []).find((x?: any) => x && sameWorkout(x, w)) || null);
/** The number of photos and videos a workout shows — for the history row's small badge. */
export const workoutMediaCount: any = (w?: any) => workoutMediaOf(w).length;
/**
 * Whether a workout may be offered an Add at all, beside the picker's own reasons: signed in (a
 * paired phone included), the server has to say it keeps a workout's files (`media.workouts` in
 * /api/config) — one from before this feature stores an exercise's picture but its GC would sweep
 * a file only a workout names. A config not known yet (an offline start) is not that answer, and
 * a guest or a phone in local mode keeps its files on the device either way.
 */
export const serverTakesWorkoutMedia: any = (user?: any, config?: any) => !user || !config || !config.media || !!config.media.workouts;
/**
 * The grid of a workout's photos and videos with its Add tile. `hint` adds the one-line
 * explanation shown on the finish screen while there is nothing yet. Nothing at all while there
 * is nothing to show and nothing could be added (a server that does not keep them, a browser
 * that cannot store them).
 */
export default function WorkoutMediaSection({ w, hint = false }: any) {
    const rec: any = useRecord(w);
    const update: any = useStore((s?: any) => s.update);
    const user: any = useStore((s?: any) => s.user);
    const config: any = useStore((s?: any) => s.config);
    const { pick, busy, warning, note, storable, showAdd: pickerShowsAdd, canAdd: pickerCanAdd }: any = useMediaPicker();
    const fileRef: any = useRef(null);
    if (!rec)
        return null;
    const list: any = workoutMediaOf(rec);
    const room: any = WORKOUT_MEDIA_MAX - list.length;
    const showAdd: any = pickerShowsAdd && serverTakesWorkoutMedia(user, config);
    const canAdd: any = pickerCanAdd && showAdd;
    if (!list.length && !(showAdd && storable))
        return null;
    const onFiles: any = async (ev?: any) => {
        const picked: any = [...(ev.target.files || [])];
        ev.target.value = ''; // picking the same file again still fires onChange
        // Only as many as still fit go through the ingest: a batch of twelve on a phone would
        // otherwise re-encode (and store as pending) six files nothing will ever name.
        const now: any = useStore.getState().S.workouts?.find((x?: any) => x && sameWorkout(x, w));
        const files: any = picked.slice(0, Math.max(0, WORKOUT_MEDIA_MAX - workoutMediaOf(now).length));
        let added: any = 0;
        let full: any = files.length < picked.length;
        for (const file of files) {
            const got: any = await pick(file);
            if (!got)
                continue;
            let res: any;
            update((s?: any) => { res = addWorkoutMedia(s, w, got); });
            if (res === 'added')
                added++;
            else if (res === 'full') {
                full = true;
                break;
            }
            else if (res === 'gone') {
                toast(t('Workout deleted'));
                full = false;
                break;
            }
        }
        if (full)
            toast(t('Up to {0} photos or videos per workout.', WORKOUT_MEDIA_MAX));
        // Straight up, like an exercise's picture on save: the state push waits for its debounce.
        if (added)
            syncMedia({ force: true });
    };
    return <div className="wmedia">
    <div className="small muted wmedia-h">{t('Photos & videos')}</div>
    {(list.length > 0 || showAdd) && <div className="wmedia-grid">
      {list.map((m?: any, i?: any) => (<button key={m.hash} type="button" className="wmedia-item" data-swipe-ignore aria-label={t('Photo or video {0} of {1}', i + 1, list.length)} onClick={() => openWorkoutMediaViewer(w, i)}>
          <CustomThumb ex={{ custom: true, media: m }}/>
          {m.kind !== 'image' && <span className="wmedia-kind"><Icon name="play"/></span>}
        </button>))}
      {showAdd && room > 0 && (<button type="button" className="wmedia-add" disabled={!canAdd} onClick={() => fileRef.current?.click()}>
          <Icon name={busy ? 'image' : 'plus'}/>
          <span>{busy ? t('Loading…') : t('Add photo or video')}</span>
        </button>)}
    </div>}
    <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={onFiles}/>
    {hint && !list.length && showAdd && <div className="small dim wmedia-note">{t('A progress photo or a form-check video, kept with this workout.')}</div>}
    {room <= 0 && <div className="small dim wmedia-note">{t('Up to {0} photos or videos per workout.', WORKOUT_MEDIA_MAX)}</div>}
    {warning && <div className="small dim wmedia-note">{warning}</div>}
    {/* Where the files live, or why none can be added — about the ones there are, so not
            while there are none (the finish screen's hint says what the section is for). */}
    {note && list.length > 0 && <div className="small dim wmedia-note">{note}</div>}
  </div>;
}
/** Opens the full-screen viewer on the `index`-th photo or video of the saved workout `w`. */
export function openWorkoutMediaViewer(w?: any, index: any = 0) {
    useUI.getState().openSheet((close?: any) => <WorkoutMediaViewer w={w} index={index} close={close}/>, { kind: 'viewer' });
}
const FOCUSABLE: any = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, video[controls], [tabindex]:not([tabindex="-1"])';
export function WorkoutMediaViewer({ w, index = 0, close }: any) {
    const rec: any = useRecord(w);
    const update: any = useStore((s?: any) => s.update);
    const list: any = workoutMediaOf(rec);
    const [i, setI]: any = useState(index);
    const [asking, setAsking]: any = useState(false);
    const box: any = useRef(null);
    const at: any = Math.min(i, list.length - 1);
    const m: any = at >= 0 ? list[at] : null;
    // The last one removed here, or the workout deleted on another device: nothing left to show.
    useEffect(() => { if (!m)
        close(); }, [!m]);
    // Focus moves in on open (onto Close) and back to what opened it on the way out.
    useEffect(() => {
        const before: any = document.activeElement;
        box.current?.querySelector('button')?.focus();
        return () => { if (before && typeof before.focus === 'function' && before.isConnected)
            before.focus(); };
    }, []);
    if (!m)
        return null;
    const go: any = (d?: any) => { setAsking(false); setI((at + d + list.length) % list.length); };
    const remove: any = () => {
        let removed: any = false;
        update((s?: any) => { removed = removeWorkoutMedia(s, w, m.hash); });
        setAsking(false);
        if (removed && at >= list.length - 1)
            setI(Math.max(0, at - 1));
    };
    // Tab stays inside the viewer (it covers the whole screen, and the page behind is not there to
    // reach); left and right step through the list — mirrored where the language reads right to
    // left, as the arrows on screen are. A video's own controls keep the arrows while focused.
    const onKeyDown: any = (e?: any) => {
        if (e.key === 'Tab') {
            const items: any = [...(box.current?.querySelectorAll(FOCUSABLE) || [])];
            if (!items.length)
                return;
            const first: any = items[0], last: any = items.at(-1);
            const inside: any = box.current.contains(document.activeElement);
            if (e.shiftKey && (!inside || document.activeElement === first || document.activeElement === box.current)) {
                e.preventDefault();
                last.focus();
            }
            else if (!e.shiftKey && (!inside || document.activeElement === last)) {
                e.preventDefault();
                first.focus();
            }
            return;
        }
        if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || list.length < 2 || asking)
            return;
        if (e.target?.tagName === 'VIDEO' || e.target?.tagName === 'INPUT')
            return;
        const rtl: any = document.documentElement.dir === 'rtl';
        e.preventDefault();
        go((e.key === 'ArrowRight') !== rtl ? 1 : -1);
    };
    return <div className="mviewer" role="dialog" aria-modal="true" aria-label={t('Photos & videos')} ref={box} tabIndex={-1} onKeyDown={onKeyDown}>
    <div className="mviewer-bar">
      <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark"/></button>
      <span className="mviewer-count" dir="ltr">{at + 1} / {list.length}</span>
      <button type="button" className="iconbtn" aria-label={t('Remove')} onClick={() => setAsking((a?: any) => !a)}><Icon name="trash"/></button>
    </div>
    <div className="mviewer-stage">
      <MediaView key={m.hash} m={m} cls="exmedia viewer" name={rec?.name || ''}/>
    </div>
    {asking && <div className="mviewer-ask">
      <div className="mviewer-ask-t">{t('Remove this photo or video?')}</div>
      <div className="mviewer-ask-b">
        <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>{t('Cancel')}</Button>
        <Button variant="danger" size="sm" onClick={remove}>{t('Remove')}</Button>
      </div>
    </div>}
    {list.length > 1 && !asking && <div className="mviewer-nav">
      <button type="button" className="iconbtn" aria-label={t('Previous')} onClick={() => go(-1)}><Icon name="chevronLeft"/></button>
      <button type="button" className="iconbtn" aria-label={t('Next')} onClick={() => go(1)}><Icon name="chevronRight"/></button>
    </div>}
  </div>;
}

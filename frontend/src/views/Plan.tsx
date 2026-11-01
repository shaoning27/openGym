// Legacy dynamic types are explicit during the full language migration.
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore.ts';
import { useUI } from '../store/useUI.ts';
import { DAYN, DAYS, weekOrder, weekStartOf, uid, exCount, routineCount, todayISO, fmtDate } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { dayAssignSheet, starterPlanSheet, confirmSheet, menuSheet, planHasRoutines, exportPlanFile, printWholePlan, importPlanFile, } from '../sheets.tsx';
import Icon from '../components/Icon.tsx';
import { SeasonDeco } from '../components/Seasonal.tsx';
import { Button, Row, Section, Segmented } from '../components/ui.tsx';
import SwipeRow from '../components/SwipeRow.tsx';
import { copyRoutine, deleteRoutine, restoreRoutine, routineSnapshot } from '../lib/routines.ts';
import MiniBodyMap from '../components/MiniBodyMap.tsx';
import { workoutControls } from '../lib/workout-controls.ts';
import { tappable } from '../lib/use-sheet-keyboard.ts';
import { useListReorder, moved } from '../lib/use-list-reorder.ts';
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.ts';
import { DEMO } from '../lib/demo.ts';
import { MOBILE } from '../lib/mobile.ts';
import { coachAvailable } from '../lib/coach.ts';
import { queueOf, queueView } from '../lib/queue.ts';
import { deriveSessionName } from '../lib/session-merge.ts';
import { markUndone, undoMarks } from '../lib/sync-merge.ts';
import { scheduleModeOf, queueRecovery, rotationIds, saveRotation, startNewPass, startPass, stopPass, chooseRotation, chooseFixedWeek, sequenceOf, isSimpleSequence, segmentAt, REST, } from '../lib/rotation.ts';
// Plan has two views (v1.3.11): Schedule (how you train, and when) and Routines (what you
// train). The last one you looked at comes back: a per-device convenience, never synced, so it
// lives in this browser's storage and not in S.
export const PLAN_VIEW_KEY: any = 'gym_plan_view';
const readView: any = () => {
    try {
        return localStorage.getItem(PLAN_VIEW_KEY) === 'routines' ? 'routines' : 'schedule';
    }
    catch {
        return 'schedule';
    }
};
/* Undo for Plan's two removals (v1.3.11). Both go through the store's normal update, so sync
   sees an ordinary edit (a routine put back clears its own removal stamp, lib/sync-merge.ts). */
/** Deletes a routine with an Undo toast in place of a confirm: the toast puts it back exactly,
 *  list place, weekdays, reschedules and loop included (lib/routines.ts routineSnapshot). */
export function deleteRoutineWithUndo(id?: any) {
    const st: any = useStore.getState();
    const snap: any = routineSnapshot(st.S, id);
    if (!snap)
        return false;
    const before: any = st.S;
    st.update((s?: any) => { deleteRoutine(s, id); });
    // What the removal moved (weekdays, reschedules, the loop), for the Undo to mark as put back:
    // a change another device made to one of them before it saw the removal then still wins.
    snap.marks = undoMarks(before, useStore.getState().S);
    useUI.getState().toast(t('“{0}” gone.', snap.routine.name), { action: t('Undo'), onAction: () => undoDeleteRoutine(snap) });
    return true;
}
export function undoDeleteRoutine(snap?: any) {
    let ok: any = false;
    useStore.getState().update((s?: any) => { ok = restoreRoutine(s, snap); if (ok && snap.marks)
        markUndone(s, snap.marks); });
    // False when a sync brought it back first (another device's Undo, or its later edit).
    if (!ok)
        useUI.getState().toast(t('It’s already back.'));
    return ok;
}
/** Takes a routine out of the loop (the swipe and the edit-mode minus), with an Undo. The removal
 *  is the editor's own (`setSeq`), which may sweep the routine's future pins or roll a finished
 *  round over; so while the loop is still what the removal left, Undo puts the loop, the round and
 *  the swept pins back as they were. Once something else changed the loop, it just slots the
 *  routine back in at its old place, through the same save an edit uses. */
export function takeOutOfLoop(idOrAt?: any, setSeq?: any, seq?: any, label?: any) {
    // By position: a loop may hold a routine twice, or several rest days (#536). An id means its
    // first place, as before.
    const at: any = typeof idOrAt === 'number' ? idOrAt : seq.indexOf(idOrAt);
    if (at < 0 || at >= seq.length)
        return false;
    const id: any = seq[at];
    const before: any = useStore.getState().S;
    const snap: any = structuredClone({ rotation: before.rotation ?? null, queue: before.queue ?? null, dayPlan: before.dayPlan ?? {} });
    setSeq(seq.filter((x?: any, i?: any) => i !== at));
    const after: any = useStore.getState().S;
    const mark: any = loopMark(after);
    const marks: any = undoMarks(before, after);
    const name: any = id === REST ? t('Rest day') : before.routines.find((r?: any) => r.id === id)?.name ?? id;
    useUI.getState().toast(t('“{0}” is out of the loop.', name), { action: t('Undo'), onAction: () => undoTakeOut({ id, at, label, snap, mark, marks }) });
    return true;
}
// What the loop looked like right after a removal: the saved loop, the pass and the mode switch.
const loopMark: any = (S?: any) => JSON.stringify([S.rotation ?? null, S.queue ?? null, S.scheduleMode ?? null]);
export function undoTakeOut({ id, at, label, snap, mark, marks }: any) {
    if (id !== REST && !useStore.getState().S.routines.some((r?: any) => r.id === id)) {
        useUI.getState().toast(t('Too late, that one’s gone'));
        return false;
    }
    useStore.getState().update((s?: any) => {
        if (loopMark(s) === mark) {
            s.rotation = snap.rotation;
            s.queue = snap.queue;
            const pins: any = Object.entries(snap.dayPlan).filter(([iso]: any) => s.dayPlan?.[iso] == null);
            if (pins.length)
                s.dayPlan = { ...(s.dayPlan || {}), ...Object.fromEntries(pins) };
            // Put back exactly: a reorder another device made before it saw the removal still wins.
            if (marks)
                markUndone(s, marks);
            return;
        }
        // Only a loop that is still this app's and still running gets a pass written. After "Fixed
        // week", or with a coach's or planner's queue in charge, a new pass would quietly take over
        // again, so the routine just goes back into the saved loop for the next time it starts.
        const q: any = queueOf(s);
        const ours: any = scheduleModeOf(s) === 'rotation' && (!s.queue || (!!q && !!s.rotation && q.rotationId === s.rotation.id));
        if (!ours) {
            const seq: any = Array.isArray(s.rotation?.sequence) ? s.rotation.sequence : null;
            if (seq && (id === REST || !isSimpleSequence(seq) || !seq.includes(id))) {
                const next: any = seq.slice();
                next.splice(Math.min(at, next.length), 0, id);
                s.rotation = { ...s.rotation, sequence: next };
            }
            return;
        }
        const full: any = sequenceOf(s);
        const looped: any = full.length && !isSimpleSequence(full);
        const ids: any = looped ? full : q?.ids ?? rotationIds(s);
        if (!looped && id !== REST && ids.includes(id))
            return;
        const next: any = ids.slice();
        next.splice(Math.min(at, next.length), 0, id);
        saveRotation(s, next, s.queue?.label || s.rotation?.label || label);
    });
    return true;
}
// The flash a row lands with when a swipe brought it (a duplicate, an undo): one per new value.
let flashSeq: any = 0;
export default function Plan() {
    const nav: any = useNavigate();
    const S: any = useStore((s?: any) => s.S);
    const update: any = useStore((s?: any) => s.update);
    const config: any = useStore((s?: any) => s.config);
    const coachMode: any = useStore((s?: any) => s.coachLocal?.mode);
    const user: any = useStore((s?: any) => s.user);
    const fileRef: any = useRef(null);
    const [view, setViewState]: any = useState(readView);
    const setView: any = (v?: any) => {
        setViewState(v);
        try {
            localStorage.setItem(PLAN_VIEW_KEY, v);
        }
        catch { /* private mode: the view just isn't remembered */ }
    };
    /* The Coach's way in from Plan: its own button in the header (a banner over the week was too
       loud, the last entry of the share menu too hidden). Gated by the same predicate every other
       Coach surface uses, so an instance without the feature sees exactly the header it would have
       without it. */
    const showCoach: any = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode });
    // Share, print, import and starter plans: one menu behind the header button, so the
    // two views below are only about the plan itself.
    const openMenu: any = () => {
        const has: any = planHasRoutines(S);
        menuSheet({
            title: t('Plan'),
            subtitle: has ? null : t('Add an exercise to a routine first. An empty plan has nothing to share.'),
            items: [
                { icon: 'share', label: t('Export plan file'), sub: t('A small file a friend can import into their own openGym. Routines only, none of your workouts or weigh-ins.'), disabled: !has, onClick: exportPlanFile },
                { icon: 'note', label: t('Print / Save as PDF'), disabled: !has, onClick: printWholePlan },
                { icon: 'download', label: t('Import a plan file'), onClick: () => fileRef.current?.click() },
                { icon: 'clipboard', label: t('Load starter plan'), onClick: starterPlanSheet },
            ],
        });
    };
    const pickFile: any = (ev?: any) => { const f: any = ev.target.files[0]; ev.target.value = ''; importPlanFile(f); };
    const mode: any = scheduleModeOf(S);
    return <div className="narrow plan">
    <div className="hdr">
      <SeasonDeco spot="header-bats"/>
      <div><h1>{t('Plan')}</h1><div className="sub">{mode === 'rotation' ? t('Your routines in a loop') : t('Your weekly routine')}</div></div>
      <div className="hdr-actions">
        {showCoach && <Button size="sm" variant="tinted" icon="sparkles" onClick={() => nav('/coach')}>{t('Coach')}</Button>}
        <button className="iconbtn" onClick={openMenu} aria-label={t('Plan options')} title={t('Plan options')}><Icon name="share"/></button>
      </div>
    </div>
    <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} hidden/>
    <Segmented className="plan-views" value={view} onChange={setView} options={[{ value: 'schedule', label: t('Schedule') }, { value: 'routines', label: t('Routines') }]}/>
    {view === 'routines'
            ? <Routines S={S} update={update} nav={nav}/>
            : <Schedule S={S} update={update} nav={nav} mode={mode}/>}
  </div>;
}
/* ================================ Schedule ================================ */
function Schedule({ S, update, nav, mode }: any) {
    const [editLoop, setEditLoop]: any = useState(false);
    /* The rotation editor. What it shows is the live pass when there is one, otherwise the saved
       sequence — S.rotation is only a definition, so the pass is the truth whenever it exists.
       Every edit writes straight through saveRotation: an edit IS the save (and, for a queue
       somebody else wrote, the adoption), so there is no half-edited state to lose. `since` and
       `startsOn` carry over, so progress already logged survives a reorder. */
    const liveQ: any = queueOf(S);
    // A loop with rest days or a routine twice (#536) is edited as the whole saved sequence; its
    // pass is only the running segment of it. A simple loop shows its pass, as it always has.
    const fullSeq: any = sequenceOf(S);
    const ownLoop: any = !liveQ || (!!S.rotation && liveQ.rotationId === S.rotation.id);
    const looped: any = ownLoop && fullSeq.length > 0 && !isSimpleSequence(fullSeq);
    const seq: any = looped ? fullSeq : liveQ?.ids ?? rotationIds(S);
    const seg: any = looped && liveQ ? segmentAt(fullSeq, S.rotation?.at) : null;
    // A loop the app makes has no name of its own: Home shows it as 'Rotation' in the language on
    // screen. Stored as text, it stayed in the language it was made in (QA 2026-10-06).
    const seqLabel: any = liveQ?.label || S.rotation?.label || '';
    // Ownership, not presence: a planner's queue has no rotationId, or one that does not match the
    // saved rotation here — that's what makes it someone else's to write, not this app's.
    const managed: any = !!liveQ && !!S.rotation && liveQ.rotationId === S.rotation.id;
    const external: any = !!liveQ && !managed;
    const recovery: any = queueRecovery(S);
    const qv: any = liveQ ? queueView(S, todayISO()) : null;
    // "How you train" is the same switch as Settings' (lib/rotation.ts chooseRotation /
    // chooseFixedWeek), on the same keys. Leaving a running loop asks first: its progress goes,
    // the loop itself and the weekdays stay. With nothing running there is nothing to lose.
    const setMode: any = (v?: any) => {
        if (v === mode)
            return;
        if (v === 'rotation') {
            update((s?: any) => { chooseRotation(s); });
            return;
        }
        if (!liveQ) {
            update((s?: any) => { chooseFixedWeek(s); });
            return;
        }
        confirmSheet({
            title: t('Back to a fixed week?'),
            message: t('The loop stops. Your weekdays stay as they are, and the loop is saved for later.'),
            confirmText: t('Use Fixed Week'),
            onConfirm: () => update((s?: any) => { chooseFixedWeek(s); }),
        });
    };
    const setSeq: any = (ids?: any) => update((s?: any) => {
        // Emptying the sequence stops the pass but stays on Rotation with an empty loop ('No rotation
        // yet'), so taking out the last routine to swap it for another never throws you onto the
        // weekday grid. Leaving the rotation is the 'How you train' switch's job.
        if (ids.length)
            saveRotation(s, ids, seqLabel);
        else {
            stopPass(s);
            if (s.rotation)
                s.rotation = { ...s.rotation, sequence: [] };
            s.scheduleMode = 'rotation';
        }
    });
    const loopReorder: any = useListReorder(seq.length, (from?: any, to?: any) => setSeq(moved(seq, from, to)));
    const takeOut: any = (at?: any) => takeOutOfLoop(at, setSeq, seq, seqLabel);
    const swipe: any = workoutControls(S).swipeSets && !external;
    // Any routine, also one already in the loop (A → B → C → B), and rest days (#536).
    const addToSeq: any = () => menuSheet({
        title: t('Add to the rotation'),
        items: [
            ...(seq.length ? [{ icon: 'moon', label: t('Rest day'), sub: t('A day off before the next one'), onClick: () => setSeq([...seq, REST]) }] : []),
            ...S.routines.map((r?: any) => ({
                icon: glyphOf(r.emoji), label: r.name, sub: seq.includes(r.id) ? t('Already in the loop: adds it again') : undefined, onClick: () => setSeq([...seq, r.id]),
            })),
        ],
    });
    // The only path from a coach-written queue into a managed one: behind a confirmation that says
    // what happens — the coach gives up control: this app owns the queue and refills it itself, and a
    // later week written by the coach's app simply replaces it (the whole queue object, token and all).
    // The rotation takes a name of its own here rather than the planner's (e.g. "US W1") — that
    // name is this one pass's, and refillAfter would otherwise repeat it on every pass after it.
    // A loop of your own saved here is overwritten by the adoption, so the confirm says so.
    const ownSeq: any = S.rotation?.sequence || [];
    const replacesOwn: any = ownSeq.length > 0 && (ownSeq.length !== seq.length || ownSeq.some((id?: any, i?: any) => id !== seq[i]));
    const adopt: any = () => confirmSheet({
        title: t('Use this rotation?'),
        message: t('Your coach gives up control of this week: openGym owns the queue from here on and repeats these sessions by itself once they are all done. A new week from the coach’s app would replace this rotation.')
            + (replacesOwn ? ' ' + t('Your own loop gets replaced.') : ''),
        confirmText: t('Use this rotation'),
        onConfirm: () => update((s?: any) => saveRotation(s, seq, '')),
    });
    const ws: any = weekStartOf(S);
    const todayDow: any = new Date().getDay();
    const routineOf: any = (id?: any) => S.routines.find((x?: any) => x.id === id);
    const dayRoutines: any = (d?: any) => ([] as any[]).concat(S.week[d] || []).map(routineOf).filter(Boolean);
    // One weekday: what is on it at a glance, and a tap to change it (dayAssignSheet picks one
    // routine, several for a combined day, or a rest day).
    const dayRow: any = (d?: any, rs: any = dayRoutines(d)) => {
        return <div key={d} className="item plan-day" data-day={d} aria-label={t(DAYN[d])} {...tappable(() => dayAssignSheet(d))}>
      <span className={'plan-day-n' + (d === todayDow ? ' today' : '')} aria-hidden="true">{t(DAYS[d])}</span>
      <span className={'lrow-i' + (rs.length ? '' : ' rest')}><Icon name={rs.length ? glyphOf(rs[0].emoji) : 'moon'}/></span>
      <div className="grow">
        <div className="tt">{rs.length ? deriveSessionName(rs.map((r?: any) => r.name)) : t('Rest day')}</div>
        <div className="ss">{rs.length === 1 ? exCount(rs[0].ex.length) : rs.length ? routineCount(rs.length) : t('Tap to plan something')}</div>
      </div>
      {rs.length > 0 && <MiniBodyMap routines={rs} body={S.body}/>}
      <Icon name="chevronRight" className="chev"/>
    </div>;
    };
    // Beside a loop, a weekday shows only what it adds to it: a routine that is in the loop already
    // is the loop's session, the same rule Home follows (effectiveRoutineIds, history.ts).
    const extraRoutines: any = (d?: any) => dayRoutines(d).filter((r?: any) => !seq.includes(r.id));
    const plannedDays: any = weekOrder(ws).filter((d?: any) => extraRoutines(d).length);
    const doneCount: any = qv ? qv.items.filter((i?: any) => i.state === 'done').length : 0;
    const stateWord: any = (item?: any) => item.state === 'pinned' ? fmtDate(item.on, true)
        : ({ done: t('Done'), next: t('Up next'), later: t('Later') } as any)[item.state];
    const editing: any = editLoop && !external;
    return <>
    <Section className="plan-mode" footer={mode === 'rotation'
            ? t('Routines in a loop. Whatever is next stays next until you train it, whatever the day.')
            : t('The same routines on the same weekdays, every week.')}>
      <Row icon="repeat" iconTint="var(--orange)" title={t('How you train')}>
        {/* A planner's own queue is not this app's to switch off: text, not a control. */}
        {external
            ? <span className="small dim plan-mode-locked">{t('Rotation')} · {t('Externally managed')}</span>
            : <Segmented className="seg-inline" value={mode} onChange={setMode} options={[{ value: 'week', label: t('Fixed Week') }, { value: 'rotation', label: t('Rotation') }]}/>}
      </Row>
      {/* a cobweb in the card's empty top corner, in season (components/Seasonal.tsx) */}
      <SeasonDeco spot="plan-card"/>
    </Section>

    {!S.routines.length && <div className="empty plan-empty">
      <div className="ico"><Icon name="clipboard"/></div>{t('No routines yet.')}<br />{t('Make one, or grab the starter plan to get going.')}
      <div style={{ marginTop: 12 }}><Button icon="clipboard" onClick={starterPlanSheet}>{t('Load starter plan')}</Button></div>
    </div>}

    {/* A queue payload that arrived unusable: a fix-up, shown whichever way you train. Giving it
            up also gives up S.scheduleMode='rotation', or the loop would sit there with no queue. */}
    {recovery && <div className="empty">
      {t('This rotation couldn’t be read. Another device may have written it.')}
      <div style={{ marginTop: 10 }}>
        <Button size="sm" variant="tinted" aria-label={t('Discard it')} onClick={() => update((s?: any) => { s.queue = null; s.scheduleMode = 'week'; })}>{t('Discard it')}</Button>
      </div>
    </div>}

    {mode === 'week' ? <>
      <h4 className="sec">{t('This week')}</h4>
      <div className="list plan-week">{weekOrder(ws).map((d?: any) => dayRow(d))}</div>
      <p className="sect-f">{t('Want two routines on one day? Tap the day and pick both.')}</p>
    </> : <div className="rotation">
      <div className="row between plan-sec-h">
        <h4 className="sec">{t('The loop')}{external && <span className="tag" style={{ marginInlineStart: 8 }}>{t('Externally managed')}</span>}</h4>
        {/* A coach's own queue is read-only here: the one way to change what it holds is to
                adopt it first ("Use this rotation" below), never a tap on one of its rows. */}
        {!external && <div className="row plan-sec-acts" style={{ gap: 6 }}>
          {seq.length > 0 && <button className="plan-textbtn" aria-pressed={editLoop} onClick={() => setEditLoop((e?: any) => !e)}>{editLoop ? t('Done') : t('Edit')}</button>}
          <Button size="sm" variant="tinted" icon="plus" aria-label={t('Add routine to the rotation')} disabled={!S.routines.length} onClick={addToSeq}>{t('Add')}</Button>
        </div>}
      </div>
      {seq.length ? <div className="list plan-loop" ref={loopReorder.listRef}>
        {seq.map((id?: any, i?: any) => {
                    const rest: any = id === REST;
                    const r: any = rest ? null : routineOf(id);
                    // In a loop with rests or repeats the pass is the running segment: only its rows have
                    // a state, the rest of the loop is still ahead.
                    const item: any = seg ? (i >= seg.start && i < seg.start + seg.ids.length ? qv?.items[i - seg.start] : null) : qv?.items[i];
                    const key: any = looped ? i + ':' + id : id;
                    // The loop's swipe is remove-only (v1.3.11): a routine is in the loop once, so there is
                    // nothing to copy. The row the reorder measures is the swipe's outer element.
                    const reorderProps: any = { 'data-reorder-row': '', style: loopReorder.rowStyle(i) };
                    const name: any = rest ? t('Rest day') : r?.name ?? id;
                    const row: any = <div key={swipe ? undefined : key} {...(swipe ? {} : reorderProps)} className={'item rotation-row' + (item?.state === 'done' ? ' is-done' : '') + (rest ? ' is-rest' : '')}>
            {editing && <button className="plan-minus" aria-label={t('Remove {0}', name)} title={t('Remove')} onClick={() => takeOut(i)}><Icon name="minus"/></button>}
            <span className={'plan-order' + (item?.state === 'next' ? ' next' : '')}>{item?.state === 'done' ? <Icon name="check"/> : i + 1}</span>
            <span className={'lrow-i' + (rest ? ' rest' : '')}><Icon name={rest ? 'moon' : glyphOf(r?.emoji)}/></span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="tt">{name}</div>
              <div className="ss">{item ? stateWord(item) : rest ? t('A day off before the next one') : r ? exCount(r.ex.length) : ''}</div>
            </div>
            {r && !rest && !editing && <MiniBodyMap routines={[r]} body={S.body}/>}
            {editing && seq.length > 1 && <button className="plan-handle" aria-label={t('Move {0}', name)} title={t('Drag to reorder')} {...loopReorder.handle(i)}><Icon name="chevronsUpDown"/></button>}
          </div>;
                    return swipe
                        ? <SwipeRow key={key} {...reorderProps} className="swrow-item" deleteLabel={t('Remove')} deleteIcon="minus" onDelete={() => takeOut(i)}>{row}</SwipeRow>
                        : row;
                })}
      </div> : <div className="empty">{t('No rotation yet. Add routines in the order you want to train them. The first one you haven’t logged stays up next.')}</div>}
      {seq.length > 0 && <p className="sect-f">
        {qv ? (qv.waiting ? (looped ? t('Rest day. The loop goes on {0}.', fmtDate(qv.startsOn, true)) : t('Next round starts {0}.', fmtDate(qv.startsOn, true))) : t('{0} of {1} done this round.', doneCount, qv.items.length)) + ' ' : ''}
        {external ? '' : editing ? t('Drag to reorder. Tap the minus to take one out.') : t('Trained out of order? Just pick another routine on Home.')}
      </p>}
      <div className="row" style={{ gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        {external && <Button size="sm" variant="tinted" aria-label={t('Use this rotation')} onClick={adopt}>{t('Use this rotation')}</Button>}
        {/* Throws the current round away and starts the saved loop again today; nothing logged
                before this moment counts for it (startNewPass, the strict pass). */}
        {!!liveQ && !external && <Button size="sm" icon="reset" aria-label={t('Start the loop over')} onClick={() => update((s?: any) => startNewPass(s))}>{t('Start the loop over')}</Button>}
        {/* Rotation chosen and a loop saved, but no round running (it was stopped elsewhere). */}
        {!liveQ && !recovery && seq.length > 0 && <Button size="sm" variant="tinted" icon="play" aria-label={t('Start the loop')} onClick={() => update((s?: any) => startPass(s))}>{t('Start the loop')}</Button>}
      </div>
      {/* The weekday routines ride along beside a loop (effectiveRoutineIds, history.ts) and feed
                the same tally (weekTally, queue.ts), so the days that still add one stay in sight; a
                day whose only routines are in the loop already adds nothing and is left out. */}
      {plannedDays.length > 0 && <>
        <h4 className="sec">{t('Also on fixed days')}</h4>
        <div className="list plan-week">{plannedDays.map((d?: any) => dayRow(d, extraRoutines(d)))}</div>
        <p className="sect-f">{t('These count on top of the loop. Tap a day to change or clear it.')}</p>
      </>}
    </div>}

    {/* Weekly muscle volume is analysis: it moved to Stats, next to Muscle balance. Stats only
            shows that card once there is a routine, so the link waits for one too. */}
    {S.routines.length > 0 && <Section className="plan-link">
      <Row icon="chart" iconTint="var(--indigo)" title={t('Weekly muscle volume')} subtitle={t('Now in Stats, next to Muscle balance')} accessory="chevron" onClick={() => nav('/stats?focus=weekly-volume')}/>
    </Section>}
  </>;
}
/* ================================ Routines ================================ */
function Routines({ S, update, nav }: any) {
    const [edit, setEdit]: any = useState(false);
    const [flash, setFlash]: any = useState(null);
    const swipe: any = workoutControls(S).swipeSets;
    const routines: any = S.routines;
    // The order of this list is the order of `S.routines`, and every other screen reads the same
    // array (the Start screen, the day sheets, the routine pickers), so moving a routine here moves
    // it everywhere (#142). Reordering lives behind Edit, like on an iPhone.
    const reorder: any = useListReorder(routines.length, (from?: any, to?: any) => update((s?: any) => {
        if (to < 0 || to >= s.routines.length)
            return;
        const [m]: any = s.routines.splice(from, 1);
        s.routines.splice(to, 0, m);
    }));
    const addRoutine: any = () => {
        const r: any = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] };
        update((s?: any) => { s.routines.push(r); });
        nav('/plan/r/' + r.id);
    };
    // The same delete as RoutineEdit's "Delete routine" button (lib/routines.ts), with an Undo in
    // place of its confirm (v1.3.11): the swipe and the edit-mode minus both land here.
    const remove: any = (r?: any) => deleteRoutineWithUndo(r.id);
    // The swipe's other side: a copy right below the original, named the way "Copy routine" names
    // one, and staying on this list rather than opening it.
    const duplicate: any = (r?: any) => {
        const copy: any = copyRoutine(r, t('Copy'));
        update((s?: any) => {
            const at: any = s.routines.findIndex((x?: any) => x.id === r.id);
            s.routines.splice(at < 0 ? s.routines.length : at + 1, 0, copy);
        });
        setFlash({ id: copy.id, n: ++flashSeq });
        // With its own Undo: the toast takes the place of any Undo still showing (one toast at a
        // time), so the newest swipe is at least the one you can take back.
        useUI.getState().toast(t('Copied as “{0}”.', copy.name), { action: t('Undo'), onAction: () => {
                update((s?: any) => { if (s.routines.some((x?: any) => x.id === copy.id))
                    deleteRoutine(s, copy.id); });
            } });
    };
    // The weekdays a routine is on, short, in the order the week runs.
    const order: any = weekOrder(weekStartOf(S));
    const daysOf: any = (id?: any) => order.filter((d?: any) => ([] as any[]).concat(S.week[d] || []).includes((id as any))).map((d?: any) => t(DAYS[d]));
    const sub: any = (r?: any) => [exCount(r.ex.length), daysOf(r.id).join(', ')].filter(Boolean).join(' · ');
    return <>
    <div className="row between plan-sec-h plan-routines-bar">
      {routines.length > 0
            ? <button className="plan-textbtn" aria-pressed={edit} onClick={() => setEdit((e?: any) => !e)}>{edit ? t('Done') : t('Edit')}</button>
            : <span />}
      <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New routine')}</Button>
    </div>
    {routines.length ? <>
      {edit
                ? <div className="list routine-list plan-routines is-editing" ref={reorder.listRef}>{routines.map((r?: any, i?: any) => <div key={r.id} data-reorder-row className="item plan-routine" style={reorder.rowStyle(i)}>
            <button className="plan-minus" aria-label={t('Delete {0}', r.name)} title={t('Delete routine')} onClick={() => remove(r)}><Icon name="minus"/></button>
            <span className="lrow-i"><Icon name={glyphOf(r.emoji)}/></span>
            <div className="grow"><div className="tt">{r.name}</div><div className="ss">{sub(r)}</div></div>
            {routines.length > 1 && <button className="plan-handle" aria-label={t('Move {0}', r.name)} title={t('Drag to reorder')} {...reorder.handle(i)}><Icon name="chevronsUpDown"/></button>}
          </div>)}</div>
                : <div className="list routine-list plan-routines">{routines.map((r?: any) => {
                        const row: any = <div key={r.id} className="item plan-routine" {...tappable(() => nav('/plan/r/' + r.id))}>
            <span className="lrow-i"><Icon name={glyphOf(r.emoji)}/></span>
            <div className="grow"><div className="tt">{r.name}</div><div className="ss">{sub(r)}</div></div>
            <MiniBodyMap routines={[r]} body={S.body}/>
            <Icon name="chevronRight" className="chev"/></div>;
                        // Swipe (v1.3.11, Settings → Swipe actions): toward the start deletes with an Undo,
                        // toward the end duplicates. Edit's minus and the routine's own page stay the way in
                        // for a keyboard and a screen reader.
                        return swipe
                            ? <SwipeRow key={r.id} className="swrow-item" copyLabel={t('Duplicate')} onDelete={() => remove(r)} onCopy={() => duplicate(r)} flash={flash?.id === r.id ? flash.n : 0}>{row}</SwipeRow>
                            : row;
                    })}</div>}
      <p className="sect-f">{edit ? t('Drag to reorder. Tap the minus to delete.') : t('Tap a routine to edit it. Reorder and delete are behind Edit.')}</p>
    </> : <>
      <div className="empty"><div className="ico"><Icon name="clipboard"/></div>{t('No routines yet.')}<br />{t('Make one, or grab the starter plan to get going.')}</div>
      <Button icon="clipboard" onClick={starterPlanSheet}>{t('Load starter plan')}</Button>
    </>}
  </>;
}

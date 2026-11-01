// Legacy dynamic types are explicit during the full language migration.
// The conversation with the Coach.
//
// Everything the Coach does happens here: your answers as the opening message, a typing
// bubble while a job runs (with how long it usually takes), the plan or the suggestions as a
// card you page through, a composer to say what to change, and one button that imports the
// result. History stays in the thread — come back any time, ask for a review, refine again.
//
// The thread is `S.coach.chat` (small, synced) plus whatever is live right now from the
// status poll: a running job or a pending proposal. Nothing about the proposal is copied into
// the chat until a decision is made about it, so two devices can never disagree on what is
// pending. Once decided, the chat line carries a `ref` into `S.coach.log`, where the whole
// proposal — every change, accepted or not, the notes, the evidence — is kept, so saying yes
// or no never makes it disappear. Turning the Coach off is the admin's decision, not a control
// on this screen.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { closeThenNav } from '../lib/nav.ts';
import { useStore } from '../store/useStore.ts';
import { useUI } from '../store/useUI.ts';
import { t, tn } from '../lib/i18n.ts';
import { fmtDate, fmtNum, DAYS, weekOrder, weekStartOf, isoOf } from '../lib/format.ts';
import { exLine } from '../lib/history.ts';
import { speedUnitOf } from '../lib/speed.ts';
import { DEMO } from '../lib/demo.ts';
import { MOBILE } from '../lib/mobile.ts';
import { scheduleModeOf } from '../lib/rotation.ts';
import ChatInput from '../components/ChatInput.tsx';
import { coachAvailable, hasConsent, emptyCoach, appendChat, recordTiming, estimateMs, profileLines, markStale, applicable, applyChangeSet, applyCreatedPlan, recordDismissal, recordDebrief, logEntry, changeTitle, changeValues, exName, canRevert, revertLast } from '../lib/coach.ts';
import { insightsFor, sessionInsights } from '../lib/coach-insights.ts';
import { useCoachStatus, requestReview, requestDebrief, requestPlan, refinePlan, askCoach, resolvePending, cohortStats, setCohortShare, jobErrorText, awaitedJob, settleAwaited, JOB_ERRORS, ensureAiConsent, isDeclined } from '../lib/coach-api.ts';
import { AiConsentSection } from '../components/CoachConsentSheet.tsx';
import { useCoachGate } from '../lib/use-coach-gate.ts';
import { confirmSheet } from '../sheets.tsx';
import Icon from '../components/Icon.tsx';
import { glyphOf } from '../lib/glyphs.ts';
import LineChart from '../components/LineChart.tsx';
import { Button, Check, Switch, Section, Row, SelectRow } from '../components/ui.tsx';
import '../coach.css';
export default function CoachChat() {
    const nav: any = useNavigate();
    const S: any = useStore((s?: any) => s.S);
    const user: any = useStore((s?: any) => s.user);
    const config: any = useStore((s?: any) => s.config);
    const coachLocal: any = useStore((s?: any) => s.coachLocal);
    const update: any = useStore((s?: any) => s.update);
    const storeReady: any = useStore((s?: any) => s.ready);
    const toast: any = useUI((s?: any) => s.toast);
    const openSheet: any = useUI((s?: any) => s.openSheet);
    const { job, pending, cap, loading, lastError, last, refresh, maxMessageLen }: any = useCoachStatus(true);
    const [text, setText]: any = useState('');
    // The message box opened into a tall editor (components/ChatInput.tsx); closed again on send.
    const [expanded, setExpanded]: any = useState(false);
    const [busy, setBusy]: any = useState(false);
    const endRef: any = useRef(null);
    const prevJob: any = useRef(null);
    const coachMode: any = coachLocal?.mode;
    const gate: any = useCoachGate();
    const ok: any = gate.ok;
    const ready: any = ok && hasConsent(S) && !!S.coach?.profile;
    // Not before the store has loaded: a cold start straight on #/coach would otherwise read an
    // empty state, decide there is no consent, and bounce a consenting user into the intake. Nor
    // before the server said for this session whether it has a Coach (lib/use-coach-gate.ts).
    useEffect(() => {
        if (!storeReady || !gate.known)
            return;
        if (!ok)
            nav('/home', { replace: true });
        else if (!ready)
            nav('/coach/intake', { replace: true });
    }, [storeReady, gate.known, ok, ready]);
    // A job that ends is either a proposal, "nothing to change", or a failure. The server tells
    // the client none of that directly — the job simply stops appearing — so the transition is
    // read here, once, and written into the thread as the Coach's reply. Two ways to see it end:
    // the job was seen running and is now gone, or the run this app started (its id came back
    // from the start request) is already the server's last outcome — a provider that refuses the
    // connection fails the run before the first status poll, and it is never seen running at all.
    useEffect(() => {
        if (loading)
            return;
        const was: any = prevJob.current;
        prevJob.current = job;
        if (job)
            return;
        const mine: any = awaitedJob();
        const endedUnseen: any = !was && !!mine && last?.id === mine;
        if (!was && !endedUnseen)
            return;
        settleAwaited(was ? was.id : mine);
        const ms: any = was?.startedAt ? Date.now() - was.startedAt : 0;
        update((s?: any) => {
            // A run that ended unseen has no duration worth learning from.
            if (was)
                recordTiming(s, ms);
            // A proposal already applied or discarded was settled on another device (#779): its reply is
            // in that device's thread, which syncs here. "Nothing I would change" would be wrong.
            const settled: any = last?.outcome === 'applied' || last?.outcome === 'dismissed' || last?.outcome === 'ready';
            if (!pending && !settled) {
                const cls: any = lastError?.errorClass || (last?.outcome === 'failed' ? (last.errorClass || 'internal') : null);
                appendChat(s, cls
                    ? { role: 'coach', kind: 'error', text: jobErrorText(cls, lastError?.detail) }
                    : { role: 'coach', kind: 'nochange', text: last?.reading
                            ? last.reading
                            : t('I looked through everything and there is nothing I would change right now. Keep it up, and ask me again after a few more sessions.') });
            }
        });
    }, [job, pending, loading, last?.id]);
    // An answer to a question (an `ask` job) has nothing to decide: it goes into the thread as the
    // Coach's reply, once — `pid` names the job it answers, so a second render or a poll that still
    // shows it pending cannot write it twice — and the server is told it was read.
    useEffect(() => {
        if (!pending || pending.kind !== 'ask' || job)
            return;
        update((s?: any) => {
            if ((s.coach?.chat || []).some((m?: any) => m.pid === pending.id))
                return;
            appendChat(s, { role: 'coach', kind: 'text', text: String(pending.answer || ''), pid: pending.id });
        });
        resolvePending({ accepted: ['ask'] }).catch(() => { }).finally(() => refresh());
    }, [pending?.id, !!job]);
    useEffect(() => { if (typeof endRef.current?.scrollIntoView === 'function')
        endRef.current.scrollIntoView({ block: 'end' }); }, [S.coach?.chat?.length, !!job, !!pending]);
    if (!ready)
        return null;
    const coach: any = S.coach || emptyCoach();
    const community: any = !!config?.coach?.community && !DEMO && !(MOBILE && coachMode === 'byok');
    const send: any = async () => {
        const msg: any = text.trim();
        if (!msg || busy)
            return;
        setBusy(true);
        try {
            // A message about a proposed plan refines it. With no plan at all — the first attempt
            // failed, or nothing was ever built — the message asks for one; a review would only
            // answer that there is no workout to look at, which is how people got stuck. Anything else
            // is a question, answered in words (`ask`): "how long should I rest?" is not a request to
            // review the whole plan. A review is the chip and the menu's, as it always was.
            if (pending?.kind === 'create' || !(S.routines || []).length)
                await refinePlan(msg);
            else
                await askCoach(msg);
            update((s?: any) => appendChat(s, { role: 'user', kind: 'text', text: msg }));
            setText('');
            setExpanded(false);
            refresh();
        }
        catch (e: any) {
            // A server that refuses the job says so in English, with its class beside it: the class
            // picks the translated line. One with no line here ('shared') keeps the server's words.
            // "Not now" on the data-sharing question is an answer, not a failure: the text stays put.
            if (!isDeclined(e))
                toast(JOB_ERRORS[e.data?.code] || e.message || t('Could not ask the Coach'));
        }
        setBusy(false);
    };
    const ask: any = async (fn?: any, line?: any) => {
        setBusy(true);
        try {
            await fn();
            update((s?: any) => appendChat(s, { role: 'user', kind: 'text', text: line }));
            refresh();
        }
        catch (e: any) {
            if (!isDeclined(e))
                toast(JOB_ERRORS[e.data?.code] || e.message || t('Could not ask the Coach'));
        }
        setBusy(false);
    };
    const askReview: any = () => ask(() => requestReview(''), t('Have a look at my training and tell me what you would change.'));
    const lastWorkout: any = (S.workouts || []).filter((w?: any) => w && w.d).at(-1) || null;
    const askDebrief: any = () => ask(() => requestDebrief(lastWorkout?.id || null), lastWorkout?.name
        ? t('How did my {0} session go?', lastWorkout.name)
        : t('How did my last workout go?'));
    const askNewPlan: any = () => ask(() => requestPlan(coach.profile), t('Build me a fresh plan from my answers.'));
    const askImprove: any = (r?: any) => ask(() => requestReview(t('Focus only on my routine “{0}”. Improve it: exercise choice, order, sets and reps, rep ranges, progression. Leave the other routines alone.', r.name)), t('Improve my routine “{0}”.', r.name));
    const pickRoutine: any = () => openSheet((close?: any) => <div className="chat-menu">
    <h3>{t('Improve which routine?')}</h3>
    <div className="sect-b">
      {(S.routines || []).map((r?: any) => <Row key={r.id} icon={glyphOf(r.emoji)} iconTint="var(--acc)" title={r.name} subtitle={tn('{0} exercise', '{0} exercises', (r.ex || []).length)} accessory="chevron" onClick={() => { close(); askImprove(r); }}/>)}
      {!(S.routines || []).length && <div className="chat-empty">{t('You don’t have any routines yet. Ask the Coach for a plan first.')}</div>}
    </div>
    <div style={{ height: 10 }}/>
  </div>);
    const showHistory: any = () => openSheet((close?: any) => <HistorySheet S={S} close={close} openSheet={openSheet}/>);
    const showCohort: any = () => openSheet(() => <CohortSheet S={S} update={update} toast={toast}/>);
    const idle: any = !job && !pending;
    const menu: any = () => openSheet((close?: any) => <div className="chat-menu">
    <h3>{t('Coach')}</h3>
    <div className="sect-b">
      {idle && <Row icon="sparkles" iconTint="var(--acc)" title={t('Ask for a review')} subtitle={t('What would the Coach change after your last sessions?')} accessory="chevron" onClick={() => { close(); askReview(); }}/>}
      {idle && !!lastWorkout && <Row icon="checkCircle" iconTint="var(--green)" title={t('Review my last workout')} subtitle={t('What went well, what to watch, what to do next time')} accessory="chevron" onClick={() => { close(); askDebrief(); }}/>}
      {idle && !!(S.routines || []).length && <Row icon="wrench" iconTint="var(--orange)" title={t('Improve a routine')} subtitle={t('Pick one; the Coach works on just that')} accessory="chevron" onClick={() => { close(); pickRoutine(); }}/>}
      {community && <Row icon="person" iconTint="var(--teal)" title={t('Compare with others here')} subtitle={t('Anonymous medians from this instance')} accessory="chevron" onClick={() => { close(); showCohort(); }}/>}
      <Row icon="history" iconTint="var(--blue)" title={t('Everything the Coach proposed')} subtitle={t('Plans, suggestions and debriefs, kept')} accessory="chevron" onClick={() => { close(); showHistory(); }}/>
      {idle && <Row icon="clipboard" iconTint="var(--indigo)" title={t('Start a new plan')} subtitle={t('A fresh plan from your answers; your workouts stay')} accessory="chevron" onClick={() => { close(); askNewPlan(); }}/>}
      <Row icon="pencil" iconTint="var(--indigo)" title={t('Edit my answers')} subtitle={t('Goal, days, equipment, limits')} accessory="chevron" onClick={() => closeThenNav(close, '/coach/intake?edit=1')}/>
      <Row icon="clock" iconTint="var(--purple)" title={t('Automatic reviews')} subtitle={cadenceLabel(coach)} accessory="chevron" onClick={() => { close(); cadenceSheet(openSheet, update); }}/>
      {!DEMO && <Row icon="shield" iconTint="var(--green)" title={t('AI data sharing')} subtitle={t('Who may see your training')} accessory="chevron" onClick={() => { close(); openSheet(() => <div className="chat-menu"><AiConsentSection /></div>); }}/>}
      {canRevert(S) && <Row icon="reset" iconTint="var(--blue)" title={t('Undo the last Coach changes')} accessory="chevron" onClick={() => { close(); doRevert(); }}/>}
    </div>
    <div style={{ height: 10 }}/>
  </div>);
    const doRevert: any = () => confirmSheet({
        title: t('Undo the last Coach changes?'),
        message: t('Your plan goes back to how it was before you accepted them. Workouts you have logged since are untouched.'),
        confirmText: t('Undo'),
        onConfirm: () => {
            let ok: any = false;
            update((s?: any) => { ok = revertLast(s); if (ok)
                appendChat(s, { role: 'coach', kind: 'reverted', text: t('Done! Your plan is back to how it was before my last changes.') }); });
            toast(ok ? t('Plan restored') : t('Nothing to undo'));
        }
    });
    const status: any = job || pending?.kind === 'ask' ? t('thinking…') : pending ? t('has a suggestion for you') : t('here when you need it');
    const placeholder: any = pending?.kind === 'create'
        ? t('What should change?')
        : job ? t('Coach is thinking…') : t('Message the Coach…');
    return <div className="narrow chat">
    <div className="chat-hdr">
      <button className="iconbtn" data-back="/plan" onClick={() => nav('/plan')} aria-label={t('Back')}><Icon name="chevronLeft"/></button>
      <div className="chat-av"><Icon name="sparkles"/></div>
      <div className="grow">
        <h1>{t('Coach')}</h1>
        <div className={'chat-st' + (job ? ' live' : '')}>{status}</div>
      </div>
      <button className="iconbtn" onClick={menu} aria-label={t('More')}><Icon name="more"/></button>
    </div>

    <div className="msgs">
      <Bubble role="coach">{t('Hi, I’m your Coach. I build your plan from your answers and adjust it from what you actually log. Nothing changes until you say so.')}</Bubble>

      {(coach.chat || []).map((m?: any) => <Message key={m.id} m={m} S={S} profile={coach.profile} openSheet={openSheet}/>)}

      {job && <Typing S={S} kind={job.kind} coachLocal={coachLocal} config={config}/>}

      {pending && !job && pending.kind !== 'ask' && (pending.kind === 'create'
            ? <PlanCard p={pending} S={S} update={update} toast={toast} nav={nav} refresh={refresh}/>
            : pending.kind === 'debrief'
                ? <DebriefCard p={pending} S={S} update={update} toast={toast} refresh={refresh}/>
                : <ReviewCard p={pending} S={S} update={update} toast={toast} refresh={refresh}/>)}

      <div ref={endRef}/>
    </div>

    <div className="composer">
      {idle && !busy && <div className="chips-row">
        <button className="qchip" onClick={askReview}><Icon name="sparkles"/>{t('Review my training')}</button>
        {!!lastWorkout && <button className="qchip" onClick={askDebrief}><Icon name="checkCircle"/>{t('Last workout')}</button>}
        {!!(S.routines || []).length && <button className="qchip" onClick={pickRoutine}><Icon name="wrench"/>{t('Improve a routine')}</button>}
        {community && <button className="qchip" onClick={showCohort}><Icon name="person"/>{t('Compare')}</button>}
      </div>}
      <div className={'composer-in' + (expanded ? ' tall' : '')}>
        <ChatInput value={text} onChange={setText} onSend={send} placeholder={placeholder} disabled={!!job} maxLength={maxMessageLen || 1000} expanded={expanded} setExpanded={setExpanded}/>
        <button className="send" onClick={send} disabled={!text.trim() || busy || !!job} aria-label={t('Send')}><Icon name="arrowUp"/></button>
      </div>
      {cap?.limit > 0 && <div className="composer-cap">{t('{0} of {1} Coach runs used today', cap.used, cap.limit)}</div>}
    </div>
  </div>;
}
/* ---------------------------------- bubbles ---------------------------------- */
function Bubble({ role, kind, at, children }: any) {
    const cls: any = kind === 'error' ? ' err' : '';
    return <div className={'msg ' + role}>
    <div className={'bub' + cls}>{children}</div>
    {at && <div className="msg-t">{stamp(at)}</div>}
  </div>;
}
function Message({ m, S, profile, openSheet }: any) {
    if (m.kind === 'intake') {
        const lines: any = profileLines(profile);
        return <Bubble role="user" at={m.at}>
      {t('Here is what I am working with:')}
      <ul>{lines.map((l?: any, i?: any) => <li key={i}>{l}</li>)}</ul>
    </Bubble>;
    }
    if (m.kind === 'applied' || m.kind === 'dismissed' || m.kind === 'debrief') {
        const entry: any = m.ref ? logEntry(S, m.ref) : null;
        return <div className="msg coach" style={entry ? { maxWidth: '100%', width: '100%' } : undefined}>
      {!!m.text && <div className="bub">{m.text}</div>}
      {entry && <Recap entry={entry} S={S} openSheet={openSheet}/>}
      {m.at && <div className="msg-t">{stamp(m.at)}</div>}
    </div>;
    }
    if (m.kind === 'reverted' || m.kind === 'nochange' || m.kind === 'error' || m.kind === 'text') {
        return <Bubble role={m.role} kind={m.kind} at={m.at}>{m.text}</Bubble>;
    }
    return null;
}
const stamp: any = (at?: any) => {
    const d: any = new Date(at);
    const today: any = new Date();
    const time: any = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === today.toDateString() ? time : fmtDate(isoOf(d)) + ' · ' + time;
};
function Typing({ S, kind, coachLocal, config }: any) {
    const ms: any = estimateMs(S);
    // "Local" on either side: the phone's own OpenAI-compatible endpoint, or the server's —
    // /api/config names the provider, and a model on the owner's box is nothing like a cloud API.
    const local: any = (coachLocal?.mode === 'byok' && coachLocal?.provider === 'compatible') || config?.coach?.provider === 'compatible';
    let eta: any;
    if (ms) {
        const min: any = Math.round(ms / 60000);
        eta = min < 1 ? t('Usually under a minute.') : t('Usually about {0} min.', min);
    }
    else {
        // Until a job has been measured, "a minute or two" is a cloud number — say nothing for a
        // local model rather than something wrong; the next line already warns it takes longer.
        eta = local ? '' : t('This usually takes a minute or two.');
    }
    const doing: any = kind === 'create' ? t('Building your plan…') : kind === 'debrief' ? t('Looking at that session…') : kind === 'ask' ? t('Thinking about your question…') : t('Reading your training…');
    return <div className="msg coach">
    <div className="bub typing"><i /><i /><i /></div>
    <div className="typing-eta">
      {doing} {eta}
      {local ? ' ' + t('A local model can take longer.') : ''}
      {' ' + t('Feel free to leave, it keeps going.')}
    </div>
  </div>;
}
/* ---------------------------------- the plan ---------------------------------- */
function PlanCard({ p, S, update, toast, nav, refresh }: any) {
    const b: any = p.bundle;
    const [tab, setTab]: any = useState(0);
    const [schedule, setSchedule]: any = useState(true);
    const r: any = b.routines[Math.min(tab, b.routines.length - 1)];
    const weekDays: any = useMemo(() => new Set(Object.keys(b.week || {}).map(Number)), [b]);
    const accept: any = () => {
        try {
            let n: any = 0;
            update((s?: any) => {
                const res: any = applyCreatedPlan(s, p, { schedule });
                n = res?.routines?.length || b.routines.length;
                appendChat(s, { role: 'coach', kind: 'applied', ref: res.logId, text: res.rotation
                        ? t('Imported! {0} routines are in your plan and your rotation starts over with them. See you at the next session.', n)
                        : schedule
                            ? t('Imported! {0} routines are in your plan and your week is set. See you at the next session.', n)
                            : t('Imported! {0} routines are in your plan. Your week is unchanged; schedule them whenever you like.', n) });
            });
            resolvePending({ accepted: ['plan'] }).catch(() => { });
            toast(t('Your plan is live'));
            refresh();
        }
        catch (e: any) {
            toast(e.message || t('That proposal can’t be read.'));
        }
    };
    const discard: any = () => confirmSheet({
        title: t('Discard this plan?'), message: t('Nothing is saved, and you can ask again anytime.'),
        confirmText: t('Discard'), danger: true,
        onConfirm: () => {
            update((s?: any) => { const ref: any = recordDismissal(s, p); appendChat(s, { role: 'coach', kind: 'dismissed', ref, text: t('Discarded. Tell me what was off and I will build a different one.') }); });
            resolvePending({ dismissed: true }).catch(() => { });
            refresh();
        }
    });
    return <div className="msg coach" style={{ maxWidth: '100%', width: '100%' }}>
    <div className="pcard">
      <div className="pcard-hd">
        <div className="pcard-eyebrow">{p.iteration > 1 ? t('Revision {0}', p.iteration) : t('Your plan')}</div>
        <h2 className="pcard-h">{b.name || t('Coach plan')}</h2>
        {!!b.summary && <p className="pcard-sum">{b.summary}</p>}
        {!!b.basedOn && <p className="pcard-sum" style={{ fontSize: 13 }}>{b.basedOn}</p>}
      </div>

      <WeekStrip days={weekDays} ws={weekStartOf(S)}/>

      {b.routines.length > 1 && <div className="pcard-tabs">
        {b.routines.map((x?: any, i?: any) => <button key={x.id || i} className={'pcard-tab' + (i === tab ? ' on' : '')} onClick={() => setTab(i)}><Icon name={glyphOf(x.emoji)}/>{x.name}</button>)}
      </div>}

      {r && <RoutineBlock r={r} unit={S.unit} speedUnit={speedUnitOf(S)}/>}

      <div className="pcard-row">
        {/* In rotation mode the plan goes into the loop, which is what Home reads (#778). */}
        {scheduleModeOf(S) === 'rotation'
            ? <span className="lrow-m"><span className="lrow-t">{t('Use this plan in your rotation')}</span><span className="lrow-s">{t('Replaces the sessions in your rotation and starts it over with the first one.')}</span></span>
            : <span className="lrow-m"><span className="lrow-t">{t('Use this weekly schedule')}</span><span className="lrow-s">{t('Replaces your current week. Days this plan leaves empty become rest days.')}</span></span>}
        <Switch checked={schedule} onChange={setSchedule}/>
      </div>
      <div className="pcard-note">{t('The Coach is not a doctor or a physiotherapist. If something hurts, ask a professional.')}</div>
      <div className="pcard-ft">
        <Button variant="primary" icon="download" onClick={accept}>{t('Import this plan')}</Button>
        <Button onClick={discard}>{t('Discard')}</Button>
      </div>
    </div>
    <div className="msg-t">{t('Not quite right? Say what to change below and I will revise the whole plan.')}</div>
  </div>;
}
// In the order the week is set to start on (Settings), like the Plan's own week.
const WeekStrip: any = ({ days, ws }: any) => <div className="pcard-week">
  {weekOrder(ws).map((d?: any) => <div key={d} className={'pcard-wd' + (days.has(d) ? ' on' : '')}>{t(DAYS[d])}</div>)}
</div>;
const RoutineBlock: any = ({ r, unit, speedUnit }: any) => <div className="pcard-rt">
  <div className="pcard-rt-h"><b><Icon name={glyphOf(r.emoji)}/>{r.name}</b><span>{tn('{0} exercise', '{0} exercises', r.ex.length)}</span></div>
  {!!r.why && <div className="pcard-why">{r.why}</div>}
  {r.ex.map((e?: any, i?: any) => <div key={i} className="pcard-ex">
    <div className="pcard-ex-r"><span className="pcard-ex-n">{exName(e.id)}</span><span className="pcard-ex-l">{exLine(e, unit, speedUnit)}</span></div>
    {!!e.why && <div className="pcard-ex-w">{e.why}</div>}
  </div>)}
</div>;
/* ---------------------------------- a review ---------------------------------- */
function ReviewCard({ p, S, update, toast, refresh }: any) {
    const marked: any = useMemo(() => markStale(p, S), [p, S]);
    const usable: any = applicable(marked);
    const [accepted, setAccepted]: any = useState(() => new Set(usable.map((c?: any) => c.id)));
    const toggle: any = (id?: any) => setAccepted((s?: any) => { const n: any = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const apply: any = () => {
        const ids: any = [...accepted].filter((id?: any) => usable.some((c?: any) => c.id === id));
        if (!ids.length) {
            discard();
            return;
        }
        try {
            update((s?: any) => {
                const res: any = applyChangeSet(s, marked, ids);
                appendChat(s, { role: 'coach', kind: 'applied', ref: res.logId, text: tn('Applied {0} change to your plan.', 'Applied {0} changes to your plan.', ids.length) });
            });
            resolvePending({ accepted: ids, rejected: marked.changes.filter((c?: any) => !ids.includes(c.id)).map((c?: any) => c.id) }).catch(() => { });
            toast(tn('{0} change applied', '{0} changes applied', ids.length));
            refresh();
        }
        catch (e: any) {
            toast(e.message || t('Could not apply those changes'));
        }
    };
    const discard: any = () => confirmSheet({
        title: t('Dismiss these suggestions?'), message: t('Nothing changes, and the Coach will remember you turned these down.'),
        confirmText: t('Dismiss'), danger: true,
        onConfirm: () => {
            update((s?: any) => { const ref: any = recordDismissal(s, marked); appendChat(s, { role: 'coach', kind: 'dismissed', ref, text: t('Got it. I won’t suggest these again without new evidence.') }); });
            resolvePending({ dismissed: true }).catch(() => { });
            refresh();
        }
    });
    return <div className="msg coach" style={{ maxWidth: '100%', width: '100%' }}>
    <div className="pcard">
      <div className="pcard-hd">
        <div className="pcard-eyebrow">{t('Suggestions')}</div>
        <h2 className="pcard-h">{tn('{0} suggestion', '{0} suggestions', marked.changes.length)}</h2>
        {!!marked.summary && <p className="pcard-sum">{marked.summary}</p>}
        {!!marked.evidence?.sessions && <p className="pcard-sum" style={{ fontSize: 13 }}>
          {t('Based on your last {0} sessions', marked.evidence.sessions)}{marked.evidence.from ? ` · ${fmtDate(marked.evidence.from)} – ${fmtDate(marked.evidence.to)}` : ''}
        </p>}
        {marked.planMoved && <p className="pcard-sum" style={{ fontSize: 13, color: 'var(--yellow)' }}>
          {t('Your plan changed since the Coach looked at it. Suggestions that no longer match are greyed out. Ask for a fresh review to see them again.')}
        </p>}
      </div>

      <Insights S={S} window={marked.evidence}/>

      {marked.changes.map((c?: any) => {
            const stale: any = c.status === 'stale';
            return <ChangeRow key={c.id} c={c} S={S} stale={stale}>
          {!stale && <Check checked={accepted.has(c.id)} onChange={() => toggle(c.id)}/>}
        </ChangeRow>;
        })}

      <Notes notes={marked.notes}/>

      <div className="pcard-note">{t('The Coach is not a doctor or a physiotherapist. If something hurts, ask a professional.')}</div>
      <div className="pcard-ft">
        <Button variant="primary" icon="check" onClick={apply}>
          {accepted.size ? tn('Apply {0} change', 'Apply {0} changes', accepted.size) : t('Apply nothing')}
        </Button>
        <Button onClick={discard}>{t('Dismiss all')}</Button>
      </div>
    </div>
  </div>;
}
function ChangeRow({ c, S, stale, badge, children }: any) {
    const vals: any = changeValues(c, S);
    return <div className={'pcard-chg' + (stale ? ' stale' : '') + (c.status === 'rejected' ? ' declined' : '')}>
    <div className="grow">
      <div className="pcard-chg-t">{changeTitle(c, S)}{c.routineName ? <span className="dim" style={{ fontWeight: 400 }}> · {c.routineName}</span> : null}</div>
      {vals && <div className="pcard-chg-v"><span className="tag">{vals.before}</span><Icon name="chevronRight" style={{ fontSize: 12, color: 'var(--label-3)' }}/><span className="tag acc">{vals.after}</span></div>}
      <div className="pcard-chg-w">{c.why}</div>
      {stale && <div className="pcard-chg-stale">{t('Doesn’t match your plan any more, so it can’t be applied.')}</div>}
    </div>
    {badge}
    {children}
  </div>;
}
const Notes: any = ({ notes }: any) => !!notes?.length && <div className="pcard-notes">
  {notes.map((n?: any, i?: any) => <div key={i}><Icon name="lightbulb"/>{n}</div>)}
</div>;
/* ---------------------------------- insights ---------------------------------- */
const BP_LABEL: any = { back: 'Back muscles', cardio: 'Cardio', chest: 'Chest', 'lower arms': 'Forearms', 'lower legs': 'Calves', neck: 'Neck', shoulders: 'Shoulders', 'upper arms': 'Arms', 'upper legs': 'Legs', waist: 'Core', other: 'Other' };
const bpLabel: any = (bp?: any) => t(BP_LABEL[bp] || bp);
/**
 * The numbers the Coach read, drawn: how much and how often, where the body weight went,
 * which lifts moved, which body parts got the work. Computed on the device for the window the
 * proposal names, so the picture under a suggestion is the evidence behind it, not decoration.
 */
function Insights({ S, window: win, compact }: any) {
    const ins: any = useMemo(() => insightsFor(S, win || {}), [S, win?.from, win?.to]);
    if (!ins.sessions && !ins.bodyweight.points.length)
        return null;
    const maxBp: any = ins.bodyParts[0]?.sets || 1;
    const bw: any = ins.bodyweight;
    return <div className="ins">
    <div className="ins-tiles">
      <Tile v={ins.sessions} l={t('Sessions')}/>
      <Tile v={ins.minutes != null ? ins.minutes : '–'} l={t('Min / session')}/>
      <Tile v={ins.volume ? kfmt(ins.volume) : '–'} l={t('Volume ({0})', S.unit)}/>
      <Tile v={ins.sets} l={t('Sets')}/>
    </div>

    {bw.points.length > 1 && <div className="ins-block">
      <div className="ins-h">
        <span>{t('Body weight')}</span>
        <span className={'ins-delta' + (bw.delta > 0 ? ' up' : bw.delta < 0 ? ' down' : '')}>
          {bw.delta > 0 ? '+' : ''}{fmtNum(bw.delta)} {S.unit}{bw.goal != null ? ` · ${t('goal')} ${fmtNum(bw.goal)}` : ''}
        </span>
      </div>
      <div className="chart"><LineChart points={bw.points} h={compact ? 96 : 120} unit={S.unit} goal={bw.goal} axes={!compact}/></div>
    </div>}

    {!!ins.strength.length && <div className="ins-block">
      <div className="ins-h"><span>{t('Estimated 1RM')}</span><span className="dim">{t('first → last session')}</span></div>
      {ins.strength.map((x?: any) => <div key={x.id} className="ins-row">
        <span className="ins-row-n">{x.name}</span>
        <span className="ins-row-v"><span className="tag">{fmtNum(x.first)}</span><Icon name="chevronRight"/><span className="tag acc">{fmtNum(x.last)}</span></span>
        <span className={'ins-delta' + (x.delta > 0 ? ' up' : x.delta < 0 ? ' down' : '')}>{x.delta > 0 ? '▲' : x.delta < 0 ? '▼' : '•'} {Math.abs(x.pct)}%</span>
      </div>)}
    </div>}

    {!!ins.bodyParts.length && !compact && <div className="ins-block">
      <div className="ins-h"><span>{t('Work sets by body part')}</span></div>
      {ins.bodyParts.slice(0, 6).map((b?: any) => <div key={b.bp} className="ins-bar">
        <span className="ins-bar-l">{bpLabel(b.bp)}</span>
        <span className="ins-bar-t"><i style={{ width: Math.max(4, Math.round(b.sets / maxBp * 100)) + '%' }}/></span>
        <span className="ins-bar-v">{b.sets}</span>
      </div>)}
    </div>}
  </div>;
}
const Tile: any = ({ v, l }: any) => <div className="ins-tile"><div className="ins-tile-v">{v}</div><div className="ins-tile-l">{l}</div></div>;
const kfmt: any = (n?: any) => (n >= 10000 ? Math.round(n / 1000) + 'k' : fmtNum(n));
/* ---------------------------------- a debrief ---------------------------------- */
function DebriefBody({ p, S }: any) {
    const w: any = p.workout || {};
    const live: any = useMemo(() => sessionInsights(S, (S.workouts || []).find((x?: any) => x.id === w.id) || null), [S, w.id]);
    const score: any = Number.isFinite(p.score) ? Math.max(1, Math.min(10, p.score)) : null;
    return <>
    {score != null && <div className="deb-score">
      <div className="deb-ring" style={{ '--pct': score / 10 }}><span>{score}</span><small>/10</small></div>
      <div className="deb-score-t"><b>{scoreWord(score)}</b><span>{w.name || t('Workout')}{w.d ? ' · ' + fmtDate(w.d) : ''}</span></div>
    </div>}
    {live && <div className="ins">
      <div className="ins-tiles">
        <Tile v={live.now.sets} l={t('Sets')}/>
        <Tile v={live.now.minutes != null ? live.now.minutes : '–'} l={t('Minutes')}/>
        <Tile v={live.now.volume ? kfmt(live.now.volume) : '–'} l={t('Volume ({0})', S.unit)}/>
        <Tile v={live.now.prs || '–'} l={t('PRs')}/>
      </div>
      {live.then && <div className="ins-cmp">
        {t('vs. last {0} on {1}:', w.name || t('session'), fmtDate(live.prevDate))}{' '}
        <Delta v={live.now.volume - live.then.volume} unit={S.unit} label={t('volume')}/>
        {live.now.minutes != null && live.then.minutes != null && <Delta v={live.now.minutes - live.then.minutes} unit="min" label={t('time')}/>}
      </div>}
      {!!live.lifts.length && <div className="ins-block">
        <div className="ins-h"><span>{t('Best set, estimated 1RM')}</span></div>
        {live.lifts.slice(0, 6).map((x?: any) => <div key={x.id} className="ins-row">
          <span className="ins-row-n">{x.name} <span className="dim">{fmtNum(x.w)}×{x.r}</span></span>
          <span className="ins-row-v"><span className="tag acc">{fmtNum(x.est)}</span></span>
          {x.prev != null && <span className={'ins-delta' + (x.est > x.prev ? ' up' : x.est < x.prev ? ' down' : '')}>{x.est > x.prev ? '▲' : x.est < x.prev ? '▼' : '•'} {fmtNum(Math.abs(x.est - x.prev))}</span>}
        </div>)}
      </div>}
    </div>}
    <DebriefList icon="checkCircle" tint="var(--green)" title={t('What went well')} items={p.highlights}/>
    <DebriefList icon="warning" tint="var(--yellow)" title={t('Worth watching')} items={p.watch}/>
    <DebriefList icon="arrowUp" tint="var(--acc)" title={t('Next time')} items={p.nextTime}/>
  </>;
}
const Delta: any = ({ v, unit, label }: any) => <span className={'ins-delta' + (v > 0 ? ' up' : v < 0 ? ' down' : '')}>{v > 0 ? '+' : ''}{fmtNum(v)} {unit} {label}</span>;
const DebriefList: any = ({ icon, tint, title, items }: any) => !!items?.length && <div className="deb-list">
  <div className="deb-list-h" style={{ color: tint }}><Icon name={icon}/>{title}</div>
  {items.map((x?: any, i?: any) => <div key={i} className="deb-item">{x}</div>)}
</div>;
const scoreWord: any = (s?: any) => s >= 9 ? t('Excellent session') : s >= 7 ? t('Good session') : s >= 5 ? t('Solid session') : t('Tough session');
function DebriefCard({ p, S, update, toast, refresh }: any) {
    const done: any = () => {
        update((s?: any) => { const ref: any = recordDebrief(s, p); appendChat(s, { role: 'coach', kind: 'debrief', ref, text: '' }); });
        resolvePending({ accepted: ['debrief'] }).catch(() => { });
        toast(t('Kept in your Coach history'));
        refresh();
    };
    return <div className="msg coach" style={{ maxWidth: '100%', width: '100%' }}>
    <div className="pcard">
      <div className="pcard-hd">
        <div className="pcard-eyebrow">{t('Workout debrief')}</div>
        <h2 className="pcard-h">{p.workout?.name || t('Your last workout')}</h2>
        {!!p.summary && <p className="pcard-sum">{p.summary}</p>}
      </div>
      <DebriefBody p={p} S={S}/>
      <div className="pcard-ft">
        <Button variant="primary" icon="check" onClick={done}>{t('Got it')}</Button>
      </div>
    </div>
    <div className="msg-t">{t('Want changes to the plan from this? Ask for a review below.')}</div>
  </div>;
}
/* ---------------------------------- what was decided ---------------------------------- */
/** A decided proposal, folded: one line of what it was and what you did, and a way back in. */
function Recap({ entry, S, openSheet }: any) {
    const open: any = () => openSheet(() => <ProposalDetail entry={entry} S={S}/>);
    const decisions: any = entry.decisions || [];
    const acc: any = decisions.filter((d?: any) => d.status === 'accepted').length;
    const rej: any = decisions.length - acc;
    const kind: any = entry.kind;
    const eyebrow: any = kind === 'create' ? t('Plan') : kind === 'debrief' ? t('Workout debrief') : t('Suggestions');
    const state: any = kind === 'debrief' ? null
        : entry.dismissed ? { cls: 'no', text: t('Declined') }
            : kind === 'create' ? { cls: 'yes', text: t('Imported') }
                : rej ? { cls: 'mix', text: t('{0} accepted · {1} declined', acc, rej) } : { cls: 'yes', text: t('{0} accepted', acc) };
    const title: any = kind === 'create' ? (entry.bundle?.name || t('Coach plan'))
        : kind === 'debrief' ? (entry.workout?.name || t('Workout')) + (entry.score != null ? ` · ${entry.score}/10` : '')
            : tn('{0} suggestion', '{0} suggestions', decisions.length);
    return <button className="recap" onClick={open}>
    <div className="recap-top">
      <span className="pcard-eyebrow">{eyebrow}</span>
      {state && <span className={'recap-state ' + state.cls}>{state.text}</span>}
    </div>
    <div className="recap-t">{title}</div>
    {!!entry.summary && <div className="recap-s">{entry.summary}</div>}
    {kind === 'review' && !!decisions.length && <div className="recap-chips">
      {decisions.slice(0, 4).map((d?: any) => <span key={d.id} className={'recap-chip ' + (d.status === 'accepted' ? 'yes' : 'no')}><Icon name={d.status === 'accepted' ? 'check' : 'xmark'}/>{changeTitle(d, S)}</span>)}
      {decisions.length > 4 && <span className="recap-chip">+{decisions.length - 4}</span>}
    </div>}
    <div className="recap-more">{t('Show everything')}<Icon name="chevronRight"/></div>
  </button>;
}
/** The whole proposal, as it was, read-only. */
function ProposalDetail({ entry, S }: any) {
    const [tab, setTab]: any = useState(0);
    const kind: any = entry.kind;
    const b: any = entry.bundle;
    const r: any = b?.routines?.[Math.min(tab, (b?.routines?.length || 1) - 1)];
    const weekDays: any = useMemo(() => new Set(Object.keys(b?.week || {}).map(Number)), [b]);
    return <div className="pdetail">
    <div className="pcard-hd" style={{ paddingInline: 0 }}>
      <div className="pcard-eyebrow">{kind === 'create' ? t('Plan') : kind === 'debrief' ? t('Workout debrief') : t('Suggestions')} · {fmtDate(isoOf(new Date(entry.at)))}</div>
      <h2 className="pcard-h">{kind === 'create' ? (b?.name || t('Coach plan')) : kind === 'debrief' ? (entry.workout?.name || t('Workout')) : tn('{0} suggestion', '{0} suggestions', entry.decisions?.length || 0)}</h2>
      {!!entry.summary && <p className="pcard-sum">{entry.summary}</p>}
      {entry.dismissed && <p className="pcard-sum" style={{ color: 'var(--red)' }}>{t('You declined this.')}</p>}
      {!!entry.evidence?.sessions && <p className="pcard-sum" style={{ fontSize: 13 }}>
        {t('Based on your last {0} sessions', entry.evidence.sessions)}{entry.evidence.from ? ` · ${fmtDate(entry.evidence.from)} – ${fmtDate(entry.evidence.to)}` : ''}
      </p>}
    </div>

    {kind === 'review' && <>
      <Insights S={S} window={entry.evidence}/>
      {(entry.decisions || []).map((d?: any) => <ChangeRow key={d.id} c={d} S={S} stale={d.status === 'stale'} badge={<span className={'recap-state ' + (d.status === 'accepted' ? 'yes' : 'no')}>{d.status === 'accepted' ? t('Accepted') : d.status === 'stale' ? t('Expired') : t('Declined')}</span>}/>)}
      <Notes notes={entry.notes}/>
    </>}

    {kind === 'create' && b && <>
      <WeekStrip days={weekDays} ws={weekStartOf(S)}/>
      {b.routines.length > 1 && <div className="pcard-tabs" style={{ paddingInline: 0 }}>
        {b.routines.map((x?: any, i?: any) => <button key={x.id || i} className={'pcard-tab' + (i === tab ? ' on' : '')} onClick={() => setTab(i)}><Icon name={glyphOf(x.emoji)}/>{x.name}</button>)}
      </div>}
      {r && <RoutineBlock r={r} unit={S.unit} speedUnit={speedUnitOf(S)}/>}
      <p className="pcard-sum" style={{ fontSize: 13 }}>{entry.rotation ? t('Your rotation was set to this plan.') : entry.scheduled ? t('Your week was set to this schedule.') : t('Imported without changing your week.')}</p>
    </>}
    {kind === 'create' && !b && <p className="pcard-sum">{t('This plan was imported before the app kept proposals; only its summary is left.')}</p>}

    {kind === 'debrief' && <DebriefBody p={entry} S={S}/>}
    {kind === 'revert' && <p className="pcard-sum">{t('Reverted the last Coach changes.')}</p>}
    <div style={{ height: 10 }}/>
  </div>;
}
/** Every proposal ever made, newest first. Nothing the Coach said is gone after a decision. */
function HistorySheet({ S, close, openSheet }: any) {
    const log: any = [...(S.coach?.log || [])].reverse();
    const icon: any = { create: ['clipboard', 'var(--indigo)'], review: ['sparkles', 'var(--acc)'], debrief: ['checkCircle', 'var(--green)'], revert: ['reset', 'var(--blue)'] };
    return <div className="chat-menu">
    <h3>{t('Everything the Coach proposed')}</h3>
    {!log.length && <div className="chat-empty">{t('Nothing yet. Every plan, suggestion and debrief will be kept here, whether you said yes or no.')}</div>}
    <div className="sect-b">
      {log.map((e?: any) => {
            const [ic, tint]: any = icon[e.kind] || ['sparkles', 'var(--acc)'];
            const n: any = (e.decisions || []).length;
            const acc: any = (e.decisions || []).filter((d?: any) => d.status === 'accepted').length;
            const title: any = e.kind === 'create' ? (e.bundle?.name || t('Coach plan')) + (e.iteration > 1 ? ` · ${t('Revision {0}', e.iteration)}` : '')
                : e.kind === 'debrief' ? t('Debrief: {0}', e.workout?.name || t('Workout')) + (e.score != null ? ` · ${e.score}/10` : '')
                    : e.kind === 'revert' ? t('Reverted the last Coach changes.')
                        : tn('{0} suggestion', '{0} suggestions', n);
            const sub: any = fmtDate(isoOf(new Date(e.at))) + ' · ' + (e.kind === 'debrief' ? String(e.summary || '').slice(0, 60)
                : e.dismissed ? t('Declined') : e.kind === 'create' ? t('Imported') : e.kind === 'revert' ? '' : t('{0} accepted · {1} declined', acc, n - acc));
            return <Row key={e.id} icon={ic} iconTint={tint} title={title} subtitle={sub} accessory="chevron" onClick={() => { close(); openSheet(() => <ProposalDetail entry={e} S={S}/>); }}/>;
        })}
    </div>
    <div style={{ height: 10 }}/>
  </div>;
}
/* ---------------------------------- the others here ---------------------------------- */
/**
 * How you sit against everyone else on this instance — medians only, at least three people
 * sharing, nothing that identifies anyone. The admin turns it on for the instance; each person
 * turns it on for themselves; a person who does not share sees nothing either.
 */
function CohortSheet({ S, update, toast }: any) {
    const [d, setD]: any = useState(null);
    const [busy, setBusy]: any = useState(false);
    const load: any = () => cohortStats().then(setD).catch((e?: any) => { toast(e.message || t('Could not load')); setD({ ok: false }); });
    useEffect(() => { load(); }, []);
    const share: any = async (v?: any) => {
        setBusy(true);
        try {
            await setCohortShare(v);
            update((s?: any) => { (s.coach = s.coach || emptyCoach()).share = v; });
            await load();
        }
        catch (e: any) {
            toast(e.message || t('Could not save'));
        }
        setBusy(false);
    };
    const sharing: any = !!d?.sharing;
    return <div className="chat-menu">
    <h3>{t('Compare with others here')}</h3>
    <Section footer={t('Only medians across everyone who shares, never a name, a body weight or a single session. Turning this off removes you from the numbers immediately.')}>
      <Row icon="person" iconTint="var(--teal)" title={t('Include me')} subtitle={sharing ? t('Your lifts count towards the medians') : t('Off. You see nothing and share nothing')}>
        <Switch checked={sharing} disabled={busy || !d} onChange={share}/>
      </Row>
    </Section>
    {!d && <div className="chat-empty">{t('Loading…')}</div>}
    {d && sharing && !d.ok && <div className="chat-empty">{d.people != null
                ? t('Not enough people are sharing yet ({0} of {1} needed). Rope in your gym mates!', d.people, d.minPeople)
                : t('Not available right now.')}</div>}
    {d && sharing && d.ok && <div className="ins" style={{ padding: 0 }}>
      <div className="ins-tiles">
        <Tile v={d.people} l={t('People')}/>
        <Tile v={fmtNum(d.sessionsPerWeek.you)} l={t('Your sessions / wk')}/>
        <Tile v={fmtNum(d.sessionsPerWeek.median)} l={t('Median / wk')}/>
        <Tile v={d.rankPct != null ? d.rankPct + '%' : '–'} l={t('Your strength rank')}/>
      </div>
      {!!d.exercises.length && <div className="ins-block">
        <div className="ins-h"><span>{t('Estimated 1RM, you vs. median')}</span><span className="dim">{S.unit}</span></div>
        {d.exercises.map((x?: any) => {
                    const max: any = Math.max(x.median, x.you || 0) || 1;
                    return <div key={x.id} className="cmp">
            <div className="cmp-h"><span>{x.name}</span><span className="dim">{x.people} {t('people')}</span></div>
            <div className="cmp-bar you"><i style={{ width: Math.round((x.you || 0) / max * 100) + '%' }}/><span>{t('You')} · {x.you != null ? fmtNum(x.you) : '–'}</span></div>
            <div className="cmp-bar"><i style={{ width: Math.round(x.median / max * 100) + '%' }}/><span>{t('Median')} · {fmtNum(x.median)}</span></div>
          </div>;
                })}
      </div>}
      {!d.exercises.length && <div className="chat-empty">{t('No exercise is trained by three or more people yet.')}</div>}
    </div>}
    <div style={{ height: 10 }}/>
  </div>;
}
/* ---------------------------------- cadence ---------------------------------- */
const cadenceLabel: any = (coach?: any) => {
    const c: any = coach.cadence && coach.cadence !== 'off' ? coach.cadence : null;
    if (!c)
        return t('Off');
    if (c.weekly)
        return t('Weekly');
    return t('After every few workouts');
};
function cadenceSheet(openSheet?: any, update?: any) {
    openSheet((close?: any) => <CadenceSheet close={close} update={update}/>);
}
function CadenceSheet({ update }: any) {
    const coach: any = useStore((s?: any) => s.S.coach) || emptyCoach();
    const cadence: any = coach.cadence && coach.cadence !== 'off' ? coach.cadence : null;
    const mode: any = !cadence ? 'off' : cadence.weekly ? 'weekly' : 'every';
    // A phone with its own key runs them itself, and only while the app is open (lib/coach-schedule.ts).
    const deviceMode: any = useStore((s?: any) => s.coachLocal?.mode);
    const onPhone: any = MOBILE && deviceMode === 'byok';
    // Automatic reviews send your training while nobody is looking, so switching them on is where
    // the data-sharing question is asked for them. "Not now" leaves them off.
    const setMode: any = async (m?: any) => {
        if (m !== 'off') {
            try {
                await ensureAiConsent();
            }
            catch (e: any) {
                if (!isDeclined(e))
                    useUI.getState().toast(e.message || t('Could not ask the Coach'));
                return;
            }
        }
        update((s?: any) => {
            const c: any = (s.coach = s.coach || emptyCoach());
            c.cadence = m === 'off' ? 'off' : m === 'weekly' ? { weekly: { day: 0, time: '18:00' } } : { everyWorkouts: 4 };
        });
    };
    const patch: any = (fn?: any) => update((s?: any) => { const c: any = (s.coach = s.coach || emptyCoach()); fn(c); });
    return <>
    <h3>{t('Automatic reviews')}</h3>
    <Section footer={mode === 'off' ? t('Off. The Coach only looks when you ask.') : t('You are only notified when the Coach actually has something to suggest.')
            + (onPhone ? ' ' + t('On this phone the Coach can only look while the app is open: right after a workout, or the next time you open it.') : '')}>
      <SelectRow icon="clock" iconTint="var(--purple)" title={t('When')} value={mode} onChange={setMode} options={[
            { value: 'off', label: t('Off') },
            { value: 'weekly', label: t('Weekly'), subtitle: t('On a day and time you choose') },
            { value: 'every', label: t('After every few workouts'), subtitle: t('As soon as you have logged enough') }
        ]}/>
      {mode === 'weekly' && <>
        <SelectRow icon="calendar" iconTint="var(--orange)" title={t('Day')} value={cadence.weekly.day} onChange={(v?: any) => patch((c?: any) => { c.cadence = { weekly: { ...c.cadence.weekly, day: v } }; })} options={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d?: any, i?: any) => ({ value: i, label: t(d) }))}/>
        <Row icon="clock" iconTint="var(--purple)" title={t('Time')}>
          <input type="time" className="timef" value={cadence.weekly.time || '18:00'} onChange={(e?: any) => patch((c?: any) => { c.cadence = { weekly: { ...c.cadence.weekly, time: e.target.value } }; })}/>
        </Row>
      </>}
      {mode === 'every' && <SelectRow icon="dumbbell" iconTint="var(--teal)" title={t('After how many workouts')} value={cadence.everyWorkouts || 4} onChange={(v?: any) => patch((c?: any) => { c.cadence = { everyWorkouts: v }; })} options={[3, 4, 5, 6, 8, 10].map((n?: any) => ({ value: n, label: tn('{0} workout', '{0} workouts', n) }))}/>}
    </Section>
  </>;
}

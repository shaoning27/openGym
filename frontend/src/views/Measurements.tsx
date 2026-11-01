// Legacy dynamic types are explicit during the full language migration.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore.ts';
import { useUI } from '../store/useUI.ts';
import { MEASUREMENT_FIELDS, MEASUREMENT_KEYS, emptyMeasurement, enabledMeasurementFields, fromMeasurementDisplay, latestMeasurement, measurementEntryHasValues, measurementSeries, measurementUnit, measurementValue, normalizeMeasurementEntry, toMeasurementDisplay, normalizeMeasurementsState, CUSTOM_MEASUREMENT_UNITS, customMeasurementUnits, measurementUnitLabel, zeroIsReading, } from '../lib/measurements.ts';
import { fmtDate, fmtNum, todayISO, uid } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import LineChart from '../components/LineChart.tsx';
import Icon from '../components/Icon.tsx';
import { Button, NumberField, Section, Segmented, SelectRow, Switch, TextField } from '../components/ui.tsx';
import { confirmSheet } from '../sheets.tsx';
// Every write leaves the list in its one-entry-per-day shape (normalizeMeasurementsState).
const update: any = (fn?: any, ...rest: any[]) => useStore.getState().update((s?: any) => { fn(s); normalizeMeasurementsState(s); }, ...rest);
const toast: any = (message?: any) => useUI.getState().toast(message);
// The label after a number: empty for a unitless field (#718).
const fieldUnit: any = (field?: any, profileUnit?: any) => measurementUnitLabel(measurementUnit(profileUnit, field));
const unitOptions: any = (units?: any) => units.map((value?: any) => ({ value, label: value === 'none' ? t('No unit') : value }));
const withUnit: any = (value?: any, unit?: any) => unit ? fmtNum(value) + ' ' + unit : fmtNum(value);
const shownValue: any = (entry?: any, field?: any, profileUnit?: any) => {
    const value: any = measurementValue(entry, field.key);
    if (value == null)
        return null;
    return toMeasurementDisplay(value, profileUnit, field);
};
function MeasurementLog({ sourceDate, close }: any) {
    const S: any = useStore((s?: any) => s.S);
    const source: any = sourceDate ? S.measurements.find((e?: any) => e.d === sourceDate) : null;
    const enabled: any = enabledMeasurementFields(S);
    const fields: any = [...enabled];
    // Editing must expose populated fields even if the user disabled them after logging.
    if (source) {
        for (const f of MEASUREMENT_FIELDS) {
            if (source[f.key] != null && !fields.some((x?: any) => x.key === f.key))
                fields.push(f);
        }
        for (const o of source.other || []) {
            if (o.value != null && !fields.some((x?: any) => x.key === 'other:' + o.id)) {
                fields.push({ key: 'other:' + o.id, label: o.name, unit: o.unit, custom: true, group: 'Other' });
            }
        }
    }
    const [date, setDate]: any = useState(source?.d || todayISO());
    const [values, setValues]: any = useState(() => Object.fromEntries(fields.map((f?: any) => [f.key, shownValue(source, f, S.unit)])));
    const save: any = () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayISO()) {
            toast(t('Choose a valid date'));
            return;
        }
        if (date !== sourceDate && S.measurements.some((e?: any) => e.d === date)) {
            toast(t('That date already has measurements. Edit it instead.'));
            return;
        }
        const base: any = source ? normalizeMeasurementEntry(source, S.customMeasurements) : emptyMeasurement(date, S.customMeasurements);
        base.d = date;
        base.t = source && date === source.d ? source.t : (date === todayISO() ? Date.now() : new Date(date + 'T12:00:00').getTime());
        for (const field of fields) {
            const raw: any = values[field.key];
            const shown: any = measurementUnit(S.unit, field);
            const percent: any = shown === '%';
            const value: any = raw == null || (raw === 0 && !zeroIsReading(shown)) ? null : Math.round(+raw * 10) / 10;
            if (percent && value != null && (value < 0 || value > 100)) {
                toast(field.key === 'bodyFat' ? t('Body fat must be between 0 and 100%.') : t('{0} must be between 0 and 100%.', field.label));
                return;
            }
            if (field.custom) {
                const item: any = base.other.find((o?: any) => o.id === field.key.slice(6));
                if (item) {
                    item.value = fromMeasurementDisplay(value, S.unit, field);
                    if (field.unit)
                        item.unit = field.unit;
                }
            }
            else if (field.key === 'bodyFat')
                base.bodyFat = value;
            else
                base[field.key] = value == null ? null : fromMeasurementDisplay(value, S.unit);
        }
        if (!measurementEntryHasValues(base)) {
            toast(t('Enter at least one measurement'));
            return;
        }
        // `t` is when the check-in was last saved: the newer one of a day wins a sync merge, the
        // way a weigh-in's does. The chart places it by its date, not by this.
        base.t = Date.now();
        update((state?: any) => {
            if (sourceDate)
                state.measurements = state.measurements.filter((e?: any) => e.d !== sourceDate);
            state.measurements.push(base);
        });
        close();
        toast(t('Measurements saved'));
    };
    return <>
    <h3>{source ? t('Edit measurements') : t('Log measurements')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Fill only what you measured today. Empty fields stay empty.')}</div>
    <label className="measure-date">
      <span>{t('Date')}</span>
      <input className="field" type="date" value={date} max={todayISO()} onChange={(e?: any) => setDate(e.target.value)}/>
    </label>
    {fields.length ? <div className="measure-form">
      {fields.map((field?: any) => <label className="measure-field" key={field.key}>
        <span>{t(field.label)}</span>
        <span className="measure-input">
          <NumberField nullable value={values[field.key]} onChange={(value?: any) => setValues((v?: any) => ({ ...v, [field.key]: value }))}/>
          <i>{fieldUnit(field, S.unit)}</i>
        </span>
      </label>)}
    </div> : <div className="empty small">{t('Choose at least one measurement first.')}</div>}
    <div style={{ height: 14 }}/>
    <Button variant="primary" onClick={save} disabled={!fields.length}>{t('Save')}</Button>
    <div style={{ height: 8 }}/>
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>;
}
export function measurementLogSheet(sourceDate: any = null) {
    return useUI.getState().openSheet((close?: any) => <MeasurementLog sourceDate={sourceDate} close={close}/>);
}
function ManageMeasurements({ close }: any) {
    const S: any = useStore((s?: any) => s.S);
    const [name, setName]: any = useState('');
    const [unit, setUnit]: any = useState(() => measurementUnit(S.unit));
    const groups: any = [...new Set(MEASUREMENT_FIELDS.map((f?: any) => f.group))];
    const toggleBuiltin: any = (key?: any, on?: any) => update((state?: any) => {
        const set: any = new Set(state.measurementEnabled || []);
        if (on)
            set.add(key);
        else
            set.delete(key);
        state.measurementEnabled = [...set];
    });
    const toggleCustom: any = (id?: any, on?: any) => update((state?: any) => {
        const item: any = state.customMeasurements.find((c?: any) => c.id === id);
        if (item)
            item.enabled = on;
    });
    const setCustomUnit: any = (id?: any, value?: any) => update((state?: any) => {
        const item: any = state.customMeasurements.find((c?: any) => c.id === id);
        if (item && customMeasurementUnits(item, state.measurements).includes(value))
            item.unit = value;
    });
    const add: any = () => {
        const clean: any = name.trim();
        if (!clean)
            return;
        if (S.customMeasurements.some((c?: any) => c.name.toLowerCase() === clean.toLowerCase()) ||
            MEASUREMENT_FIELDS.some((f?: any) => f.label.toLowerCase() === clean.toLowerCase())) {
            toast(t('A custom measurement with that name already exists.'));
            return;
        }
        update((state?: any) => { state.customMeasurements.push({ id: uid(), name: clean.slice(0, 60), enabled: true, unit }); });
        setName('');
    };
    return <>
    <h3>{t('Choose measurements')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Keep the logging form focused on the measurements you actually track.')}</div>
    {groups.map((group?: any) => <Section title={t(group)} key={group} className="measure-options">
      {MEASUREMENT_FIELDS.filter((f?: any) => f.group === group).map((field?: any) => <div className="lrow" key={field.key}>
        <span className="lrow-m"><span className="lrow-t">{t(field.label)}</span></span>
        <Switch checked={(S.measurementEnabled || []).includes(field.key)} onChange={(on?: any) => toggleBuiltin(field.key, on)}/>
      </div>)}
      {group === 'Other' && S.customMeasurements.map((field?: any) => <div key={field.id}>
        <div className="lrow">
          <span className="lrow-m"><span className="lrow-t">{field.name}</span><span className="lrow-s">{t('Custom')}</span></span>
          <Switch checked={field.enabled !== false} onChange={(on?: any) => toggleCustom(field.id, on)}/>
        </div>
        <SelectRow title={t('Measurement unit')} value={measurementUnit(S.unit, field)} options={unitOptions(customMeasurementUnits(field, S.measurements))} onChange={(value?: any) => setCustomUnit(field.id, value)}/>
      </div>)}
    </Section>)}
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Logged values keep their type. Add a new measurement to use a different type.')}</div>
    <h4 className="sec">{t('Custom measurement')}</h4>
    <div className="sect-b">
      <SelectRow title={t('Measurement unit')} value={unit} onChange={setUnit} options={unitOptions(CUSTOM_MEASUREMENT_UNITS)}/>
    </div>
    <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
      <TextField value={name} maxLength={60} placeholder={t('Custom measurement')} onChange={(e?: any) => setName(e.target.value)} onKeyDown={(e?: any) => { if (e.key === 'Enter')
        add(); }}/>
      <Button icon="plus" onClick={add} disabled={!name.trim()}>{t('Add')}</Button>
    </div>
    <div style={{ height: 14 }}/>
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>;
}
export function manageMeasurementsSheet() {
    return useUI.getState().openSheet((close?: any) => <ManageMeasurements close={close}/>);
}
export default function Measurements() {
    const nav: any = useNavigate();
    const S: any = useStore((s?: any) => s.S);
    const [range, setRange]: any = useState(90);
    const available: any = useMemo(() => {
        const out: any = enabledMeasurementFields(S);
        for (const field of MEASUREMENT_FIELDS) {
            if (latestMeasurement(S, field.key) && !out.some((f?: any) => f.key === field.key))
                out.push(field);
        }
        for (const custom of S.customMeasurements || []) {
            const key: any = 'other:' + custom.id;
            if (latestMeasurement(S, key) && !out.some((f?: any) => f.key === key))
                out.push({ key, label: custom.name, unit: custom.unit, custom: true, group: 'Other' });
        }
        return out;
    }, [S]);
    const fallback: any = available.find((f?: any) => f.key === 'waist')?.key || available[0]?.key || null;
    const [selected, setSelected]: any = useState(fallback);
    const key: any = available.some((f?: any) => f.key === selected) ? selected : fallback;
    const field: any = available.find((f?: any) => f.key === key);
    const points: any = key ? measurementSeries(S, key, range) : [];
    const unit: any = fieldUnit(field, S.unit);
    const all: any = key ? measurementSeries(S, key) : [];
    const latest: any = all.at(-1);
    const previous: any = all.at(-2);
    const delta: any = latest && previous ? Math.round((latest.y - previous.y) * 10) / 10 : null;
    const recent: any = [...S.measurements].reverse();
    const remove: any = (entry?: any) => confirmSheet({
        title: t('Delete measurements?'),
        message: t('Deletes the measurements logged on {0}.', fmtDate(entry.d, true)),
        confirmText: t('Delete'), danger: true,
        onConfirm: () => { update((state?: any) => { state.measurements = state.measurements.filter((e?: any) => e.d !== entry.d); }); toast(t('Measurements deleted')); },
    });
    return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/stats" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft"/></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Body measurements')}</h1><div className="sub">{t('Circumference & composition')}</div></div>
      <button className="iconbtn" onClick={manageMeasurementsSheet} aria-label={t('Choose measurements')}><Icon name="gear"/></button>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <div>
          <div className="muted small">{field ? t(field.label) : t('Body measurements')}</div>
          <div className="big" style={{ marginTop: 3 }}>{latest ? <>{fmtNum(latest.y)} <span className="muted" style={{ fontSize: '1rem' }}>{unit}</span></> : '–'}</div>
          {delta != null && delta !== 0 && <div className="small" style={{ marginTop: 3, color: 'var(--label-2)' }}>{delta > 0 ? '+' : ''}{withUnit(delta, unit)} {t('since previous')}</div>}
        </div>
        <Button size="sm" icon="plus" onClick={() => measurementLogSheet()}>{t('Log')}</Button>
      </div>
      {available.length > 0 && <div className="sect-b measure-select"><SelectRow title={t('Measurement')} sheetTitle={t('Choose measurement')} value={key} onChange={setSelected} options={available.map((f?: any) => ({ value: f.key, label: t(f.label) }))}/>
      </div>}
      <Segmented className="seg-range" value={range} onChange={setRange} options={[{ value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 365, label: '1Y' }, { value: 0, label: t('All') }]}/>
      <div className="chart"><LineChart points={points} h={170} unit={unit} color="var(--teal)"/></div>
    </div>

    {!available.length && <div className="card">
      <div className="muted small">{t('Choose the measurements you want to track, then log your first check-in.')}</div>
      <div style={{ height: 10 }}/><Button onClick={manageMeasurementsSheet}>{t('Choose measurements')}</Button>
    </div>}

    <div className="row between" style={{ margin: '18px 2px 10px' }}>
      <h4 className="sec" style={{ margin: 0 }}>{t('Measurement history')}</h4>
      <Button size="sm" variant="ghost" icon="gear" onClick={manageMeasurementsSheet}>{t('Fields')}</Button>
    </div>
    {recent.length ? <div className="list">{recent.map((entry?: any) => {
                const count: any = MEASUREMENT_KEYS.filter((k?: any) => entry[k] != null).length + (entry.other || []).filter((o?: any) => o.value != null).length;
                const previewFields: any = enabledMeasurementFields(S).map((f?: any) => ({ field: f, value: shownValue(entry, f, S.unit) })).filter((x?: any) => x.value != null).slice(0, 3);
                return <div className="card measure-history" key={entry.d}>
        <div className="row between">
          <div><b>{fmtDate(entry.d, true)}</b><div className="small dim" style={{ marginTop: 2 }}>{t(count === 1 ? '{0} measurement' : '{0} measurements', count)}</div></div>
          <div className="row" style={{ gap: 4 }}>
            <button className="iconbtn" onClick={() => measurementLogSheet(entry.d)} aria-label={t('Edit')}><Icon name="pencil"/></button>
            <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={() => remove(entry)} aria-label={t('Delete')}><Icon name="trash"/></button>
          </div>
        </div>
        {previewFields.length > 0 && <div className="measure-preview">{previewFields.map(({ field: f, value }: any) => <span key={f.key}>{t(f.label)} <b>{withUnit(value, fieldUnit(f, S.unit))}</b></span>)}</div>}
      </div>;
            })}</div> : <div className="empty small">{t('No measurements yet')}</div>}
  </div>;
}

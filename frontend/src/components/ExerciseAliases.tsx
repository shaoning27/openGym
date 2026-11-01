// Legacy dynamic types are explicit during the full language migration.
import { useId, useState } from 'react';
import { useStore } from '../store/useStore.ts';
import { exerciseAliases, normalizeAliases } from '../lib/exercise-aliases.ts';
import { isCustomEx } from '../lib/exercises.ts';
import { t } from '../lib/i18n.ts';
import { Button } from './ui.tsx';
import Icon from './Icon.tsx';
// Other names an exercise is found by (#624). A power feature, so it stays one quiet line until
// someone asks for it: "Add another name", or the names already given, and only a tap opens the field.
export function ExerciseAliasesField({ value, onChange, autoFocus }: any) {
    const id: any = useId();
    return <div style={{ marginTop: 12 }}>
    <label className="small muted" htmlFor={id}>{t('Other names')}</label>
    <input id={id} className="input" value={value} onChange={(e?: any) => onChange(e.target.value)} autoFocus={autoFocus} maxLength={1640} aria-describedby={id + '-help'}/>
    <div id={id + '-help'} className="small dim">{t('The search finds it by these too. Separate them with commas.')}</div>
  </div>;
}
/** The closed state of the field: what it is called besides its name, or the offer to add one. */
export function ExerciseAliasesLink({ names, onOpen }: any) {
    return <button type="button" className="small dim exfix-link exalias-link" onClick={onOpen}>
    <Icon name={names.length ? 'pencil' : 'plus'}/> {names.length ? t('Also called {0}', names.join(', ')) : t('Add another name')}
  </button>;
}
export default function ExerciseAliasesEditor({ ex }: any) {
    const st: any = useStore((s?: any) => s.S);
    const update: any = useStore((s?: any) => s.update);
    const current: any = isCustomEx(ex) ? st.customEx?.find((c?: any) => c.id === ex.id) || ex : ex;
    const saved: any = exerciseAliases(current, st.exAliases);
    const [open, setOpen]: any = useState(false);
    const [value, setValue]: any = useState('');
    const aliases: any = normalizeAliases(value);
    if (!open)
        return <ExerciseAliasesLink names={saved} onOpen={() => { setValue(saved.join(', ')); setOpen(true); }}/>;
    const save: any = () => {
        update((s?: any) => {
            if (isCustomEx(ex)) {
                const c: any = s.customEx?.find((c?: any) => c.id === ex.id);
                if (c)
                    c.aliases = aliases;
            }
            else
                s.exAliases = { ...s.exAliases, [ex.id]: aliases };
        });
        setOpen(false);
    };
    return <>
    <ExerciseAliasesField value={value} onChange={setValue} autoFocus/>
    <Button onClick={save} disabled={JSON.stringify(aliases) === JSON.stringify(saved)} style={{ marginTop: 8 }}>{t('Save names')}</Button>
  </>;
}

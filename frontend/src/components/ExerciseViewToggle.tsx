// Legacy dynamic types are explicit during the full language migration.
import { useStore } from '../store/useStore.ts';
import { t } from '../lib/i18n.ts';
import Icon from './Icon.tsx';
// The button beside the search field that switches the exercise lists (Library, picker, muscle
// explorer) between rows and picture cards. Not in the header: on a phone the Library header
// already leaves its title little room next to "By muscle" (Library.test.jsx), while the search
// row is full-width everywhere a list is, and sits right above the list it changes.
export default function ExerciseViewToggle() {
    const cards: any = useStore((s?: any) => s.S.exerciseView === 'cards');
    const update: any = useStore((s?: any) => s.update);
    return <button className={'iconbtn ex-view-btn' + (cards ? ' on' : '')} aria-label={t('Cards')} aria-pressed={cards} onClick={() => update((s?: any) => { s.exerciseView = cards ? 'list' : 'cards'; })}><Icon name="grid"/></button>;
}

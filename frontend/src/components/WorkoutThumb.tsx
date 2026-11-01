// Legacy dynamic types are explicit during the full language migration.
import { isCustomEx } from '../lib/exercises.ts';
import { mediaOf, cleanUrl } from '../lib/media-refs.ts';
import { t } from '../lib/i18n.ts';
import { Thumb } from './Media.tsx';
import Icon from './Icon.tsx';
// Whether an exercise has anything for the workout's media slot to show: the dataset's animation
// for a built-in, its own photo, video or link for a custom one (CustomMedia.tsx).
export const hasWorkoutMedia: any = (ex?: any) => !!ex && (isCustomEx(ex) ? !!(mediaOf(ex) || cleanUrl(ex.url)) : !!ex.gif);
// The small picture next to the exercise name when animations are set to Small (v1.3.11): the
// sets get the screen, and a tap brings the full animation back (the same gifSize switch as the
// animation's own Minimize, so it sticks like that one does).
export default function WorkoutThumb({ ex, onExpand }: any) {
    return <button type="button" className="wthumb" aria-label={t('Expand')} title={t('Expand')} onClick={onExpand}>
    <Thumb ex={ex}/>
    <span className="wthumb-x" aria-hidden="true"><Icon name="expand"/></span>
  </button>;
}

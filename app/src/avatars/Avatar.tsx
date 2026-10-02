import { avatarOf, initialsOf } from "../repository/graphDrawing";
import { pictureOf, useAvatarsShown, usePicturesLoaded } from "./avatars";

/**
 * An author's avatar beside their name: their GitHub picture where it's
 * shown and has loaded, or else their initials, in their own colour, as
 * the Commit graph draws them. Decorative: the name beside it says who.
 */
export function Avatar({ name, email }: { name: string; email: string }) {
  const shown = useAvatarsShown();
  usePicturesLoaded();
  const picture = shown ? pictureOf(email) : null;
  if (picture !== null) {
    return <img className="avatar" src={picture.src} alt="" width="20" height="20" referrerPolicy="no-referrer" />;
  }
  return (
    <span className={`avatar avatar-initials avatar-${avatarOf(name)}`} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

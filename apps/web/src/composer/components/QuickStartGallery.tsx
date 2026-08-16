import { songTemplatesByGenre, type SongTemplate } from '../templates'

interface QuickStartGalleryProps {
  /** Called with the chosen template so the composer can load it in one click. */
  onLoad: (template: SongTemplate) => void
  /** Templates to show; defaults to the built-in house-dub registry. */
  templates?: readonly SongTemplate[]
}

/**
 * The **Quick Starts** gallery: built-in "house dubs" grouped by genre. Each card
 * is a real `<button>` (keyboard-operable, focus-ringed, comfortable hit target)
 * that loads a full, multi-track starter song through the composer's existing
 * `load-project` path. Purely presentational — it owns no audio or reducer state;
 * loading is delegated via {@link QuickStartGalleryProps.onLoad}.
 */
export function QuickStartGallery({ onLoad, templates }: QuickStartGalleryProps) {
  const groups = songTemplatesByGenre(templates)

  return (
    <section className="quick-start-gallery" aria-label="Quick Starts">
      <p className="quick-start-intro">
        Load a ready-made, multi-track song and remix it — one click and you’re playing.
      </p>
      {groups.map((group) => (
        <div className="quick-start-group" key={group.genre}>
          <h3 className="quick-start-genre">{group.genre}</h3>
          <ul className="quick-start-list">
            {group.templates.map((template) => (
              <li key={template.id}>
                <button
                  type="button"
                  className="quick-start-card"
                  data-interaction="studio.quick-start.load"
                  onClick={() => onLoad(template)}
                >
                  <span className="quick-start-card__head">
                    <span className="quick-start-card__name">{template.name}</span>
                    <span className="quick-start-card__tempo">{template.tempo} BPM</span>
                  </span>
                  <span className="quick-start-card__desc">{template.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

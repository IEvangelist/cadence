import './mobile.css'

export interface MobileAiSuggestion {
  title: string
  description: string
}

export interface MobileAiReviewProps {
  busy?: boolean
  suggestion: MobileAiSuggestion | null
  onGenerate: () => void
  onAccept: () => void
  onDiscard: () => void
}

export function MobileAiReview({
  busy = false,
  suggestion,
  onGenerate,
  onAccept,
  onDiscard,
}: MobileAiReviewProps) {
  return (
    <section className="mobile-ai-review" aria-label="Basic AI">
      <header>
        <h3>Basic AI</h3>
        <p>Generate one idea, then decide whether it belongs in your project.</p>
      </header>
      {!suggestion ? (
        <button
          type="button"
          className="mobile-secondary-button"
          data-interaction="mobile.ai.generate"
          disabled={busy}
          aria-busy={busy}
          onClick={onGenerate}
        >
          {busy ? 'Generating idea' : 'Generate idea'}
        </button>
      ) : (
        <div className="mobile-ai-review__suggestion">
          <div aria-live="polite">
            <h4>{suggestion.title}</h4>
            <p>{suggestion.description}</p>
          </div>
          <div className="mobile-ai-review__actions">
            <button
              type="button"
              className="mobile-primary-button"
              data-interaction="mobile.ai.accept"
              onClick={onAccept}
            >
              Accept
            </button>
            <button
              type="button"
              className="mobile-secondary-button"
              data-interaction="mobile.ai.discard"
              onClick={onDiscard}
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </section>
  )
}


/**
 * AcknowledgementsPage — the in-app "Third-party licenses / Acknowledgements"
 * surface (issue #138).
 *
 * Cadence's MP3 export (#125) redistributes the LAME encoder via
 * `@breezystack/lamejs` (LGPL-3.0-or-later). For a hosted/conveyed web app, the
 * clean way to satisfy the LGPL end-user notice obligation is a small,
 * discoverable in-app surface — not just the repo `THIRD-PARTY-NOTICES.md` or the
 * docs site. This page mirrors `site/src/pages/docs/acknowledgements.md` so the
 * wording, lineage notes, and license pointers stay consistent across the app,
 * the repo, and the docs.
 *
 * Its own feature area (`acknowledgements/`), deliberately outside the composer
 * core so it never collides with the audio path (#97). Brand-token themed (see
 * theme/tokens.css) and accessible: a labelled region, a real heading hierarchy
 * (h2 -> h3, no skips), a captioned table with scoped headers, and links with
 * discernible accessible names.
 */
import { useId } from 'react'
import './acknowledgements.css'

interface AcknowledgementsPageProps {
  /** Close the acknowledgements view and return to the app. */
  onClose?: () => void
}

interface ThirdPartyComponent {
  name: string
  version: string
  license: string
  packageUrl: string
}

// Credit + license pointers. Kept as named constants so the unit test and the
// PR reviewer can diff them against the docs acknowledgements page verbatim.
const LAME_PROJECT_URL = 'https://lame.sourceforge.io/'
const LAMEJS_NPM_URL = 'https://www.npmjs.com/package/@breezystack/lamejs'
const LAMEJS_UPSTREAM_URL = 'https://github.com/zhuker/lamejs'
const REPO_LICENSE_URL = 'https://github.com/IEvangelist/cadence/blob/main/LICENSE'
const THIRD_PARTY_NOTICES_URL =
  'https://github.com/IEvangelist/cadence/blob/main/THIRD-PARTY-NOTICES.md'
const DOCS_ACKNOWLEDGEMENTS_URL =
  'https://ievangelist.github.io/cadence/docs/acknowledgements/'
const LGPL_TEXT_URL = 'https://www.gnu.org/licenses/lgpl-3.0.txt'
const GPL_TEXT_URL = 'https://www.gnu.org/licenses/gpl-3.0.txt'
const OFL_TEXT_URL = '/licenses/OFL-1.1.txt'
const LUCIDE_LICENSE_URL = '/licenses/lucide-ISC.txt'

// The only third-party component Cadence redistributes into the shipped bundle
// (mirrors the docs "Licenses" table). Kept as data so more rows can be added
// without touching the markup.
const COMPONENTS: ThirdPartyComponent[] = [
  {
    name: '@breezystack/lamejs',
    version: '1.2.7',
    license: 'LGPL-3.0-or-later',
    packageUrl: LAMEJS_NPM_URL,
  },
  {
    name: 'react-router-dom',
    version: '7.18.2',
    license: 'MIT',
    packageUrl: 'https://www.npmjs.com/package/react-router-dom',
  },
  {
    name: '@radix-ui/react-dialog',
    version: '1.1.23',
    license: 'MIT',
    packageUrl: 'https://www.npmjs.com/package/@radix-ui/react-dialog',
  },
  {
    name: '@radix-ui/react-dropdown-menu',
    version: '2.1.24',
    license: 'MIT',
    packageUrl: 'https://www.npmjs.com/package/@radix-ui/react-dropdown-menu',
  },
  {
    name: '@radix-ui/react-popover',
    version: '1.1.23',
    license: 'MIT',
    packageUrl: 'https://www.npmjs.com/package/@radix-ui/react-popover',
  },
  {
    name: '@radix-ui/react-tooltip',
    version: '1.2.16',
    license: 'MIT',
    packageUrl: 'https://www.npmjs.com/package/@radix-ui/react-tooltip',
  },
  {
    name: 'lucide-react',
    version: '1.30.0',
    license: 'ISC / MIT',
    packageUrl: 'https://www.npmjs.com/package/lucide-react',
  },
  {
    name: '@fontsource-variable/inter',
    version: '5.3.0',
    license: 'OFL-1.1',
    packageUrl: 'https://www.npmjs.com/package/@fontsource-variable/inter',
  },
  {
    name: '@fontsource-variable/space-grotesk',
    version: '5.3.0',
    license: 'OFL-1.1',
    packageUrl: 'https://www.npmjs.com/package/@fontsource-variable/space-grotesk',
  },
  {
    name: '@fontsource-variable/jetbrains-mono',
    version: '5.3.0',
    license: 'OFL-1.1',
    packageUrl: 'https://www.npmjs.com/package/@fontsource-variable/jetbrains-mono',
  },
]

export function AcknowledgementsPage({ onClose }: AcknowledgementsPageProps) {
  const headingId = useId()
  const lameHeadingId = useId()
  const licensesHeadingId = useId()
  const textsHeadingId = useId()

  return (
    <section className="acknowledgements" aria-labelledby={headingId}>
      <div className="acknowledgements-head">
        <div>
          <h2 id={headingId}>Acknowledgements &amp; third-party licenses</h2>
          <p className="acknowledgements-sub">
            Cadence is{' '}
            <a
              href={REPO_LICENSE_URL}
              target="_blank"
              rel="noreferrer"
              data-interaction="licenses.external-link"
            >
              open-source software (MIT)
            </a>
            . It also builds on third-party open-source projects that it
            redistributes as part of the app. This page credits those projects and
            points to their licenses; the authoritative, complete list — with full
            license texts — lives in{' '}
            <a
              href={THIRD_PARTY_NOTICES_URL}
              target="_blank"
              rel="noreferrer"
              data-interaction="licenses.external-link"
            >
              THIRD-PARTY-NOTICES.md
            </a>
            .
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            className="acknowledgements-btn"
            data-interaction="licenses.close"
            onClick={onClose}
          >
            Back to composer
          </button>
        )}
      </div>

      <div className="acknowledgements-section" aria-labelledby={lameHeadingId}>
        <h3 id={lameHeadingId}>MP3 export — the LAME encoder</h3>
        <p>
          Cadence&rsquo;s <strong>MP3 export</strong> is powered by the{' '}
          <strong>LAME</strong> MP3 encoder, via{' '}
          <a
            href={LAMEJS_NPM_URL}
            target="_blank"
            rel="noreferrer"
            data-interaction="licenses.external-link"
          >
            @breezystack/lamejs
          </a>{' '}
          (version 1.2.7) — a pure-JavaScript port of LAME. It is used{' '}
          <strong>unmodified</strong> and is <strong>dynamically imported</strong> on
          demand, only when you export an MP3.
        </p>
        <dl className="acknowledgements-facts">
          <div className="acknowledgements-fact">
            <dt>License</dt>
            <dd>GNU Lesser General Public License v3.0 or later (LGPL-3.0-or-later)</dd>
          </div>
          <div className="acknowledgements-fact">
            <dt>LAME project</dt>
            <dd>
              <a
                href={LAME_PROJECT_URL}
                target="_blank"
                rel="noreferrer"
                data-interaction="licenses.external-link"
              >
                The LAME project (lame.sourceforge.io)
              </a>
            </dd>
          </div>
          <div className="acknowledgements-fact">
            <dt>Package</dt>
            <dd>
              <a
                href={LAMEJS_NPM_URL}
                target="_blank"
                rel="noreferrer"
                data-interaction="licenses.external-link"
              >
                @breezystack/lamejs on npm
              </a>{' '}
              — a fork of the original{' '}
              <a
                href={LAMEJS_UPSTREAM_URL}
                target="_blank"
                rel="noreferrer"
                data-interaction="licenses.external-link"
              >
                zhuker/lamejs
              </a>
              . (The direct <code>github.com/breezystack/lamejs</code> link 404s, so
              we cite the npm package and its upstream instead.)
            </dd>
          </div>
        </dl>
        <p className="acknowledgements-thanks">
          With thanks to the LAME project and its contributors for the encoder that
          makes MP3 export possible.
        </p>
      </div>

      <div className="acknowledgements-section" aria-labelledby={licensesHeadingId}>
        <h3 id={licensesHeadingId}>Third-party components</h3>
        <table className="acknowledgements-table">
          <caption className="acknowledgements-caption">
            Third-party components Cadence redistributes
          </caption>
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col">Version</th>
              <th scope="col">License</th>
            </tr>
          </thead>
          <tbody>
            {COMPONENTS.map((component) => (
              <tr key={component.name}>
                <td>
                  <a
                    href={component.packageUrl}
                    target="_blank"
                    rel="noreferrer"
                    data-interaction="licenses.external-link"
                  >
                    {component.name}
                  </a>
                </td>
                <td>{component.version}</td>
                <td>{component.license}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Radix Dialog provides Cadence&rsquo;s accessible project/replacement dialogs.
        </p>
      </div>

      <div className="acknowledgements-section" aria-labelledby={textsHeadingId}>
        <h3 id={textsHeadingId}>Full license texts</h3>
        <p>
          The full text of the GNU Lesser General Public License v3.0 and the GNU
          General Public License v3.0 (which it supplements) is reproduced in{' '}
          <a
            href={THIRD_PARTY_NOTICES_URL}
            target="_blank"
            rel="noreferrer"
            data-interaction="licenses.external-link"
          >
            THIRD-PARTY-NOTICES.md
          </a>
          . You can also read the canonical texts at{' '}
          <a
            href={LGPL_TEXT_URL}
            target="_blank"
            rel="noreferrer"
            data-interaction="licenses.external-link"
          >
            gnu.org/licenses/lgpl-3.0
          </a>{' '}
          and{' '}
          <a
            href={GPL_TEXT_URL}
            target="_blank"
            rel="noreferrer"
            data-interaction="licenses.external-link"
          >
            gnu.org/licenses/gpl-3.0
          </a>
          , or on the{' '}
          <a
            href={DOCS_ACKNOWLEDGEMENTS_URL}
            target="_blank"
            rel="noreferrer"
            data-interaction="licenses.external-link"
          >
            Cadence acknowledgements page
          </a>
          .
        </p>
        <p>
          The bundled typefaces are available under the{' '}
          <a href={OFL_TEXT_URL} data-interaction="licenses.external-link">
            SIL Open Font License 1.1
          </a>
          . Lucide&rsquo;s complete{' '}
          <a href={LUCIDE_LICENSE_URL} data-interaction="licenses.external-link">
            ISC and Feather MIT notices
          </a>{' '}
          are distributed with the app.
        </p>
      </div>
    </section>
  )
}

export default AcknowledgementsPage

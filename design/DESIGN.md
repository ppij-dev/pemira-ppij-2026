# PPIJ Pemilu design system

This is the implementation guide for the election app. It adapts the PPIJ identity project's `design/1.0.6/guideline.md` from its `task/1.0.7-design-system` worktree. That guide defines the shared visual direction. The election app uses Astro and local `src/components/ui/` components, so its component instructions here refer to those components instead of the identity portal's React and Radix implementation.

## Foundations

The source of truth for executable tokens is [`src/styles/global.css`](../src/styles/global.css). Use semantic utilities in product markup; keep brand swatches for branded accents and election artwork.

| Role | Token / utility | Value | Use |
| --- | --- | --- | --- |
| Brand action | `primary`, `bg-primary` | `#c8102e` | Main action, active focus and key links |
| Brand action hover | `primary-hover` | `#a50d26` | Hover on the main action |
| Page canvas | `background`, `bg-background` | `#f6f6f4` | Public and admin page background |
| Surface | `card`, `bg-card` | `#ffffff` | Cards, grouped forms and navigation |
| Main text | `foreground`, `text-foreground` | `#1c1f23` | Headings and body text |
| Supporting text | `muted-foreground` | `#5b6168` | Help, metadata and secondary labels |
| Border | `border` | `#e3e5e8` | Surface and control boundaries |
| Quiet interaction | `accent` | `#eceef0` | Hover and neutral selection backdrop |
| Error | `destructive` | `#b42318` | Errors and destructive actions only |

The PPIJ logo retains its own red. The darker interface red is chosen for readable white text. Candidate colors are a separate election data palette and must remain distinct and white-text safe; do not replace them with the brand action color.

The bundled default logo and favicon for this Pemira 2026 deployment are `public/pemira-2026-logo.png`. An operator may still set `SITE_LOGO_PATH` to another local asset. The legacy `/logo.svg` and `/ppi-okayama-logo.webp` settings resolve to the bundled Pemira logo for previously bootstrapped sites.

Typography uses locally hosted **Plus Jakarta Sans** at 400, 500, 600 and 700. The stack falls back to **Noto Sans JP** and then system sans for Japanese or unsupported glyphs. The font files and OFL license are in `public/fonts/`. Use `font-semibold` for section headings and action labels, `font-bold` sparingly for page titles and key figures, and `font-mono` only for receipt codes, hashes, countdowns and comparable fixed-width data.

Use the Tailwind spacing scale. Panels have `p-4` on phones and `sm:p-6` where space allows. Field groups use `gap-4` to `gap-6`; sections use `gap-6` to `gap-8`. The base corner radius is 10px; use the provided radius utilities rather than inventing a radius per page. Text and controls must remain usable at 320px and with long Indonesian names.

## Components and composition

- Reuse `src/components/ui/Button.astro`, `Card.astro` and `Badge.astro` for new Astro UI. Primary means the single main action in a form or panel. Secondary actions use the outlined button. Buttons and form controls are at least 44px tall.
- Put grouped forms and coherent status regions on a `bg-card` surface. Keep labels, help, errors and actions aligned to the same panel inset. Avoid nested cards; use a divider or spacing within one panel when content is related.
- Use semantic `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary` and `focus-visible:outline-ring` in new pages. Existing slate utilities can be migrated as their pages are touched; new UI should not add more raw slate or blue brand colors.
- Use Tabler icons only. Icons support a named action or state; they do not replace a text label. The mobile voter navigation stays fixed above the safe area. Admin navigation and forms must wrap without horizontal clipping.
- A normal save needs inline status. Failure needs a persistent inline error with a recovery step. Consequential actions need an explicit confirmation pattern with cancel and clear consequences. Never claim success before the server responds.
- Loading should keep the shell stable. Show a skeleton for initially unavailable content, retain existing content during refresh, and show a pending state on the initiating action. Do not add polling; election data refreshes manually.

## Election-specific rules

The vote flow must keep the candidate's number, nickname and color recognizable while preserving ballot secrecy. Receipt codes and hash proof use a fixed-width face and allow wrapping or scrolling without clipping. Color never carries stage or eligibility meaning alone. Status labels remain in Bahasa Indonesia: Draf, Terjadwal, Dibuka, Ditutup and Diumumkan. Public results remain hidden until publication and small regional counts remain suppressed as specified in OpenSpec.

Candidate portrait slots use a **3:4 aspect ratio** on the listing and profile page. The bundled 600×800 placeholder already has this ratio. Listing cards lead with a full-width portrait. A horizontal candidate-color number strip sits immediately below the photo at the same width; it is separate from the photo's 3:4 dimensions. Identity and introduction sit below the strip, with no empty side column. Cards use one column on phones and two columns from 640px so portraits remain large and readable. Listing cards use the existing light semantic border and standard radius, never heavy ink outlines or hard offset shadows. They show the nickname first, full name, human-readable unit, and the dedicated plain-text `short_intro` (at most 100 characters). This optional field is edited in Kandidat settings and appears only on cards; an empty value does not fall back to the article. The profile continues to show the full description. Separate Visi and Misi content and a full Markdown authoring input are later content-model work; do not show invented sections or accept rich content in the lean 1.0 flow.
Label missing photos honestly on the profile, and display the human-readable komsat name rather than its internal path.

Use Bahasa Indonesia first, with a friendly, helpful and secure tone. Error copy states what happened and the next action. Do not add copy that suggests a deferred 1.1 feature is active.

## Review checklist

For a new or changed component, inspect 320px and 390px phones, 768px tablet and desktop; keyboard focus; long names; error and pending states; and contrast on the actual surface. A successful build alone does not confirm the visual result. Keep the 1.0.6 identity guideline as a reference; this file and `global.css` define how that direction is implemented in the election app.

## Local preview

Run `npm run dev` and open `/dev/design-system/`. The navigation links to the kitchen sink, voter journey, Admin Voting workflows, and results/proof page. These routes use fictional data and have no API calls or writes. They return a 404 presentation outside Astro development mode. Use them to inspect shared primitives and page compositions before changing product screens; current product screens remain the behavior source of truth.

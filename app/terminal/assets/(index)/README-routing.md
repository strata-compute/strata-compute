# Why the list pages sit in a `(index)` route group

`loading.tsx` creates a Suspense boundary. Next.js commits the HTTP status as
soon as it starts streaming that boundary's fallback, which happens before the
page body runs — so a `notFound()` raised by the page renders the 404 *UI* but
the response has already gone out as `200`.

Detail routes must answer with a real 404 (`/app/assets/NOTAREAL`,
`/app/arena/99999`), because a wrong address is not a temporary gap in
coverage and must not look like one to a crawler, a monitor, or a link checker.

A `loading.tsx` placed directly at `app/app/assets/` would cover the sibling
`[symbol]` segment as well, since loading boundaries apply to a segment and
everything beneath it. Route groups are URL-transparent, so moving the list
page and its skeleton into `(index)/` scopes the boundary to the list alone:

    app/app/assets/(index)/page.tsx     ->  /app/assets   (skeleton, 200)
    app/app/assets/(index)/loading.tsx  ->  covers only the list
    app/app/assets/[symbol]/page.tsx    ->  /app/assets/:symbol (real 404)

The detail routes therefore have no `loading.tsx`. They are fast enough to
render without one, and a correct status code is worth more than a skeleton on
a page that is usually reached from a row that already showed the asset.

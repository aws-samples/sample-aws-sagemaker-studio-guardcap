# Admin console

Admin console for the SageMaker Studio GPU notebooks used by students: provisioning,
per-student AWS spend, and budget holds.

Built as a Next.js static export (`output: 'export'`) served from S3 behind CloudFront.
There is no server at runtime — auth happens in the browser and all data comes from the
admin HTTP API.

## Getting Started

```bash
npm run dev
```

Then open <http://localhost:5173>.

### Why port 5173 and not 3000

The dev script pins `-p 5173` on purpose. The admin HTTP API has a CORS origin
allowlist of exactly two entries:

```
https://<your-cloudfront-domain>
http://localhost:5173
```

An API Gateway HTTP API only emits `Access-Control-Allow-*` headers when the request's
`Origin` matches that list. From any other origin the preflight returns a bare `204`
with no CORS headers at all, the browser rejects it, and `fetch` fails before it ever
sees a status — so the console shows "Failed to fetch" rather than a `401` or a `403`,
which makes it look like a client bug when it is not.

5173 is the port the previous Vite app used, so it is already on both that allowlist and
the Cognito callback allowlist. Running on it needs no infrastructure change. The
alternative is to add `http://localhost:3000` to the API's CORS configuration and to the
Cognito allowed callback/sign-out URLs, and then this pin can be dropped.

## Environment

`.env.local` holds the API and Cognito coordinates. These are `NEXT_PUBLIC_*`, so they
are inlined into the bundle at **build** time and are public by definition — there is no
runtime configuration in a static export. Changing one means rebuilding.

## Known gaps

- **`GET /branding` does not exist** (the API returns `404`; there is no such route).
  The branding service therefore always falls back to the AWS default name, logo and
  favicon. The dynamic branding path is implemented and will work as soon as the route
  is added.
- A hard reload always returns to the sign-in screen: the id token is held in memory
  only. In production Cognito's own session cookie makes the round trip silent, but the
  gate is still shown for the click.

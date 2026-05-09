## Snooze Creator — web delivery UI

Responsive web companion for filmmakers: same OTP login pattern as Snooze plus title, poster/banner images, and the film upload.

### Before you install

Backend must allow uploads for this account (Django Admin → Users → Upload Permissions):

- Tick **can_upload_content**
- Add **approved_upload_platforms** entries (`SNOOZEIT`, `ANYME`)

### Environment

ngrok (and some other tunnels) show a browser interstitial. The app sends `ngrok-skip-browser-warning` on every request.

1. `.env` is ignored by git. Start from `.env.example` — your workspace already contains a populated `.env` pointing at ngrok until you swap the domain.
2. `VITE_API_BASE` must be the full origin, e.g. `https://captivative-stalkable-india.ngrok-free.dev` (no trailing slash).

### Run locally

```bash
cd shortfilm-portal
npm install
npm run dev
```

### Upload behaviour

- **Steady upload (checkbox, on by default)** asks the API for a multipart session: 16 MB segments (configurable server-side), each retried on transient failures, then the API calls S3 `CompleteMultipartUpload`. Best for long films or flaky networks.
- **Single-shot upload** is used when steady mode is off and the file is below the server threshold (~20 MB). Presigned URLs last longer for files **≥ ~40 MB**.

### Security notes

- Access tokens are kept in **sessionStorage** so closing the tab signs the browser out of the portal session.
- Never commit real secrets in `.env` if you add any later; `.env` is git-ignored by default.

### CORS / production

When `DEBUG=False`, Django only trusts `CORS_ALLOWED_ORIGINS`.

- Local Vite defaults (`http://localhost:5173`, `:5174`, and `127.0.0.1` variants) are whitelisted.
- For any extra host (hosted portal, staging), set env on the backend:

```
EXTRA_CORS_ORIGINS=https://your-portal.example.com,http://localhost:5174
```

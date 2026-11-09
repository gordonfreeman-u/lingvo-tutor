# Lingvo Tutor

A personal English ↔ German vocabulary trainer. PWA — works on mobile, tablet and desktop.

## Deploy in 5 minutes

### 1. Prerequisites
- [Node.js](https://nodejs.org/) 18+
- A free [Cloudflare account](https://dash.cloudflare.com/sign-up)

### 2. Install dependencies
```bash
cd lingvo-tutor
npm install
```

### 3. Authenticate with Cloudflare
```bash
npx wrangler login
```
This opens a browser — approve the request.

### 4. Create the R2 bucket
```bash
npx wrangler r2 bucket create lingvo-tutor-data
```

### 5. Set your password
```bash
npx wrangler secret put AUTH_PASSWORD
```
Type the password you want and press Enter.

### 6. Upload starter words
```bash
npm run seed
```

### 7. Deploy
```bash
npm run deploy
```

Wrangler prints your app URL (something like `https://lingvo-tutor.<your-subdomain>.workers.dev`). Open it on your phone, log in, and add to home screen for the full-screen PWA experience.

## Usage

- **Quiz:** Pick a direction (EN→DE, DE→EN, or mixed). Type the translation. 5 correct answers in a row marks a word as learned.
- **Word list:** Add words manually or import a CSV file.
- **CSV format:** `id,en,de,…,notes` — `en` and `de` support multiple accepted translations separated by `;` (e.g. `danke;danke schön`). `notes` is optional free text (may span several lines, quoted) shown after you answer; it is never checked.
- **Paste from Claude:** Word list → ＋ → paste an answer shaped like the one below. The first line becomes the German word, the `English Translation:` line becomes the accepted answers (split on `/`), and everything after it becomes the notes. Pasting a word that already exists updates it and keeps your progress. Tap any word in the list to edit it.

  Prompt to get that shape: *Explain the German word "___". Line 1: the word alone. Line 2: `English Translation: "a" / "b" / "c"`. Then sections Explanation, Common Uses (German example, English translation in quotes on the next line), Grammar Note.*
- **Export:** Download your full word list as CSV from the word list screen.

## Update the app

Edit the code, then:
```bash
npm run deploy
```

Your word data in R2 is untouched — only the app code changes.

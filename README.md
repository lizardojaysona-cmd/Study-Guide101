# 📚 Study Guide

A zero-build, static web app that turns your notes into flashcards and quizzes, tracks your scores, and finds your weak spots. Everything runs in the browser; files never leave your device and progress is stored in `localStorage`.

## Features
- **Upload** PDF, DOCX, JPG/PNG, TXT/MD (or paste text). Scanned PDFs and images are read with OCR (Tesseract.js).
- **Key-term detection**: PDF highlight annotations, Word highlights, bold/italic/underline, and coloured marker highlights in images are prioritised; frequent terms fill the gaps.
- **Cards**: fill-in-the-blank cards from key sentences and "What is X?" definition cards.
- **Flashcards** (flip, self-rate) and **multiple-choice quizzes** with auto-generated distractors.
- **Smart practice**: cards you miss, or haven't seen recently, are shown more often. Mastered cards fade back.
- **Progress**: overall accuracy, score history, trend, weak topics (accuracy < 70% over 2+ tries), strongest topics, and a one-tap "Practice weak spots" quiz.

## Run locally
Open `index.html`, or serve it: `python3 -m http.server` then visit http://localhost:8000.

## Deploy on GitHub Pages
```bash
git init && git add . && git commit -m "Study Guide"
git branch -M main
git remote add origin https://github.com/<you>/study-guide.git
git push -u origin main
```
Then in the repo: **Settings → Pages → Source: GitHub Actions**. The included workflow publishes the site on every push to `main`.

## Notes
- Libraries load from cdnjs (pdf.js, mammoth, Tesseract.js), so an internet connection is needed on first load.
- OCR highlight detection recognises coloured highlighter ink (yellow, green, pink…), not dark underlines.
- Card quality depends on how sentence-like the source is; highlight your key terms for best results.

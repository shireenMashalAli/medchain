# Regenerating MedChain_Submission.pdf

These scripts drive the running app in headless Chrome, capture each step with the live ledger, and build the PDF from the screenshots and the real ledger data.

```bash
# 1. start the app in another terminal: npm run dev -- -p 3100
cd docs/report-tools
npm init -y && npm i puppeteer-core@23.11.1
node capture.mjs                                   # writes out/*.png and out/data.json
node build_report.mjs ../MedChain_Submission.pdf   # builds the PDF
```

`capture.mjs` uses http://localhost:3100 and Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`; change those two values if yours differ. Capturing starts from a fresh demo state in Chrome's own profile, so it does not touch the data in your normal browser.

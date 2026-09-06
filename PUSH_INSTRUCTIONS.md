# Pushing to amitsoni-ai/PromptLibrary

Two files are in this folder: `index.html` (the app) and `vercel.json` (enables clean URLs on Vercel).
Your repo already has a few unrelated files in it (loose prompt text files, an "80" folder) — leave those alone, these two just sit alongside them.

From a terminal on your machine, with git installed:

```bash
git clone https://github.com/amitsoni-ai/PromptLibrary
cd PromptLibrary
cp /path/to/index.html .
cp /path/to/vercel.json .
git add index.html vercel.json
git commit -m "Add Prompt Intelligence Library app for Vercel deployment"
git push origin main
```

That's it — once it's pushed, go to vercel.com, "Add New Project," import `amitsoni-ai/PromptLibrary`, and deploy. Vercel will pick up `index.html` at the root automatically.

# Wingo Last 10 AI — Render deploy

A standalone Node.js web app. The prediction calculation uses only the latest 10 normalized records from the upstream WinGo_30S history endpoint. It does not modify the existing Replit project.

## Deploy
1. Create a GitHub repository named `wingo-last10-ai`.
2. Upload the *contents* of this folder to the repository root (not the ZIP file itself).
3. In Render, select **New + → Web Service**, then connect that GitHub repository.
4. Use build command `npm install` and start command `npm start`. Runtime is Node.
5. Deploy and open the Render URL.

## Notes
- The app tries `draw.ar-lottery06.com` and then `draw.ar-lottery01.com` for the public history JSON route. If the source blocks Render or changes its response, live data will fail until the source is updated.
- Refresh is automatic every 30 seconds.
- Accuracy records are saved to a local JSON file when the host filesystem permits. Free Render filesystems may be ephemeral; a persistent disk or external database is needed for reliable long-term statistics.
- The heuristic is not proof the next outcome is predictable. “Confidence” is sample frequency, not a calibrated probability.
- Outcome matching assumes numeric issue IDs increase by 1. If the source uses another sequence, the settlement logic must be adjusted.

# Privacy

Winsle runs entirely on your PC. There is no telemetry, no analytics and no account.

## What is stored

| Data | Where | Notes |
|---|---|---|
| Preferences | `%APPDATA%\Winsle\settings.json` | No secrets |
| API keys, calendar link | Windows Credential Manager | The island can only ask whether a key exists, never read it |
| Clipboard history, focus stats, finished downloads, muted apps | WebView2 local storage | Can be cleared from Settings |
| Quick capture | `inbox.md` | Plain Markdown, your folder |
| Log | `%LOCALAPPDATA%\Winsle\winsle.log` | Event names and errors, no content |

## What leaves the PC

Only requests you set up yourself:

- The calendar feed you link.
- The integrations you enable (Resend, n8n, Vercel, GitHub), with your own keys.
- The chat, when you use it, sends your question to the Claude API with your key.

## Clipboard

Only text is read, never images or files. Text that looks like a key, token or hash (`sk-…`, `ghp_…`, JWTs, long random strings) is ignored. History can be turned off entirely.

## Claude Code settings

Winsle only writes `~/.claude/settings.json` after you review the diff, and refuses if the file changed in between. A backup is made first.

# Pie-Boy

A Pip-Boy-style terminal UI for Pi Coding Agent.

## Installation

```bash
pi install git:github.com/ZenkakuHiragana/pie-boy
```

## Controls (defaults)

- Alt+O: Switch focus between the panels and chat input.
- Alt+J / Alt+K: Next / previous primary tab.
- Alt+H / Alt+L: Previous / next inner tab.
- Alt+1–6: Open a primary tab:
  - 1: TERM
  - 2: STAT
  - 3: INV
  - 4: DATA
  - 5: MAP
  - 6: RADIO

## Features

### TERM

- CHAT: The conversation, with optional thinking and tool-log panels.
- LOG: Tool execution history.

<img width="1325" height="766" alt="image" src="https://github.com/user-attachments/assets/81bc6ca1-5a59-431f-8bfd-460f7c06b828" />

### STAT

The agent's status: context usage, cache hit rate, 5-hour and weekly limits,
and response history.

<img width="1325" height="766" alt="image" src="https://github.com/user-attachments/assets/0a9a6b1a-e60e-4806-8f6a-0d5b466b0ff2" />

<img width="1325" height="766" alt="image" src="https://github.com/user-attachments/assets/cda78e9f-47d9-4f9b-ab3a-84cc16f01d11" />

### INV

Inspect the agent's context and capabilities.

- PROMPT: System prompt and context breakdown.
- TOOLS: Tool definitions, including MCP and extension tools.
- SKILLS: Skill definitions.

<img width="1325" height="766" alt="image" src="https://github.com/user-attachments/assets/a3acc9e6-97b0-4f7a-bb72-e4c121aa5d77" />

<img width="1325" height="766" alt="image" src="https://github.com/user-attachments/assets/08ab93ee-778f-4e23-bfed-b6ef25b0cdd1" />

### DATA

- QUEST: A local TODO list, disabled by default. See [QUEST](#quest).
- GIT: Diffs and commit history.
- MODELS: Browse and switch models, like `/model`.
- EXTENSIONS: Loaded extensions.

<img width="1325" height="766" alt="image" src="https://github.com/user-attachments/assets/6ad4e938-0b4c-42ef-9882-3705e385ab3e" />

### MAP

- TREE: Browse the conversation tree and preview messages, like `/tree`.
- SESSIONS: Browse and resume saved sessions, like `/resume`.

<img width="1325" height="766" alt="image" src="https://github.com/user-attachments/assets/5bb92f30-3efe-45ed-bd0f-10645cf00c63" />

### RADIO

Play music from YouTube, powered by [distubejs/ytdl-core](https://github.com/distubejs/ytdl-core).

- STATIONS: Saved stations from `pie-boy/radio.json` in Pi's agent directory.
- SEARCH: Find songs and playlists on YouTube Music to play or save.
- OUTPUT: Choose an audio output device.

<img width="1325" height="766" alt="image" src="https://github.com/user-attachments/assets/8595c4a2-672b-43db-800b-8358b895b5e8" />

## Customization

### Configuration

Create `pie-boy/config.json` in Pi's agent directory (`~/.pi/agent` by default),
then run `/reload`. For example, this enables QUEST and renders STAT images as text:

```json
{
  "quest": { "enabled": true },
  "stat": { "kitty": false }
}
```

Omitted settings keep their defaults.

| Setting | Default | Description |
| --- | --- | --- |
| `stat.art` | `"auto"` | [Custom images](#stat-images) with a built-in logo fallback. Use `"pixel-art"` for the built-in logo only, or `"off"` to hide the logo. |
| `stat.kitty` | `true` | Use Kitty graphics when supported. Set to `false` to render the same images with text characters. |
| `radio.enabled` | `true` | Enable RADIO and audio playback. |
| `chat.thinking` | `true` | Show THINKING in TERM > CHAT. |
| `chat.toolLog` | `true` | Show the tool log in TERM > CHAT. TERM > LOG remains available. |
| `quest.enabled` | `false` | Enable DATA > QUEST and the agent's TODO instructions. |

Disabled features skip loading and initializing their dedicated modules.
Invalid settings prevent Pie-Boy from loading.

### QUEST

QUEST uses `pie-boy/TODO.md` in Pi's agent directory. Enabling it creates the file
if needed and gives the agent instructions to maintain it through bash. New
files include editing rules.

### Keybindings

Add `keybindings` to `pie-boy/config.json` to change Pie-Boy's shortcuts:

```json
{
  "keybindings": {
    "pieBoy.focus.toggle": ["alt+o", "alt+i"],
    "pieBoy.panel.maximize": []
  }
}
```

The format follows Pi's `keybindings.json`: a key string or array replaces an
action's default keys, and `[]` removes its keyboard shortcuts. Omitted actions
keep their defaults. See [keybindings.ts](keybindings.ts) for all action IDs and
default keys.

Pi's own bindings, such as scrolling and text editing, still use Pi's
`keybindings.json`.

### STAT images

Place animated GIF or WebP files in `pie-boy/assets` in Pi's agent directory to
customize the STAT logo. These files are used when `stat.art` is `"auto"`.

- `logo.*`: Fallback image.
- `logo-standby.*`: Idle.
- `logo-tool.*`: Running a tool.
- `logo-done.*`: Work finished while the conversation was out of view.
- `logo-error.*`: Briefly shown after a tool fails while the agent is working.
- `logo-thinking.*`: Thinking.

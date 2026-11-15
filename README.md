# Pie-Boy

Pip-Boy TUI for Pi Coding Agents.

## Installation

```bash
pi install git:github.com/ZenkakuHiragana/pie-boy
```

## Control

- Alt+O: Switch focus between tab control and the main chat input
- Alt+H/J/K/L: Swtich tabs
  - J: Switch primary tab to the next
  - K: Switch primary tab the previous
  - H: Switch secondary tab to the left
  - L: Switch secondary tab to the right
- Alt+1/2/3/4/5/6: Switch to specific primary tab
  - 1: TERM
  - 2: STAT
  - 3: INV
  - 4: DATA
  - 5: MAP
  - 6: RADIO

## Features

### TERM

The main terminal to see the conversation.

- CHAT: the main conversation screen
- LOG: tool execution logs

### STAT

The agent's status monitor.

- Context usage
- Cache hit rate
- 5-hour limit
- Weekly limit
- Context growth in detail
- and so on

### INV

The agent's inventory.

- PROMPT: system prompt and context breakdown
- TOOLS: tool definition including MCP and additional tools from extensions
- SKILLS: skill definition

### DATA

Miscellaneous things.

- GIT: git diff and commit history
- MODELS: list of models, basically same as `/model`
- EXTENSIONS: list of extensions loaded

### MAP

- TREE: basically same as `/tree` but you can see full prompt and the response at a glance
- SESSIONS: basically same as `/resume` but shows faster

### RADIO

True radio functionality powered by [distubejs/ytdl-core](https://github.com/distubejs/ytdl-core).

- STATIONS: registered radio stations from `~/.pi/agent/pie-boy/radio.json`
- SEARCH: search YouTube Music and YouTube playlists by keywords to play/register the results
- OUTPUT: audio device selection panel

## Customization

### STAT images

You can put animated GIF or WEBP into `~/.pi/agent/pie-boy/assets` to customize the STAT panel.

- `logo.*`: fallback image
- `logo-standby.*`: idle
- `logo-tool.*`: when executing tool
- `logo-done.*`: when the agent finished working and you don't see the TERM yet
- `logo-error.*`: when a tool execution failed
- `logo-thinking.*`: when the agent is thinking/reasoning

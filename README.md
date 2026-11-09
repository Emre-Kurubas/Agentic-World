# Agent World

A turn-based politics simulation in which AI characters run countries in a fictional world. You watch.

## Running

Requires Node.js 20 or newer and a signed-in Claude Code.

The easiest way is to double-click the **Agent World** shortcut on the desktop. The game starts, the panel opens in its own window, and closing the window stops the game so it can resume where it left off. If the shortcut is deleted, recreate it with `powershell -File kisayol-olustur.ps1`.

From a terminal:

```
cd Desktop\ajan-dunyasi
node run.js
```

Then open `http://localhost:4173` in a browser. The game runs until you stop it. To stop it use the **Pause game** button in the panel. If you close it with Ctrl+C, the next `node run.js` continues from the last turn.

To try the panel without using Claude: `node run.js --backend mock --name demo --delay 1500`

## Which characters are AI

Every country has a leader, a general, an opposition and an oligarch. The ones you do not select are not removed from the world; they play by rules and can still stage a coup or betray someone.

```
node run.js --roles leader
node run.js --roles leader,general
```

To make it permanent, change the `agentRoles` list in `config.json`. For per-country settings: `"countryAgentRoles": { "U1": ["leader"], "U2": ["leader", "general"] }`.

## Settings (`config.json`)

- `maxTurns`: 0 means unlimited.
- `wakeEvery`: how often, at the latest, AI secondary characters wake up (in turns).
- `wakeTension`: above this tension value secondary characters wake every turn.
- `maxLookupRounds`: how many times a character can look up information per turn. Each lookup round is one agent call.
- `negotiationRounds`: how many rounds of talks can happen within a quarter. With 0, messages wait for the next quarter. Each round is one call for every AI character who received a message.
- `models`: which Claude model plays whom. `cast` is a list dealt round the characters, so with `["opus", "sonnet", "haiku"]` every country hears all three and every role is played by each model somewhere; a person keeps their model for life. `assign` pins a model to a person, a seat or a role (`{"U2.general": "opus", "opposition": "haiku"}`). With an empty `cast`, `leader` is used for rulers and `secondary` for everyone else. `referee` is the model of the impartial referee. From the command line: `node run.js --cast opus,sonnet,haiku` or `--cast none`. Opus characters use the subscription limit much faster than Haiku ones.
- `concurrency`: how many agents run at once.
- `saveDir`: if empty, saves are written outside OneDrive under `your user folder\ajan-dunyasi-kayitlar`.

To start over: `node run.js --new`. This deletes the save with the same name.

## What the characters can do

Anything. Each one is told at the start that they have an ego of their own and that nothing is forbidden: war, coups, prisons, executions and massacres are as open to them as peace and reform, and the world answers only with consequences. They write decisions in free text; an impartial referee turns them into engine operations and does not soften them. People fall ill, are wounded, die, are jailed, exiled or executed; a jailed or exiled AI character goes on playing with what little a prisoner or an exile can do. When someone dies or falls, the next person takes the seat by the country's own rule of succession and, if that seat is played by AI, arrives as a new AI character.

## Files

- `engine/`: world model, economy, military, politics, operations
- `agents/`: character and referee prompts, rule-based players, turn flow, saving
- `panel/`: the viewing screen. The **Ledger** tab keeps everything searchable, the **People** tab gives a timeline per character
- `agents/queries.js`: the information characters can look up and its access limits
- `tests/realism.js`: realism and system checks (`node tests/realism.js`)
- `tools/export.js`: exports a finished game into a `video-source` folder for a video-making AI (`node tools/export.js <save-name>`)

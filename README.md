# EMBERLINE

A 5v5 tactical FPS in three.js, built for the make.fun `threejs-fps-01` bounty.

You are Ember, attacking the Emberworks foundry with four bot teammates
against five Slate defenders. Plant the Spark at the Furnace (Site A) or the
Crane Yard (Site B) — or eliminate the whole defending team. First to 8
rounds takes the match. Money earned each round buys rifles, SMGs, a sniper,
a shotgun and grenades between rounds.

## Play

```sh
node serve.ts
# open http://localhost:8080
```

WASD move, mouse look, click fire, R reload, Ctrl/C crouch, Space jump,
1–5 weapons, 4/5/6 select grenade + G throw, B buy menu, E hold to plant
or defuse.

## Screenshots

Deterministic captures (`seed=1`): `?shot=start`, `?shot=play`, `?shot=buy`,
`?shot=end` — see `shots.json`.

## Layout

- `game/` — the game (static ES modules, three.js 0.187.0 vendored)
- `game/src/` — one module per job: world, player, weapons, bots, rounds,
  economy, objective, grenades, audio, effects, characters, hud
- `screenshots/` — the four captures
- `main.ts` — entrypoint: copies game/ + screenshots/ to /output and
  writes /output/dossier.json
- `serve.ts` — local static server

## License

MIT — see LICENSE.

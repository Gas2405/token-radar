# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Gas2405/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Gas2405/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. It reads one sealed snapshot of the protocol universe (DefiLlama data, frozen as of 2026-11-14) and ranks the protocols that record no token yet by an implied value: what a token would be worth if it were issued today on the protocol's current record. Every row carries a concrete farm plan — the actions, what they cost in dollars, and how long they take.

The value model borrows the market's own arithmetic instead of guessing. For each protocol whose token already trades, the snapshot gives a realised market-cap/TVL ratio. A pre-token protocol is valued at the ratio its category's tokens actually trade at: the category median of winsorised realised ratios (clamped to [0.01, 10] before any median is taken, so one protocol whose market cap dwarfs its recorded TVL cannot drag its category), shrunk toward the overall median by the category's head count (so a category with two members cannot dominate) and clamped to a sane band. That base is then adjusted by a momentum factor from the protocol's 7-day TVL change and a maturity factor from how long it has run with no token:

```
implied = round(TVL × category ratio × momentum × maturity)
```

Protocols whose token already trades are never ranked — they are the yardstick, and the dashboard shows them separately at the market's own numbers. Centralised exchanges and versioned pools of another protocol are excluded by rule; every other pre-token protocol is ranked, the snapshot's 40-protocol watchlist first among equals. No protocol name is special-cased anywhere in the code.

The dashboard is a single offline page: a sortable, filterable board (search, category, chain, watchlist-only), a detail view per protocol that shows the model's own inputs and the farm plan, and an "Already trading" view of the yardstick set. Detail views are deep-linkable (`#p=<slug>`), as is a category filter (`#f=<category>`).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=9v18ghw6&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

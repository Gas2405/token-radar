// Token Radar's value model: one sealed snapshot in, one ranked board out.
//
// The board ranks protocols that record no token yet. Its implied value is not a guess pinned to a
// name: it is the market's own arithmetic, borrowed from the protocols in the same snapshot whose
// tokens already trade. For every tokenised protocol the snapshot gives a market cap and a TVL, so
// it gives a realised mcap/TVL ratio. A pre-token protocol is then valued as if its token, issued
// today on today's record, traded at the ratio its category's tokens actually trade at:
//
//   ratio(cat)  = the category's median realised mcap/TVL, shrunk toward the overall median
//                 by the category's head count, then clamped to a sane band. Realised ratios
//                 are winsorised first, so one protocol whose market cap dwarfs its recorded
//                 TVL (a prediction market at 400x) cannot drag its whole category with it.
//   momentum    = a clamped read of the protocol's 7-day TVL change
//   maturity    = a rising function of how long the protocol has run with no token
//   implied     = round( tvl_usd x ratio(cat) x momentum x maturity )
//
// Protocols whose token already trades are never ranked: they are the yardstick, and the dashboard
// shows them apart, at the market's own numbers. No protocol name is special-cased anywhere; the
// same functions score every row, and the exclusions (centralised exchanges, and versioned pools of
// another protocol) are rules over the snapshot's own category and name fields.

/** One protocol of the sealed snapshot: exactly the ten fields the input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated on the dashboard so a reader can rerun the arithmetic. */
export interface ModelConstants {
  shrink_k: number;
  winsor_lo: number;
  winsor_hi: number;
  ratio_floor: number;
  ratio_cap: number;
  momentum_weight: number;
  momentum_min_change: number;
  momentum_max_change: number;
  momentum_floor: number;
  momentum_cap: number;
  maturity_base: number;
  maturity_span: number;
  maturity_horizon_days: number;
}

export const MODEL: ModelConstants = {
  shrink_k: 6,
  winsor_lo: 0.01,
  winsor_hi: 10,
  ratio_floor: 0.02,
  ratio_cap: 2.5,
  momentum_weight: 0.6,
  momentum_min_change: -50,
  momentum_max_change: 100,
  momentum_floor: 0.4,
  momentum_cap: 1.6,
  maturity_base: 0.65,
  maturity_span: 0.35,
  maturity_horizon_days: 1460,
};

export const MODEL_VERSION = 'radar-ratio-1';

/** How many already-trading protocols the dashboard's yardstick view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One board row: the ranked claim, the inputs it came from, and the farm plan. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_ratio: number;
    category_peers: number;
    momentum_factor: number;
    maturity_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A protocol whose token already trades: shown at the market's own value, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
  change_7d: number | null;
}

/** The dashboard's copy of one board row (data.js), farm plan included. */
export interface BoardDataRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  category_ratio: number;
  category_peers: number;
  momentum_factor: number;
  maturity_factor: number;
  farm_steps: string[];
}

/** Everything data.js carries: the board, the yardstick set, and the model stated in full. */
export interface BoardData {
  meta: {
    as_of: string;
    source: string;
    floor_usd: number;
    protocols_scanned: number;
    tokenized_count: number;
    board_size: number;
    watchlist_size: number;
    model_version: string;
    overall_ratio: number;
    model: ModelConstants;
  };
  rows: BoardDataRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a non-empty list, computed on a sorted copy so the input order never matters. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days from `listedAt` to `asOf`, never negative; null when a date is missing or unreadable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol records a token when the snapshot carries a market cap for it. */
export function isTokenized(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null;
}

/** A protocol records no token when all three token fields are empty. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version marker: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * Whether the board may rank a protocol: it records no token, it is not a centralised exchange
 * (an exchange's own token is a different question, and the house's watchlist rule excludes them
 * too), and it is not a versioned pool of a protocol that already has its row.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The realised mcap/TVL ratios of the snapshot's tokenised protocols, overall and per category. */
export interface RatioTable {
  overall: number;
  byCategory: Map<string, { peers: number; median: number; ratio: number }>;
}

/** Build the ratio table: winsorised category medians, shrunk toward the overall median, clamped. */
export function ratioTable(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): RatioTable {
  const tokenized = protocols.filter((p) => isTokenized(p) && p.tvl_usd > 0);
  const realised = (p: SnapshotProtocol): number => clamp(p.mcap_usd! / p.tvl_usd, model.winsor_lo, model.winsor_hi);
  const overall = tokenized.length > 0 ? median(tokenized.map(realised)) : 0;
  const groups = new Map<string, number[]>();
  for (const p of tokenized) {
    if (p.category === null) continue;
    const list = groups.get(p.category) ?? [];
    list.push(realised(p));
    groups.set(p.category, list);
  }
  const byCategory = new Map<string, { peers: number; median: number; ratio: number }>();
  for (const [category, ratios] of groups) {
    const med = median(ratios);
    const shrunk = (ratios.length * med + model.shrink_k * overall) / (ratios.length + model.shrink_k);
    byCategory.set(category, { peers: ratios.length, median: med, ratio: clamp(shrunk, model.ratio_floor, model.ratio_cap) });
  }
  return { overall, byCategory };
}

/** The ratio one protocol is valued at: its category's shrunk ratio, or the overall median. */
export function ratioFor(p: SnapshotProtocol, table: RatioTable, model: ModelConstants = MODEL): { ratio: number; peers: number } {
  if (p.category !== null) {
    const entry = table.byCategory.get(p.category);
    if (entry !== undefined) return { ratio: entry.ratio, peers: entry.peers };
  }
  return { ratio: clamp(table.overall, model.ratio_floor, model.ratio_cap), peers: 0 };
}

/** The age the model assumes when a protocol's listing date is unrecorded: the snapshot's median. */
export function defaultAgeDays(snapshot: Snapshot): number {
  const ages = snapshot.protocols.map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null);
  return ages.length > 0 ? Math.round(median(ages)) : 365;
}

/** The three factors and the implied value one protocol gets under the model. */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  table: RatioTable,
  fallbackAge: number,
  model: ModelConstants = MODEL,
): { implied: number; ratio: number; peers: number; momentum: number; maturity: number; age: number | null } {
  const { ratio, peers } = ratioFor(p, table, model);
  const change = clamp(finite(p.change_7d, 0), model.momentum_min_change, model.momentum_max_change);
  const momentum = clamp(1 + (change / 100) * model.momentum_weight, model.momentum_floor, model.momentum_cap);
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? fallbackAge;
  const maturity = model.maturity_base + (clamp(ageForModel, 0, model.maturity_horizon_days) / model.maturity_horizon_days) * model.maturity_span;
  const implied = clamp(Math.round(p.tvl_usd * ratio * momentum * maturity), 1, 100_000_000_000_000);
  return { implied, ratio, peers, momentum, maturity, age };
}

/**
 * The ranked board: every watchlist slug (the floor), plus every other rankable pre-token
 * protocol, strongest implied value first. Ranks are exactly 1..N and values never rise.
 */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const table = ratioTable(snapshot.protocols, model);
  const fallbackAge = defaultAgeDays(snapshot);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, table, fallbackAge, model) }));
  scored.sort(
    (a, b) =>
      b.s.implied - a.s.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    watchlist: watch.has(p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_ratio: round4(s.ratio),
      category_peers: s.peers,
      momentum_factor: round4(s.momentum),
      maturity_factor: round4(s.maturity),
      age_days: s.age,
    },
    farm_steps: farmSteps(p, s.age),
  }));
}

/** The already-trading yardstick: tokenised protocols by market cap, at the market's own numbers. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => isTokenized(p) && p.tvl_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      ratio: round4(p.mcap_usd! / p.tvl_usd),
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, derived from the same board board.json carries. */
export function buildData(snapshot: Snapshot, board: BoardRow[], model: ModelConstants = MODEL): BoardData {
  const table = ratioTable(snapshot.protocols, model);
  return {
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      protocols_scanned: snapshot.protocols.length,
      tokenized_count: snapshot.protocols.filter(isTokenized).length,
      board_size: board.length,
      watchlist_size: snapshot.watchlist.length,
      model_version: MODEL_VERSION,
      overall_ratio: round4(table.overall),
      model,
    },
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      watchlist: r.watchlist,
      implied_value_usd: r.implied_value_usd,
      category_ratio: r.model.category_ratio,
      category_peers: r.model.category_peers,
      momentum_factor: r.model.momentum_factor,
      maturity_factor: r.model.maturity_factor,
      farm_steps: r.farm_steps,
    })),
    live: liveRows(snapshot),
  };
}

// ---------------------------------------------------------------------------
// Farm plans. Every step names an action, a cost in dollars and a time. The
// wording is chosen by the protocol's own category and chains, and the figures
// (capital, gas, hold) by its TVL, its chains and its age: two protocols in
// different categories, or on different chains, get different plans.
// ---------------------------------------------------------------------------

/** A rough one-transaction gas cost in dollars for a chain, from the chain's name. */
function gasForChain(chain: string): number {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 9;
  if (c.includes('solana')) return 0.3;
  if (c.includes('bsc') || c.includes('bnb')) return 0.8;
  if (c.includes('arbitrum')) return 0.7;
  if (c === 'base' || c.includes('base')) return 0.5;
  if (c.includes('optimism')) return 0.6;
  if (c.includes('polygon') || c.includes('matic')) return 0.4;
  if (c.includes('avalanche')) return 0.9;
  if (c.includes('zksync')) return 0.5;
  if (c.includes('linea')) return 0.6;
  if (c.includes('scroll')) return 0.6;
  if (c.includes('mantle')) return 0.4;
  if (c.includes('tron')) return 1.2;
  if (c.includes('bitcoin')) return 2.5;
  return 1.5;
}

/** The capital one farm position carries, scaled to the protocol's own TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  return 50;
}

/** How long positions must sit: younger protocols are given the longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 75;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

interface CategoryPlay {
  core: (name: string, chain: string, capital: number) => string;
  deepen: (name: string, chain: string) => string;
  weekly: string;
}

const lendPlay: CategoryPlay = {
  core: (name, chain, capital) => `Supply $${capital} of USDC as collateral in ${name}'s lending app on ${chain} and leave the loan market position open.`,
  deepen: (name) => `Borrow about 40% of the collateral's value in the chain's main stablecoin inside ${name} and re-supply it once, keeping the loan-to-value under 50% so one bad day cannot liquidate you.`,
  weekly: 'top the collateral up by $25, or repay and re-borrow a small slice of the loan',
};

const dexPlay: CategoryPlay = {
  core: (name, chain, capital) => `Add $${capital} of liquidity to ${name}'s deepest stablecoin pool on ${chain}, half USDC and half the paired asset, from the pool page.`,
  deepen: (name) => `Stake the LP position in ${name}'s farm or gauge page, so the same liquidity also earns whatever the farm pays and the wallet shows as a staker, not only a provider.`,
  weekly: 'collect the accrued swap fees and re-deposit them into the same pool',
};

const bridgePlay: CategoryPlay = {
  core: (name, chain, capital) => `Bridge $${capital} of USDC through ${name} to ${chain} and leave the funds working on the far side instead of bridging straight back.`,
  deepen: (name) => `A week later, bridge a second, smaller amount back the other way through ${name}, so the wallet carries volume in both directions and on two routes if it offers them.`,
  weekly: 'move about $25 across one more route the bridge supports',
};

const stakingPlay: CategoryPlay = {
  core: (name, chain, capital) => `Stake $${capital} of the chain's native asset through ${name} on ${chain} and hold the liquid receipt token in the same wallet.`,
  deepen: (name) => `Deposit the receipt token into a partner money market or vault that ${name} lists, so one stake is counted by two protocols at once.`,
  weekly: 'claim the staking rewards and restake them into the same position',
};

const perpsPlay: CategoryPlay = {
  core: (name, chain, capital) => `Deposit $${capital} of USDC as margin in ${name} on ${chain} and open one small hedged position: a long and a short of equal size on the same market.`,
  deepen: (name) => `Put a further deposit into ${name}'s own liquidity or vault side, so the account also earns from the venue's fees and not only from trading.`,
  weekly: 'roll the hedge once, closing both legs and reopening them the same size',
};

const yieldPlay: CategoryPlay = {
  core: (name, chain, capital) => `Deposit $${capital} of USDC into the flagship vault of ${name} on ${chain} and keep the vault shares in the wallet.`,
  deepen: (name) => `Split a second deposit into a different ${name} vault or strategy, so the wallet shows a range of use rather than one deposit.`,
  weekly: 'harvest the vault rewards and compound them back into the position',
};

const stablePlay: CategoryPlay = {
  core: (name, chain, capital) => `Mint $${capital} of ${name}'s stable asset against USDC in its app on ${chain} (or buy it there) and hold the minted balance.`,
  deepen: (name) => `Supply half of the minted stablecoin to the lending market ${name} points to, so the holding earns while it sits.`,
  weekly: 'mint or redeem a small $25 slice, so the wallet keeps using the mint path',
};

const rwaPlay: CategoryPlay = {
  core: (name, chain, capital) => `After the eligibility check in its app, mint $${capital} of ${name}'s tokenised real-world asset on ${chain} and hold it in the wallet.`,
  deepen: (name) => `Place the asset in a savings or collateral product that ${name} lists as a partner, if one is open to your wallet.`,
  weekly: 'open the asset page and claim the period yield payout when it lands',
};

const launchpadPlay: CategoryPlay = {
  core: (name, chain, capital) => `Fund the wallet with $${capital} and take part in one live sale or staking round on ${name}, following the round's own page.`,
  deepen: (name) => `Stake the amount ${name}'s tier page asks for and leave it staked for one full round, so the wallet qualifies at that tier.`,
  weekly: 'enter one more round, or claim the allocation of a round that has finished',
};

const predictionPlay: CategoryPlay = {
  core: (name, chain, capital) => `Fund $${capital} and take one position in ${name}'s most liquid market on ${chain}, sized so a total loss is acceptable.`,
  deepen: (name) => `Add a second position in a different market category on ${name}, so the account is not a single bet.`,
  weekly: 'settle one finished market and roll the proceeds into a new position',
};

const insurancePlay: CategoryPlay = {
  core: (name, chain, capital) => `Buy $${capital} of cover from ${name} on ${chain} for a position you actually hold elsewhere, and keep the policy until it expires.`,
  deepen: (name) => `If ${name} offers a capital-pool side, stake a modest amount there too, kept separate from the cover you bought.`,
  weekly: 'check the policy page once and note the remaining days of cover in the farm log',
};

const chainPlay: CategoryPlay = {
  core: (name, chain, capital) => `Bridge $${capital} of USDC onto the ${name} network and make the wallet's first swaps and transfers there.`,
  deepen: (name) => `Use two native apps on the chain, a DEX and a lending market, so the wallet shows real usage and not bridge-only traffic.`,
  weekly: 'make two or three small transactions on the chain, on different days',
};

const nftPlay: CategoryPlay = {
  core: (name, chain, capital) => `Trade on ${name} with $${capital} of volume: buy one listed NFT on ${chain} and sell one, so the account shows both sides.`,
  deepen: (name) => `Place one collection offer on ${name} and let it fill, rather than cancelling it the same day.`,
  weekly: 'list one more item, or refresh an open offer so it stays live',
};

const indexPlay: CategoryPlay = {
  core: (name, chain, capital) => `Buy $${capital} of ${name}'s headline index token on ${chain} and hold it in the wallet.`,
  deepen: (name) => `Add a smaller holding of a second ${name} index with a different basket, so the wallet holds more than one product.`,
  weekly: 'claim any distribution the index pays, and otherwise leave the position alone',
};

const paymentsPlay: CategoryPlay = {
  core: (name, chain, capital) => `Activate ${name}'s account or card, load it with $${capital} and make three ordinary payments you would have made anyway.`,
  deepen: (name) => `Route one recurring payment, a subscription you already pay for, through ${name} so the account keeps a heartbeat.`,
  weekly: 'make two more small payments, spread across the week',
};

const aiPlay: CategoryPlay = {
  core: (name, chain, capital) => `Fund $${capital} and buy agent services or inference through ${name}'s app on ${chain}, spread across several days rather than one session.`,
  deepen: (name) => `If ${name} has a staking or deposit tier on its rewards page, fund the lowest tier and keep it for a month.`,
  weekly: 'run one more paid task or session, so usage lands in more than one week',
};

const privacyPlay: CategoryPlay = {
  core: (name, chain, capital) => `Deposit $${capital} into ${name}'s shielded pool on ${chain} from the farming wallet, then withdraw it a few days later to a second wallet you own.`,
  deepen: (name) => `Repeat the round trip once with a different amount, so the two deposits do not mirror each other.`,
  weekly: 'make one small shielded transfer between your two wallets',
};

const lockerPlay: CategoryPlay = {
  core: (name, chain, capital) => `Lock $${capital} of a liquid token through ${name} for six months and keep the lock's receipt in the wallet.`,
  deepen: (name) => `Create a second, shorter lock in ${name} with a different token, so the wallet shows two lock histories.`,
  weekly: 'open the lock page once and record the unlock dates in the farm log',
};

const defaultPlay: CategoryPlay = {
  core: (name, chain, capital) => `Deposit $${capital} of USDC into ${name}'s main product on ${chain} through its own app and keep the position open.`,
  deepen: (name) => `Use the second product ${name}'s app lists, a vault, a market or a staking page, with a further deposit.`,
  weekly: 'repeat the core action once with a small amount, so the week is not empty',
};

/** The play for a category: matched on the snapshot's own category words, never on a protocol name. */
function playFor(category: string | null): CategoryPlay {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) return lendPlay;
  if (c.includes('bridge')) return bridgePlay;
  if (c.includes('staking') || c.includes('restak') || c.includes('anchor btc') || c.includes('decentralized btc')) return stakingPlay;
  if (c.includes('dex')) return dexPlay;
  if (c.includes('derivative') || c.includes('synthetic') || c.includes('option')) return perpsPlay;
  if (c.includes('stable') || c.includes('reserve currency')) return stablePlay;
  if (c.includes('rwa')) return rwaPlay;
  if (c.includes('launchpad')) return launchpadPlay;
  if (c.includes('prediction')) return predictionPlay;
  if (c.includes('insurance')) return insurancePlay;
  if (c.includes('nft')) return nftPlay;
  if (c.includes('index')) return indexPlay;
  if (c.includes('payment') || c.includes('card')) return paymentsPlay;
  if (c.includes('ai')) return aiPlay;
  if (c.includes('privacy')) return privacyPlay;
  if (c.includes('locker')) return lockerPlay;
  if (c === 'chain') return chainPlay;
  if (c.includes('yield') || c.includes('farm') || c.includes('liquidity') || c.includes('curator') || c.includes('allocator') || c.includes('basis')) return yieldPlay;
  return defaultPlay;
}

/** A step inside the gate's 20..600 trimmed characters, whatever the template produced. */
function stepString(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 597).trimEnd()}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page weekly.`;
  return s;
}

/**
 * One protocol's farm plan: six steps from its own record. The wallet setup names its main chain
 * and its gas price; the core and deepen steps are its category's play; the weekly step, the hold
 * (from its age) and the claim hygiene close the plan.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const gas = gasForChain(chain);
  const gasText = gas < 1 ? `$${gas.toFixed(2)}` : `$${gas.toFixed(0)}`;
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const play = playFor(p.category);
  const multiChain =
    p.chains.length > 1 ? ` It also runs on ${p.chains[1]}, so keep a little gas there too.` : '';
  const ageText =
    age === null
      ? 'an unrecorded number of days'
      : `${age} days (tracked since ${p.listed_at})`;
  return [
    stepString(
      `Set up a fresh wallet for ${p.name} and fund it with gas on ${chain}.${multiChain} Keep the seed phrase offline and use this wallet for nothing else.`,
      `about ${gasText} of gas money moved in, no fee`,
      '10 minutes',
    ),
    stepString(play.core(p.name, chain, capital), `$${capital} of capital plus about ${gasText} of gas`, '20 minutes'),
    stepString(play.deepen(p.name, chain), `about $${Math.round(capital / 2)} more capital plus ${gasText} of gas`, '15 minutes'),
    stepString(
      `Once a week, ${play.weekly} on ${p.name}, so the wallet's activity spans many weekly snapshots instead of one day.`,
      `about ${gasText} of gas a week`,
      '10 minutes a week',
    ),
    stepString(
      `Hold every position for at least ${hold} days. ${p.name} has run ${ageText} with no token recorded, and a launch rewards the wallets that were there across snapshots, not the ones that arrived last.`,
      `the $${capital} stays deployed; leaving early is the expensive move`,
      `${hold} days`,
    ),
    stepString(
      `Follow ${p.name}'s official announcements and points page. If a token or a claim opens, claim only from the link the protocol itself publishes, and never pay any site to unlock an allocation. Log the wallet, the dates and every transaction hash as you go.`,
      '$0',
      '10 minutes a week',
    ),
  ];
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, steps, values. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** data.js: the dashboard's whole dataset as one script. No fetch, no network. */
export function dataScript(data: BoardData): string {
  return `window.BOARD_DATA=${JSON.stringify(data)};\n`;
}

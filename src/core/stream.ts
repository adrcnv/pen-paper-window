import type { Blow, GameEvent, Receipt } from "./protocol.ts";

// What the DM is doing while a turn is under way, by the tool it called.
export const ACTIVITY: Record<string, string> = {
  look: "looking around", story: "remembering", get: "checking the records", find: "searching the records", search_here: "searching", post: "sealing a letter",
  map: "studying the map", knows: "weighing who knows what", roll: "rolling the dice",
  record_event: "writing it down", note: "writing it down", update: "writing it down",
  create_person: "someone new", create_place: "somewhere new", create_item: "something new",
  move: "on the way", set_out: "setting out", advance_time: "time passes", transfer: "counting coins", hurt: "blood is drawn",
  deal: "striking a bargain", use_ability: "calling on a power", award_xp: "growing stronger",
  create_character: "a new life", choose_ability: "learning", reroll_stat: "rolling again", roll_abilities: "the dice of birth",
};

const TOOL_PREFIX = /^mcp__harness-dm__/;

type Json = Record<string, any>;

// Reads one turn of the DM's stream (Claude Code's stream-json rows, or any
// backend that speaks the same shape) into GameEvents. `you` is the player's
// name, to tell coins paid from coins received; a character made during the
// turn takes over from it.
export class StreamReader {
  you: string | undefined;
  private calls = new Map<string, [string, Json]>();

  constructor(you?: string) {
    this.you = you;
  }

  feed(row: unknown): GameEvent[] {
    const content = (row as Json)?.message?.content;
    if (!Array.isArray(content)) return [];
    const out: GameEvent[] = [];
    for (const block of content as Json[]) {
      if (block.type === "tool_use") {
        const name = String(block.name ?? "").replace(TOOL_PREFIX, "");
        this.calls.set(block.id, [name, block.input ?? {}]);
        out.push({ type: "activity", text: ACTIVITY[name] ?? "the DM is thinking" });
      } else if (block.type === "tool_result") {
        const call = this.calls.get(block.tool_use_id);
        if (!call || block.is_error) continue;
        const result = parseResult(block.content);
        if (!result || "error" in result) continue;
        for (const receipt of this.receipts(call[0], call[1], result)) out.push({ type: "receipt", receipt });
      } else if (block.type === "text") {
        out.push({ type: "activity", text: "telling it" });
      }
    }
    return out;
  }

  private receipts(name: string, args: Json, r: Json): Receipt[] {
    const me = this.you;
    const out: Receipt[] = [];
    // In a fight: a new round's order, and the foes who were up striking first.
    if (r.turn && typeof r.turn === "object" && r.turn.new) out.push({ kind: "round", round: Number(r.turn.round), order: String(r.turn.order ?? "") });
    if (Array.isArray(r.struck_first) && r.struck_first.length) out.push({ kind: "blows", blows: blowsOf(r.struck_first) });
    switch (name) {
      case "roll":
        if (r.dice) {
          out.push({ kind: "dice", expr: String(r.dice), rolls: (r.rolls ?? []).map(Number), total: Number(r.total), why: r.why, ...sided(r.sides) });
        } else {
          const blows = blowsOf(r.foes_strike ?? []);
          // A blow names its weapon (or the working a foe used) and the score it went on, and lands against a guard.
          const ability = r.runs_on ? `${r.runs_on} · ${r.used ?? r.with}` : String(r.ability ?? r.with ?? "");
          const theirs = r.their_guard != null ? `guard ${r.their_guard}` : (r.their_total ?? "");
          // What the DM gave or took for the play behind the roll, and whether it was the difference.
          const judged = r.for_play != null;
          const edge = judged ? Number(r.for_play) || 0 : 0;
          const bar = r.dc ?? r.their_guard ?? (r.their_total != null ? Number(r.their_total) + 1 : null);
          const turned = bar != null && (Number(r.total) >= Number(bar)) !== (Number(r.total) - edge >= Number(bar));
          out.push({
            kind: "check", who: r.who === me ? null : (r.who ?? null), ability,
            roll: Number(r.roll), mod: Number(r.total) - Number(r.roll) - edge, total: Number(r.total),
            against: r.dc != null ? `DC ${r.dc}` : `${r.against ?? ""} ${theirs}`.trim(),
            success: !!r.success, critical: !!r.critical, fumble: !!r.fumble, why: r.why, blows,
            ...(judged ? { edge, ...(turned ? { turned } : {}) } : {}),
            ...(r.their_guard != null ? { blow: true } : {}),
          });
          if (r.damage != null) {
            out.push({ kind: "dice", expr: String(r.damage_dice ?? r.used ?? "harm"), rolls: (r.damage_rolls ?? []).map(Number), total: Number(r.damage),
                       why: r.used ? `${r.used} · harm` : "harm", ...sided(r.damage_sides) });
          }
          // A blow rolled at the player is dealt by its roll.
          if (r.your_hp) out.push({ kind: "hurt", who: me ?? "", you: true, amount: Number(r.damage), hp: String(r.your_hp),
                                    down: /, down/.test(String(r.dealt ?? "")), turnsOnYou: false });
        }
        break;
      case "hurt":
        out.push({ kind: "hurt", who: String(r.who), you: r.who === me, amount: Number(args.amount ?? 0), hp: String(r.hp ?? ""),
                   down: !!r.down, turnsOnYou: !!r.turns_on_you });
        // A foe the player brought down counts itself.
        if (r.xp && Number(r.xp.gained) > 0) out.push({ kind: "xp", gained: Number(r.xp.gained), why: r.xp.why, level: r.xp.new_level ? Number(r.xp.level) : undefined });
        break;
      case "transfer":
        if (r.coins && r.from === me) out.push({ kind: "coins", delta: -Number(r.coins), party: String(r.to), towardDebts: !!r.toward_debts });
        else if (r.coins && r.to === me) out.push({ kind: "coins", delta: Number(r.coins), party: String(r.from), towardDebts: false });
        if (r.item && r.to === me) out.push({ kind: "item", name: String(r.item), gained: true, party: String(r.from) });
        else if (r.item && r.from === me) out.push({ kind: "item", name: String(r.item), gained: false, party: String(r.to) });
        if (r.used_up && r.by === me) out.push({ kind: "item", name: String(r.used_up), gained: false, party: "used up" });
        // Food eaten, or a meal paid for: "2 (17/30)".
        if (r.healed && (r.by ?? r.from) === me) {
          const [, amount, hp] = String(r.healed).match(/^(\d+) \(([^)]+)\)/) ?? [];
          if (amount) out.push({ kind: "hurt", who: me ?? "", you: true, amount: -Number(amount), hp, down: false, turnsOnYou: false });
        }
        break;
      case "award_xp":
        if (Number(r.gained) > 0) out.push({ kind: "xp", gained: Number(r.gained), why: r.why, level: r.new_level ? Number(r.level) : undefined });
        break;
      case "use_ability":
        out.push({ kind: "power", name: String(r.ability), usesLeft: r.uses_left, learned: false });
        if (r.roll && typeof r.roll === "object") out.push(...this.receipts("roll", {}, r.roll));
        // Its harm, die by die, when it lands (or needs no landing).
        if (r.damage != null && (!r.roll || r.roll.success)) {
          out.push({ kind: "dice", expr: String(r.damage_dice ?? ""), rolls: (r.damage_rolls ?? []).map(Number), total: Number(r.damage),
                     why: String(r.ability), ...sided(r.damage_sides) });
        }
        break;
      case "choose_ability":
        if (r.raised) out.push({ kind: "raised", ability: String(r.raised), was: Number(r.was), now: Number(r.now) });
        else if (r.learned) out.push({ kind: "power", name: String(r.learned), learned: true });
        break;
      case "move":
        if (args.who == null && Number(r.took_minutes) >= 60) {
          out.push({ kind: "travel", to: String(r.to), minutes: Number(r.took_minutes), heading: r.heading });
        }
        if (r.stopped_on_the_road) out.push({ kind: "waylaid" });
        // Breaking away from a fight, or out of custody: the roll, and the blows a failure brings.
        if (r.roll && typeof r.roll === "object") out.push(...this.receipts("roll", {}, { ...r.roll, foes_strike: r.foes_strike }));
        break;
      case "create_character":
        this.you = r.name;
        out.push({ kind: "born", name: String(r.name), cls: String(r.class ?? "") });
        break;
      case "roll_abilities":
        if (r.abilities && !r.already_rolled) out.push({ kind: "abilities", scores: scores(r.abilities) });
        break;
      case "reroll_stat":
        if (r.abilities) out.push({ kind: "abilities", scores: scores(r.abilities), rerolled: String(r.ability), was: Number(r.was) });
        break;
      case "deal":
        if (args.action === "open" && r.terms) out.push({ kind: "deal", terms: String(r.terms) });
        break;
    }
    // Whatever the call, a death comes after what led to it.
    if (r.turned_back) out.push({ kind: "turnedBack", text: String(r.turned_back), left: Number(r.lives_left ?? 0) });
    if (r.died) out.push({ kind: "died", name: me ?? "" });
    return out;
  }
}

// Foes' blows as the server tells them: a line each, a hit saying "hits for".
function blowsOf(lines: unknown[]): Blow[] {
  return lines.map((b) => ({ text: String(b).replace(/ \(person:\d+\)/, ""), hit: String(b).includes("hits for") }));
}

// Each die's sides, when the server said them.
function sided(sides: unknown): { sides?: number[] } {
  return Array.isArray(sides) ? { sides: sides.map(Number) } : {};
}

function scores(abilities: Json): { name: string; score: number }[] {
  return Object.entries(abilities).map(([name, score]) => ({ name, score: Number(score) }));
}

// A tool result arrives as text blocks holding the server's JSON.
function parseResult(content: unknown): Json | null {
  const text = Array.isArray(content)
    ? content.map((c) => (typeof c === "object" && c ? (c as Json).text ?? "" : String(c))).join("")
    : String(content ?? "");
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

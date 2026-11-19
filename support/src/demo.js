// The system demo (load test): fake customers, played by the model, contact the chat as real customers would, so the owner can watch how
// the system copes: the queue, the AI agents, the hand-overs to people, the guards against customers who try to cheat.
// The owner chooses how heavy it is, from very light to very heavy. Only the owner (an address in ADMIN_EMAILS) can start it.
//
// The strength is limited by what the model and a Worker can do in a few seconds (and by the cost), so this tests how the system
// BEHAVES under many conversations at once, not the raw throughput of Cloudflare. A budget of model calls and a time limit stop it by themselves.

// concurrent: customers chatting at once · spawn: new customers per tick · act: customers who answer per tick · think: seconds a customer takes to answer
export const LEVELS = [
  { id: 1, name: 'קל מאוד', concurrent: 2, spawn: 1, act: 1, think: [20, 45] },
  { id: 2, name: 'קל', concurrent: 4, spawn: 1, act: 2, think: [15, 35] },
  { id: 3, name: 'בינוני', concurrent: 8, spawn: 2, act: 3, think: [10, 25] },
  { id: 4, name: 'קשה', concurrent: 15, spawn: 3, act: 4, think: [6, 18] },
  { id: 5, name: 'קשה מאוד', concurrent: 30, spawn: 4, act: 4, think: [3, 10] },
];
export const TICK_MS = 10000;
export const DEFAULT_MIX = ['honest', 'freebie', 'manipulator', 'injector', 'angry', 'confused', 'quick'];
export const DEMO_INFO = (site) => `Verified reem.bi account: לקוח דמו <demo@example.com>, joined 2025-01-10, last sign-in today; email verified; phone verified.\n- ${site}: plan "Basic", access active, plan ends 2027-01-10.\n- Subscription: Basic, ACTIVE, 9 ILS a month.\n- Payment: completed 9 ILS.`;

export function cleanRun(b, prev = null) {
  const n = (v, d, min, max) => (Number.isFinite(+v) ? Math.min(max, Math.max(min, Math.round(+v))) : d);
  return {
    level: n(b.level, prev?.level || 1, 1, LEVELS.length),
    minutes: n(b.minutes, prev?.minutes || 15, 1, 240),
    budget: n(b.budget, prev?.budget || 300, 20, 5000), // model calls in this run
    // By default the demo is as real as it gets: the people get the chats like any others (assignment as set), and are told by sound and pop-up.
    humans: b.humans !== undefined ? !!b.humans : prev ? !!prev.humans : true,
    notify: b.notify !== undefined ? !!b.notify : prev ? !!prev.notify : true,
    mix: (Array.isArray(b.mix) ? b.mix : prev?.mix || DEFAULT_MIX).filter(x => DEFAULT_MIX.includes(x)),
  };
}

export function pickWeighted(list, rnd = Math.random) {
  return list[Math.floor(rnd() * list.length)];
}

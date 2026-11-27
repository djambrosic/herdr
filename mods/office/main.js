// The sidebar as a floor plan: every space is an office seen from above with small desks, a closet,
// a vending machine and a kitchen. An agent sits at its desk while it works and walks around
// the office when it does not. The agents get their own panel of small cards below it.

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, spaces, run, theme, props, settings, setAgentOrder } from "herdr";

const ANIMALS = ["🦊", "🐙", "🦉", "🐧", "🦄", "🐢", "🦁", "🐼", "🐸", "🦖", "🐝", "🦝", "🐨", "🦔", "🐳", "🐯", "🦜", "🐺", "🦦", "🐞"];

// Every office gets one of these as its carpet, picked from the space's id so it stays put.
const FLOORS = ["#E8662A", "#F2A33A", "#6AA6A0", "#6C8FB5", "#B07A9E", "#8FA860"];
const floorOf = (id) => FLOORS[[...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % FLOORS.length];

const WALL = "#4A443E";
const WOOD = "#5A4636";
const WOOD_EDGE = "#7A6049";
const CHAIR = "#2A2724";

// What sits on the desk says what its agent is up to.
const ON_DESK = { working: "💻", blocked: "🔔", done: "✅", idle: "☕" };

// The floor, in px, measured from its top left corner. The closet is on the left wall, the vending
// machine on the right, the rest table at the bottom and the desks are spread over what is left.
const FLOOR_WIDTH = 276;
const FLOOR_HEIGHT = 224;
const DESK_WIDTH = 56;
const DESK_HEIGHT = 54;
const WORKER_SIZE = 20;
const WALK_MILLISECONDS = 1800;
const MINIMUM_DESKS = 4;

// Where the desks stand, in the order agents take them.
const DESK_SPOTS = [{ x: 52, y: 6 }, { x: 176, y: 8 }, { x: 168, y: 100 }, { x: 64, y: 88 }, { x: 16, y: 150 }, { x: 190, y: 168 }];
// Past the spots above, desks go in extra rows under the floor.
const EXTRA_DESK_COLUMNS = [20, 110, 200];
const EXTRA_ROW_HEIGHT = 60;

// Where an idle agent walks to: the closet, the vending machine, the fridge, the sink and the
// stove, the plant and two places in the aisles. `right` is the distance from the right wall,
// `center` the distance from the middle of the floor.
const REST_SPOTS = [
  { x: 42, y: 90 },
  { right: 30, y: 152 },
  { center: -44, y: 156 },
  { center: -15, y: 168 },
  { center: 17, y: 168 },
  { x: 30, y: 32 },
  { x: 130, y: 28 },
  { x: 134, y: 104 },
];
const KITCHEN_SPOTS = [2, 3, 4];

// The floor is drawn for 276px and stretched sideways to whatever width the sidebar has.
const stretch = (x, width) => Math.round((x * width) / FLOOR_WIDTH);
const spotPosition = (spot, width) => ({
  x: spot.right != null ? width - spot.right : spot.center != null ? Math.round(width / 2) + spot.center : stretch(spot.x, width),
  y: spot.y,
});

// A hex color with an alpha byte, for soft backgrounds. Anything else stays as it is.
const tint = (color, alpha) => (/^#[0-9a-f]{6}/i.test(color ?? "") ? color.slice(0, 7) + alpha : color);

const between = (low, high) => low + Math.random() * (high - low);

// Drops the status glyph or spinner an agent puts before its title ("✦ Fix login", "⠋ Thinking").
const clean = (text) => (text ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}~/]+/u, "").trim();

// What the agent says it is working on. A shell-style title (a path, user@host or the program's
// own name) says nothing, so then the tab or pane name is used.
function task(agent) {
  if (agent.pane_name) return agent.pane_name;
  const live = clean(agent.title);
  const useless = !live || live === agent.address || live === agent.program?.name || /^[~/]/.test(live) || live.includes("@");
  if (!useless) return live;
  const named = agent.tab_name && !/^\d+$/.test(agent.tab_name);
  return named ? agent.tab_name : agent.program?.name ?? agent.address;
}

function duration(milliseconds) {
  const minutes = Math.floor(milliseconds / 60000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

const statusColor = (t, status) => ({ working: t.working, blocked: t.blocked, done: t.done, idle: t.idle }[status] ?? t.idle);

function deskCorner(index, width) {
  if (index < DESK_SPOTS.length) return { x: stretch(DESK_SPOTS[index].x, width), y: DESK_SPOTS[index].y };
  const extra = index - DESK_SPOTS.length;
  return { x: stretch(EXTRA_DESK_COLUMNS[extra % EXTRA_DESK_COLUMNS.length], width), y: FLOOR_HEIGHT + 4 + Math.floor(extra / EXTRA_DESK_COLUMNS.length) * EXTRA_ROW_HEIGHT };
}

const floorHeight = (deskCount) => FLOOR_HEIGHT + Math.max(0, Math.ceil((deskCount - DESK_SPOTS.length) / EXTRA_DESK_COLUMNS.length)) * EXTRA_ROW_HEIGHT;

export default class Office extends View {
  init(_props, cx) {
    this.spots = {};
    this.sidebarWidth = 384;
    if (props()?.roster) {
      // The minutes in "working 3m" only move when we redraw.
      cx.timer.every(30000, (cx) => cx.notify());
      return;
    }
    cx.timer.every(1000, (cx) => this.wander(cx));
  }

  // Once a second: an agent that is not working picks a new place to go when it has stood long
  // enough at the last one. Two agents never take the same place.
  wander(cx) {
    const now = Date.now();
    const everyone = agents();
    for (const space of spaces()) {
      const here = everyone.filter((agent) => agent.space === space.id);
      here.forEach((agent) => {
        if (agent.status === "working" || agent.status === "blocked") {
          delete this.spots[agent.address];
          return;
        }
        const spot = this.spots[agent.address];
        if (spot && now < spot.next) return;
        const taken = here.filter((other) => other !== agent && this.spots[other.address]).map((other) => this.spots[other.address].index);
        const free = REST_SPOTS.map((_, index) => index).filter((index) => index !== spot?.index && !taken.includes(index));
        if (!free.length) return;
        const index = free[Math.floor(Math.random() * free.length)];
        this.spots[agent.address] = { index, arrive: now + WALK_MILLISECONDS, next: now + WALK_MILLISECONDS + between(3000, 9000) };
      });
    }
    cx.notify();
  }

  // Taken from the address, so the desk and the card show the same animal without sharing any state.
  animal(address) {
    const sum = [...address].reduce((total, char) => total * 31 + char.charCodeAt(0), 7);
    return ANIMALS[Math.abs(sum) % ANIMALS.length];
  }

  // "working 4m", "needs you 1m", "done 12m", "idle 2h".
  state(agent, tab) {
    const since = agent.status === "working" ? tab?.working_since : tab?.changed_at;
    const word = { working: "working", blocked: "needs you", done: "done", idle: "idle" }[agent.status] ?? agent.status;
    return since ? `${word} ${duration(Date.now() - since)}` : word;
  }

  // A desk seen from above: the desk with its screen and its chair. Nobody stands here, the
  // worker is drawn on top and walks over to it.
  desk(t, key, corner, agent, tab) {
    const working = agent?.status === "working";
    const lit = agent && agent.status !== "idle";
    const color = agent ? statusColor(t, agent.status) : t.idle;
    return div()
      .id(`desk-${key}`)
      .absolute()
      .left(corner.x)
      .top(corner.y)
      .w(DESK_WIDTH)
      .h(DESK_HEIGHT)
      .rounded(6)
      .when(agent?.focused, (el) => el.bg(tint(t.accent, "26")))
      .when(Boolean(agent), (el) => el
        .cursor_pointer()
        .hover((inner) => inner.bg(t.hover))
        .tooltip(`${task(agent)} · ${this.state(agent, tab)}`)
        .on_click(() => run("agent.focus", { terminal: agent.address })))
      .child(div().absolute().top(3).left(6).w(44).h(22).rounded(4).bg(agent ? WOOD : tint(WOOD, "88")).border_1().border_color(agent ? WOOD_EDGE : tint(WOOD_EDGE, "66"))
        .child(h_flex().size_full().items_center().justify_center()
          .child(div()
            .id(`screen-${key}`)
            .w(20)
            .h(11)
            .rounded(2)
            .border_1()
            .border_color("#1C1A19")
            .bg(lit ? color : "#2A2724")
            .when(working, (el) => el.loop("opacity", { from: 0.55, to: 1, period: 1400 }))
            .when(agent?.status === "blocked", (el) => el.loop("opacity", { from: 0.35, to: 1, period: 700 })))))
      .child(div().absolute().top(22).left(16).w(24).h(24).rounded_full().bg(agent ? CHAIR : tint(CHAIR, "88")).border_1().border_color(agent ? WALL : tint(WALL, "66")))
      .when(working, (el) => el.child(div()
        .id(`typing-${key}`)
        .absolute()
        .bottom(0)
        .right(4)
        .text_size(11)
        .font_bold()
        .text_color(color)
        .frames(["·", "· ·", "· · ·", "· ·"], 220)));
  }

  // The animal itself. The outer element only travels (it glides when its place changes); the inner
  // one does the small moves: leaning in while it works, shaking its head when it needs you, hopping
  // while it walks.
  worker(t, agent, place, walking) {
    const color = statusColor(t, agent.status);
    const idle = agent.status === "idle";
    return div()
      .id(`worker-${agent.address}`)
      .absolute()
      .left(place.x)
      .top(place.y)
      .w(WORKER_SIZE)
      .h(WORKER_SIZE)
      .cursor_pointer()
      .transition("left", { duration: WALK_MILLISECONDS, easing: "ease-in-out" })
      .transition("top", { duration: WALK_MILLISECONDS, easing: "ease-in-out" })
      .tooltip(`${task(agent)} · ${this.state(agent, undefined)}`)
      .on_click(() => run("agent.focus", { terminal: agent.address }))
      .child(div()
        .id(`body-${agent.address}`)
        .absolute()
        .left(0)
        .top(0)
        .w(WORKER_SIZE)
        .h(WORKER_SIZE)
        .rounded_full()
        .flex()
        .items_center()
        .justify_center()
        .bg(tint(color, idle ? "55" : "88"))
        .border_1()
        .border_color(agent.focused ? t.accent : idle ? t.border : color)
        .text_size(12)
        // Sitting still while it works: only a soft glow. It shakes its head when it needs you.
        .when(agent.status === "working", (el) => el.loop("opacity", { from: 0.75, to: 1, period: 900 }))
        .when(agent.status === "blocked", (el) => el.loop("left", { from: -4, to: 4, period: 300 }))
        .when(walking && agent.status !== "working" && agent.status !== "blocked", (el) => el.loop("top", { from: 0, to: -3, period: 260 }))
        .child(this.animal(agent.address)));
  }

  closet(left, top) {
    return div().absolute().left(left).top(top).w(34).h(54).rounded(3).bg("#6B5340").border_1().border_color(WOOD_EDGE)
      .child(div().absolute().left(16).top(0).w(1).h(52).bg("#3A2D22"))
      .child(div().absolute().left(11).top(25).w(2).h(6).rounded(1).bg("#CFC3B2"))
      .child(div().absolute().left(20).top(25).w(2).h(6).rounded(1).bg("#CFC3B2"));
  }

  vendingMachine(left, top) {
    const snacks = ["#E8662A", "#F2A33A", "#6AA6A0"];
    const shelf = [0, 1, 2].flatMap((row) => [0, 1, 2].map((column) =>
      div().absolute().left(6 + column * 7).top(7 + row * 9).w(5).h(6).rounded(1).bg(snacks[(row + column) % 3])));
    return div().absolute().left(left).top(top).w(30).h(54).rounded(3).bg("#7A3340").border_1().border_color("#4A1F28")
      .child(div().absolute().left(3).top(4).w(24).h(32).rounded(2).bg("#9CC4D855"))
      .children(shelf)
      .child(div().absolute().left(6).top(42).w(18).h(6).rounded(1).bg("#1C1A19"));
  }

  // A small kitchen against the bottom wall: a fridge, then a counter with a sink and a stove.
  kitchen(left) {
    const burner = (x, y) => div().absolute().left(x).top(y).w(6).h(6).rounded_full().bg("#5A524A");
    const fridge = div().absolute().left(0).top(178).w(24).h(42).rounded(3).bg("#D7DCE0").border_1().border_color("#9AA3AA")
      .child(div().absolute().left(0).top(13).w(22).h(1).bg("#9AA3AA"))
      .child(div().absolute().left(17).top(5).w(2).h(6).rounded(1).bg("#6B747B"))
      .child(div().absolute().left(17).top(18).w(2).h(10).rounded(1).bg("#6B747B"));
    const counter = div().absolute().left(26).top(192).w(66).h(28).rounded(3).bg("#8A7A68").border_1().border_color("#5E5144")
      .child(div().absolute().left(4).top(6).w(22).h(14).rounded(3).bg("#7FA3B8").border_1().border_color("#4F6E80"))
      .child(div().absolute().left(13).top(2).w(4).h(4).rounded_full().bg("#C9CED2"))
      .child(div().absolute().left(34).top(4).w(26).h(20).rounded(2).bg("#2A2724")
        .child(burner(4, 3)).child(burner(16, 3)).child(burner(4, 11)).child(burner(16, 11)));
    return div().absolute().left(left).top(0).w(92).h(224).child(fridge).child(counter);
  }

  // A lamp in the ceiling: a bright dot with a soft glow while someone is in, a grey one when not.
  lamp(lit, width) {
    return div().absolute().left(Math.round(width / 2) - 16).top(-2).w(32).h(32)
      .when(lit, (el) => el.child(div().absolute().left(-6).top(-6).w(44).h(44).rounded_full().bg("#FFE9A82A")))
      .child(div().absolute().left(11).top(2).w(10).h(10).rounded_full().bg(lit ? "#FFE9A8" : "#3A352F").border_1().border_color(lit ? "#FFF6D6" : WALL));
  }

  // One office: a name plate in the top wall, then the floor.
  room(t, space, here, width) {
    const now = Date.now();
    const dot = statusColor(t, space.status);
    const floor = floorOf(space.id);
    const count = (status) => here.filter((agent) => agent.status === status).length;
    const summary = [
      count("working") && `${count("working")} working`,
      count("blocked") && `${count("blocked")} needs you`,
      count("done") && `${count("done")} done`,
    ].filter(Boolean).join(" · ") || (here.length ? `${here.length} idle` : "nobody in");

    const deskCount = Math.max(MINIMUM_DESKS, here.length);
    const corners = Array.from({ length: deskCount }, (_, index) => deskCorner(index, width));
    const lit = here.length > 0;

    // At its desk while working or waiting for you, else wherever it walked to. Before the first
    // walk it sits at the rest table.
    const placeOf = (agent, index) => {
      if (agent.status === "working" || agent.status === "blocked") return { place: { x: corners[index].x + 18, y: corners[index].y + 24 }, walking: false };
      const spot = this.spots[agent.address];
      if (!spot) return { place: spotPosition(REST_SPOTS[KITCHEN_SPOTS[index % KITCHEN_SPOTS.length]], width), walking: false };
      return { place: spotPosition(REST_SPOTS[spot.index], width), walking: now < spot.arrive };
    };

    return v_flex()
      .id(`room-${space.id}`)
      .flex_none()
      .overflow_hidden()
      .rounded(8)
      .border_4()
      .border_color(space.active ? t.accent : WALL)
      .bg(tint(floor, "1A"))
      .child(h_flex()
        .id(`room-name-${space.id}`)
        .items_center()
        .gap(8)
        .px(8)
        .py(5)
        .bg("#2A2724")
        .cursor_pointer()
        .on_click(() => run("space.select", { id: space.id }))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_size(13).font_semibold().text_color(space.active ? t.foreground : t.muted).child(space.name))
          .child(div().truncate().text_size(10.5).text_color(t.dim).child(space.branch ? `${summary} · ${space.branch}` : summary)))
        .child(div().w(7).h(7).rounded_full().bg(dot)))
      .child(div().h(3).bg(tint(floor, "AA")))
      .child(div().px(8).py(8)
        .child(div().relative().overflow_hidden().rounded(6).w(width).h(floorHeight(deskCount)).flex_none()
          .bg(lit ? tint(floor, "2E") : "#0E0D0C")
          .children(corners.map((corner, index) => {
            const agent = here[index];
            return this.desk(t, `${space.id}-${index}`, corner, agent, agent && space.tabs.find((tab) => tab.id === agent.tab));
          }))
          .child(this.closet(4, 64))
          .child(this.vendingMachine(width - 34, 96))
          .child(this.kitchen(Math.round(width / 2) - 46))
          .child(div().absolute().left(6).top(4).text_size(22).child("🪴"))
          // The light: warm while someone is in, the whole room dark when nobody is.
          .child(div().absolute().left(0).top(0).size_full().bg(lit ? "#FFD98A12" : "#000000A6"))
          .child(this.lamp(lit, width))
          .children(here.map((agent, index) => {
            const { place, walking } = placeOf(agent, index);
            return this.worker(t, agent, place, walking);
          }))));
  }

  // One agent as a small card: the same animal as in the office, what it works on, and its state.
  // A working agent looks busy: it leans in, a bar keeps running along the bottom and dots type.
  card(t, agent, tab) {
    const color = statusColor(t, agent.status);
    const idle = agent.status === "idle";
    const working = agent.status === "working";
    return div()
      .id(`card-${agent.address}`)
      .relative()
      .overflow_hidden()
      .flex_none()
      .w(144)
      .h(44)
      .rounded(7)
      .border_1()
      .border_color(agent.focused ? t.accent : tint(color, idle ? "33" : "88"))
      .bg(agent.focused ? tint(t.accent, "1A") : tint(color, "12"))
      .cursor_pointer()
      .hover((el) => el.bg(t.hover))
      .on_click(() => run("agent.focus", { terminal: agent.address }))
      .child(div().id(`card-body-${agent.address}`).absolute().left(7).top(9).w(26).h(26).rounded_full().flex().items_center().justify_center()
        .bg(tint(color, idle ? "33" : "66"))
        .border_1()
        .border_color(idle ? t.border : color)
        .text_size(15)
        .when(working, (el) => el.loop("opacity", { from: 0.75, to: 1, period: 900 }))
        .when(agent.status === "blocked", (el) => el.loop("left", { from: 4, to: 10, period: 300 }))
        .child(this.animal(agent.address)))
      .child(v_flex().absolute().left(39).right(6).top(6)
        .child(div().truncate().text_size(11.5).text_color(agent.focused ? t.foreground : t.muted).child(task(agent)))
        .child(h_flex().gap(4).items_center()
          .child(div().truncate().text_size(10).text_color(idle ? t.dim : color).child(this.state(agent, tab)))
          .when(working, (el) => el.child(div().id(`dots-${agent.address}`).text_size(10).font_bold().text_color(color).frames(["·", "· ·", "· · ·", "· ·"], 220)))))
      .when(working, (el) => el.child(div().id(`bar-${agent.address}`).absolute().left(0).bottom(0).h(2).bg(color).loop("width", { from: 8, to: 140, period: 1400 })));
  }

  // The agents panel: small cards, as many in a row as fit, the ones that need you first.
  roster(t, everyone, rooms) {
    const rank = { blocked: 4, done: 3, working: 2, idle: 1 };
    const sorted = [...everyone].sort((a, b) => (rank[b.status] ?? 0) - (rank[a.status] ?? 0));
    setAgentOrder(sorted.map((agent) => agent.address));
    const tabs = new Map(rooms.flatMap((space) => space.tabs).map((tab) => [tab.id, tab]));
    return v_flex()
      .size_full()
      .min_h(0)
      .border_t(1)
      .border_color(t.border)
      .child(div().flex_none().px(16).pt(12).pb(6).text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
      .child(v_flex()
        .id("roster")
        .flex_1()
        .min_h(0)
        .px(10)
        .pb(8)
        .overflow_y_scrollbar()
        .mode("always")
        .when(sorted.length === 0, (el) => el.child(div().px(6).text_size(12).text_color(t.dim).child("No agents yet.")))
        .child(h_flex().flex_wrap().gap(6).children(sorted.map((agent) => this.card(t, agent, tabs.get(agent.tab))))));
  }

  render() {
    const t = theme();
    const everyone = agents();
    const rooms = spaces();
    if (props()?.roster) return this.roster(t, everyone, rooms);
    // What is left of the sidebar once the paddings and walls of a room are taken off.
    const width = Math.max(200, Math.min(700, Math.round(this.sidebarWidth / (settings()?.zoom ?? 1)) - 44));
    return v_flex()
      .id("office-root")
      .size_full()
      .on_size_change((size, cx) => {
        if (Math.abs(size.width - this.sidebarWidth) < 1) return;
        this.sidebarWidth = size.width;
        cx.notify();
      })
      .child(v_flex()
        .id("office")
        .flex_1()
        .min_h(0)
        .px(10)
        .py(8)
        .gap(12)
        .overflow_y_scrollbar()
        .mode("always")
        .child(h_flex().flex_none().px(4).pb(2).child(image("mods/office/logo-color.svg").w(180).h(40).flex_none()))
        .children(rooms.map((space) => this.room(t, space, everyone.filter((agent) => agent.space === space.id), width))));
  }
}
